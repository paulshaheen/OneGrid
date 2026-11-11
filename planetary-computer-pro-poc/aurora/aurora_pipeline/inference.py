"""Call the deployed Aurora endpoint and track tropical cyclones.

Aurora on Azure ML Foundry does not return tensors in the HTTP body — it streams
predicted :class:`aurora.Batch` objects through a blob-storage *channel*.

The forecast is turned into cyclone tracks in two stages that mirror how Aurora
is meant to be used:

1. **Genesis detection** (:func:`detect_seeds`) scans the *initial condition* for
   storm centres, because Aurora's own tracker cannot find storms on its own.
2. **Propagation** (:func:`run_and_track`) submits the initial condition, then
   feeds every predicted batch to one official :class:`aurora.Tracker` per seed.
   The tracker is the algorithm from the Aurora Nature paper, so the tracks are
   produced by Microsoft's code rather than a home-grown heuristic.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

import numpy as np

from .config import Config

if TYPE_CHECKING:
    from aurora import Batch

log = logging.getLogger("aurora_pipeline")


@dataclass(frozen=True)
class ForecastField:
    """One surface state reduced to what genesis detection consumes."""

    lead_hours: int
    valid_time: datetime
    lat: np.ndarray  # (H,) degrees, descending
    lon: np.ndarray  # (W,) degrees, 0..360
    msl: np.ndarray  # (H, W) Pa
    wind10: np.ndarray  # (H, W) m/s, sqrt(u^2 + v^2)


def detect_seeds(config: Config, initial_condition: Batch):
    """Locate the cyclones present in the analysis so trackers can be seeded."""
    # Imported here to avoid a tracking <-> inference import cycle at module load.
    from .tracking import find_centres

    analysis_time = initial_condition.metadata.time[-1]
    field = _reduce(initial_condition, analysis_time)
    return find_centres(field, config.detection_bbox)


def _endpoint_token(config: Config) -> str:
    """Return the endpoint bearer token, minting one from the managed identity when
    AURORA_ENDPOINT_TOKEN is not set (the scheduled Container Apps Job path)."""
    if config.endpoint_token:
        return config.endpoint_token
    from azure.identity import DefaultAzureCredential

    log.info("No AURORA_ENDPOINT_TOKEN set; acquiring an AAD token via managed identity.")
    return DefaultAzureCredential().get_token("https://ml.azure.com/.default").token


def run_and_track(config: Config, initial_condition: Batch, seeds) -> tuple[list, dict | None]:
    """Submit the forecast and propagate each seed with ``aurora.Tracker``.

    Returns ``(tracks, corridor)``: a list of :class:`aurora_pipeline.tracking.Track`,
    and — when ``CORRIDOR_BBOX`` is set — the regional surface fields at every step
    (see :func:`extract_corridor`). With no seeds and no corridor export the endpoint
    is not called at all: no storms means no forecast to run.
    """
    from .tracking import Centre, Track, is_valid_track

    corridor_bbox = config.corridor_bbox
    if not seeds and corridor_bbox is None:
        log.info("No cyclones detected in the analysis; skipping endpoint call.")
        return [], None

    from aurora import Tracker
    from aurora.foundry import BlobStorageChannel, FoundryClient, submit

    from .blob_sas import resolve_channel_url

    analysis_time = initial_condition.metadata.time[-1]
    corridor = None
    if corridor_bbox is not None:
        corridor = extract_corridor(initial_condition, corridor_bbox, analysis_time)

    # One official tracker per detected storm, seeded at its analysis position.
    trackers = [
        Tracker(init_lat=s.lat, init_lon=s.lon % 360.0, init_time=analysis_time)
        for s in seeds
    ]
    active = list(range(len(trackers)))

    foundry_client = FoundryClient(endpoint=config.endpoint, token=_endpoint_token(config))
    channel = BlobStorageChannel(resolve_channel_url(config))

    for prediction in submit(
        batch=initial_condition,
        model_name=config.model_name,
        num_steps=config.num_steps,
        foundry_client=foundry_client,
        channel=channel,
    ):
        if corridor is not None:
            _append_corridor(corridor, extract_corridor(prediction, corridor_bbox, analysis_time))
        for i in list(active):
            try:
                trackers[i].step(prediction)
            except Exception as exc:  # noqa: BLE001 - a lost storm must not abort others
                log.info("Tracker %d stopped: %s", i, exc)
                active.remove(i)

    tracks: list[Track] = []
    for seed, tracker in zip(seeds, trackers):
        track = _results_to_track(seed, tracker.results(), analysis_time, Centre)
        if is_valid_track(track):
            tracks.append(track)
    return tracks, corridor


def extract_corridor(batch: Batch, bbox, analysis_time: datetime) -> dict:
    """Surface fields over ``bbox`` for one state: 2 m temperature and 850 hPa
    temperature (°C) and 10 m wind components (m/s), on Aurora's 0.25° grid with
    longitudes in -180..180 ascending and latitudes as Aurora orders them."""
    lat = _to_numpy(batch.metadata.lat)
    lon = ((_to_numpy(batch.metadata.lon) + 180.0) % 360.0) - 180.0
    pad = 0.5
    lat_idx = np.where((lat >= bbox.min_lat - pad) & (lat <= bbox.max_lat + pad))[0]
    lon_idx = np.where((lon >= bbox.min_lon - pad) & (lon <= bbox.max_lon + pad))[0]
    lon_idx = lon_idx[np.argsort(lon[lon_idx])]

    def sub(grid: np.ndarray) -> list:
        return np.round(grid[np.ix_(lat_idx, lon_idx)], 2).tolist()

    levels = list(batch.metadata.atmos_levels)
    t_atmos = _to_numpy(batch.atmos_vars["t"])
    while t_atmos.ndim > 3:
        t_atmos = t_atmos[-1]  # (levels, H, W) at the newest time
    valid_time = batch.metadata.time[-1]
    return {
        "lats": np.round(lat[lat_idx], 3).tolist(),
        "lons": np.round(lon[lon_idx], 3).tolist(),
        "steps": [round((valid_time - analysis_time).total_seconds() / 3600)],
        "fields": {
            "t2m_c": [sub(_last_step(batch.surf_vars["2t"]) - 273.15)],
            "u10": [sub(_last_step(batch.surf_vars["10u"]))],
            "v10": [sub(_last_step(batch.surf_vars["10v"]))],
            "t850_c": [sub(t_atmos[levels.index(850)] - 273.15)],
        },
    }


def _append_corridor(corridor: dict, frame: dict) -> None:
    corridor["steps"].extend(frame["steps"])
    for name, grids in frame["fields"].items():
        corridor["fields"][name].extend(grids)


def _results_to_track(seed, frame, analysis_time: datetime, Centre) -> list:
    """Convert an ``aurora.Tracker`` result frame into our ``Track``.

    The seed (analysis position, with detected intensity) becomes hour 0; the
    tracker's forecast rows become the later hours. The tracker's first row is
    the seed position with NaN intensity, so it is skipped.
    """
    track = [
        Centre(
            lead_hours=0,
            lat=float(seed.lat),
            lon=_wrap_180(float(seed.lon)),
            pressure_hpa=float(seed.pressure_hpa),
            wind_ms=float(seed.wind_ms),
        )
    ]
    for row in frame.itertuples(index=False):
        msl = float(row.msl)
        wind = float(row.wind)
        if not (np.isfinite(msl) and np.isfinite(wind)):
            continue  # the seed row (NaN intensity) or a failed step
        lead = round((row.time - analysis_time).total_seconds() / 3600)
        if lead <= 0:
            continue  # analysis row already represented by the seed
        track.append(
            Centre(
                lead_hours=int(lead),
                lat=float(row.lat),
                lon=_wrap_180(float(row.lon)),
                pressure_hpa=msl / 100.0,
                wind_ms=wind,
            )
        )
    return track


def _wrap_180(lon: float) -> float:
    return ((lon + 180.0) % 360.0) - 180.0


def _reduce(prediction: Batch, analysis_time: datetime) -> ForecastField:
    valid_time = prediction.metadata.time[-1]
    lead_hours = round((valid_time - analysis_time).total_seconds() / 3600)

    lat = _to_numpy(prediction.metadata.lat)
    lon = _to_numpy(prediction.metadata.lon)
    msl = _last_step(prediction.surf_vars["msl"])
    u10 = _last_step(prediction.surf_vars["10u"])
    v10 = _last_step(prediction.surf_vars["10v"])
    wind10 = np.sqrt(u10**2 + v10**2)

    return ForecastField(
        lead_hours=lead_hours,
        valid_time=valid_time,
        lat=lat,
        lon=lon,
        msl=msl,
        wind10=wind10,
    )


def _to_numpy(tensor) -> np.ndarray:
    return tensor.detach().cpu().numpy() if hasattr(tensor, "detach") else np.asarray(tensor)


def _last_step(tensor) -> np.ndarray:
    """Aurora surface tensors are (batch, time, H, W); take the newest state."""
    array = _to_numpy(tensor)
    while array.ndim > 2:
        array = array[-1]
    return array
