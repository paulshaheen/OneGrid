"""Build an :class:`aurora.Batch` of initial conditions for the endpoint.

Aurora needs a *history* of two consecutive 6-hourly states (t0-6h and t0) with
surface variables, static variables, and five atmospheric variables on 13
pressure levels. Aurora 1.5 (the default checkpoint) needs 18 surface variables
plus insolation and 36 static fields; the original checkpoints need 4 and 3.
Sources:

* ``gfs`` (default) — NOAA GFS 0.25-degree operational analysis from the **public**
  AWS Open Data archive (anonymous), 2021 -> now. Carries every Aurora 1.5 input.
* ``era5_arco`` — ECMWF ERA5 from Google's **public** ARCO-ERA5 archive
  (anonymous), 1940 -> ~1 week ago. Carries every Aurora 1.5 input; used for
  historical storm replays.
* ``hres_t0`` — IFS HRES T0 pulled from the **public** WeatherBench2
  archive on Google Cloud (no credentials), 2016-2022. Only the original 4 surface
  variables, so it needs the original Foundry "Aurora" deployment.
* ``era5`` — downloaded from the Copernicus CDS. Requires a (free) CDS account
  and must be run against the *pretrained* checkpoint, per Aurora's guidance.
* ``hres`` — read from local ECMWF HRES GRIB files (operational path).

Static variables come from Aurora's HuggingFace pickle for the chosen checkpoint.
The returned batch is on CPU; the endpoint does the GPU work.
"""

from __future__ import annotations

import pickle
import tempfile
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import torch
import xarray as xr
from aurora import Batch, Metadata

from .config import ATMOS_LEVELS, Config

# WeatherBench2 (and CDS) long variable names for the four surface fields.
_WB2_SURFACE = {
    "2t": "2m_temperature",
    "10u": "10m_u_component_of_wind",
    "10v": "10m_v_component_of_wind",
    "msl": "mean_sea_level_pressure",
}
_WB2_ATMOS = {
    "t": "temperature",
    "u": "u_component_of_wind",
    "v": "v_component_of_wind",
    "q": "specific_humidity",
    "z": "geopotential",
}

# Aurora 1.5 input surface variables beyond the original four. Insolation is added
# separately; the 7 output-only variables are zero-padded by the model itself.
_V1P5_EXTRA_SURFACE = (
    "2d", "tcwv", "tcc", "100u", "100v", "sp", "lcc",
    "mcc", "hcc", "skt", "stl1", "swvl1", "ci", "scaled_sd",
)
_BASE_SURFACE = ("2t", "10u", "10v", "msl")

# ARCO-ERA5 long names. `scaled_sd` is ERA5 snow depth (m of water equivalent);
# the model applies its own log-scaling, as in Aurora's ERA5 demo.
_ARCO_SURFACE = {
    **_WB2_SURFACE,
    "2d": "2m_dewpoint_temperature",
    "tcwv": "total_column_water_vapour",
    "tcc": "total_cloud_cover",
    "100u": "100m_u_component_of_wind",
    "100v": "100m_v_component_of_wind",
    "sp": "surface_pressure",
    "lcc": "low_cloud_cover",
    "mcc": "medium_cloud_cover",
    "hcc": "high_cloud_cover",
    "skt": "skin_temperature",
    "stl1": "soil_temperature_level_1",
    "swvl1": "volumetric_soil_water_layer_1",
    "ci": "sea_ice_cover",
    "scaled_sd": "snow_depth",
}

# CDS variable names -> the short names xarray exposes in the downloaded NetCDF.
_ERA5_SURFACE = {
    "2m_temperature": "t2m",
    "10m_u_component_of_wind": "u10",
    "10m_v_component_of_wind": "v10",
    "mean_sea_level_pressure": "msl",
}
_ERA5_STATIC = {
    "geopotential": "z",
    "land_sea_mask": "lsm",
    "soil_type": "slt",
}
_ERA5_ATMOS = {
    "temperature": "t",
    "u_component_of_wind": "u",
    "v_component_of_wind": "v",
    "specific_humidity": "q",
    "geopotential": "z",
}


def build_initial_condition(config: Config) -> Batch:
    if config.initial_condition_source == "hres_t0":
        return _from_hres_t0_wb2(config)
    if config.initial_condition_source == "gfs":
        return _from_gfs(config)
    if config.initial_condition_source == "era5_arco":
        return _from_era5_arco(config)
    if config.initial_condition_source == "era5":
        return _from_era5(config)
    return _from_hres(config)


def _surface_names(config: Config) -> tuple[str, ...]:
    return _BASE_SURFACE + (_V1P5_EXTRA_SURFACE if config.is_v1p5 else ())


def _finish_v1p5_surface(
    surf_vars: dict[str, torch.Tensor],
    lat: np.ndarray,
    lon: np.ndarray,
    times: tuple[datetime, datetime],
) -> dict[str, torch.Tensor]:
    """Fill land/sea-masked fields and add the prescribed insolation channel."""
    from aurora.insolation import insolation

    out = dict(surf_vars)
    # GFS leaves soil temperature undefined over water; ERA5 carries ~skin temperature.
    out["stl1"] = torch.where(torch.isnan(out["stl1"]), out["skt"], out["stl1"])
    # Remaining masked fields (soil water, sea ice, snow) are absent -> 0, as in Aurora's demo.
    out = {name: torch.nan_to_num(value, nan=0.0) for name, value in out.items()}
    sol = insolation(
        list(times),
        np.asarray(lat, dtype="float32"),
        np.asarray(lon, dtype="float32"),
        enforce_2d=True,
    )
    out["insolation"] = torch.from_numpy(sol[None].astype("float32"))  # (1, 2, H, W)
    return out


# ---------------------------------------------------------------------------
# ERA5 via public Google ARCO-ERA5 — historical replays, no credentials
# ---------------------------------------------------------------------------


def _from_era5_arco(config: Config) -> Batch:
    import fsspec  # lazy: only the zarr paths need gcsfs/fsspec

    t0 = config.analysis_time.replace(tzinfo=None)
    t_prev = t0 - timedelta(hours=6)

    # Anonymous access skips gcsfs's credential probing, which costs ~12 s per read.
    mapper = fsspec.get_mapper(config.arco_era5_zarr_url, token="anon")
    dataset = xr.open_zarr(mapper, chunks=None)
    try:
        window = dataset.sel(time=[np.datetime64(t_prev), np.datetime64(t0)])
    except KeyError as exc:  # noqa: BLE001 - surface a clear, actionable message
        raise SystemExit(
            f"ARCO-ERA5 archive has no data for {t_prev}/{t0}. It covers 1940 to about "
            "one week ago; use INITIAL_CONDITION_SOURCE=gfs for more recent cycles."
        ) from exc

    lat = window["latitude"].values
    flip = lat[0] < lat[-1]  # Aurora wants latitudes descending.
    lat = lat[::-1] if flip else lat
    lon = window["longitude"].values

    def orient(values: np.ndarray) -> torch.Tensor:
        values = values[None]
        if flip:
            values = values[..., ::-1, :]
        return torch.from_numpy(values.copy().astype("float32"))

    surf_vars = {name: orient(window[_ARCO_SURFACE[name]].values) for name in _surface_names(config)}
    atmos_vars = {
        name: orient(window[_WB2_ATMOS[name]].sel(level=list(ATMOS_LEVELS)).values)
        for name in _WB2_ATMOS
    }
    if config.is_v1p5:
        surf_vars = _finish_v1p5_surface(surf_vars, lat, lon, (t_prev, t0))

    return Batch(
        surf_vars=surf_vars,
        static_vars=_load_static_pickle(config),
        atmos_vars=atmos_vars,
        metadata=Metadata(
            lat=torch.from_numpy(lat.copy().astype("float32")),
            lon=torch.from_numpy(lon.astype("float32")),
            time=(t0,),
            atmos_levels=ATMOS_LEVELS,
        ),
    )


# ---------------------------------------------------------------------------
# HRES T0 via public WeatherBench2 + HuggingFace static — default, no credentials
# ---------------------------------------------------------------------------


def _from_hres_t0_wb2(config: Config) -> Batch:
    import fsspec  # lazy: only the WB2 path needs gcsfs/fsspec

    t0 = config.analysis_time.replace(tzinfo=None)
    t_prev = t0 - timedelta(hours=6)

    dataset = xr.open_zarr(fsspec.get_mapper(config.wb2_zarr_url), chunks=None)
    try:
        window = dataset.sel(time=[np.datetime64(t_prev), np.datetime64(t0)])
    except KeyError as exc:  # noqa: BLE001 - surface a clear, actionable message
        raise SystemExit(
            f"WeatherBench2 archive {config.wb2_zarr_url} has no data for "
            f"{t_prev}/{t0}. Set ANALYSIS_TIME within the archive's range or point "
            "AURORA_WB2_ZARR_URL at a dataset that covers the requested time."
        ) from exc

    levels = tuple(int(level) for level in window["level"].values)
    if set(ATMOS_LEVELS) - set(levels):
        raise SystemExit(
            f"WeatherBench2 archive is missing required pressure levels; "
            f"needs {ATMOS_LEVELS}, has {levels}."
        )

    def surf(short: str) -> torch.Tensor:
        # (time, lat, lon) -> (1, time, lat, lon), latitudes flipped to descending.
        values = window[_WB2_SURFACE[short]].values
        return torch.from_numpy(values[None][..., ::-1, :].copy().astype("float32"))

    def atm(short: str) -> torch.Tensor:
        # (time, level, lat, lon) -> (1, time, level, lat, lon), lat descending.
        values = window[_WB2_ATMOS[short]].sel(level=list(ATMOS_LEVELS)).values
        return torch.from_numpy(values[None][..., ::-1, :].copy().astype("float32"))

    static_vars = _load_static_pickle(config)

    return Batch(
        surf_vars={name: surf(name) for name in _WB2_SURFACE},
        static_vars=static_vars,
        atmos_vars={name: atm(name) for name in _WB2_ATMOS},
        metadata=Metadata(
            lat=torch.from_numpy(window["latitude"].values[::-1].copy().astype("float32")),
            lon=torch.from_numpy(window["longitude"].values.astype("float32")),
            time=(t0,),
            atmos_levels=ATMOS_LEVELS,
        ),
    )


def _load_static_pickle(config: Config) -> dict:
    """Aurora's static variables for the chosen checkpoint, pre-regridded, from HuggingFace."""
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(repo_id=config.static_repo, filename=config.static_name)
    with open(path, "rb") as handle:
        raw = pickle.load(handle)
    required = {"z", "lsm"} if config.is_v1p5 else {"z", "lsm", "slt"}
    missing = required - set(raw)
    if missing:
        raise SystemExit(
            f"Static pickle {config.static_name} is missing variables {missing}."
        )
    return {key: torch.from_numpy(np.asarray(value)) for key, value in raw.items()}


# ---------------------------------------------------------------------------
# NOAA GFS 0.25 degree via public AWS Open Data — operational, real-time
# ---------------------------------------------------------------------------

# Standard gravity: GFS ships geopotential *height* (gh, metres); Aurora wants
# geopotential (m^2 s^-2) = gh * g.
_G0 = 9.80665

# .idx variable/level labels selected out of the full GFS message list.
_GFS_SURFACE_SELECT = {
    ("TMP", "2 m above ground"): "2t",
    ("UGRD", "10 m above ground"): "10u",
    ("VGRD", "10 m above ground"): "10v",
    ("PRMSL", "mean sea level"): "msl",
}
# Atmospheric fields to pull at each isobaric level (RH backs up SPFH up high).
_GFS_ATMOS_VARS = {"TMP", "UGRD", "VGRD", "SPFH", "HGT", "RH"}

# Extra f000 messages for Aurora 1.5. Each is fetched into its own GRIB file so it
# decodes without depending on eccodes short names for NCEP-local parameters.
_GFS_V1P5_SURFACE = {
    ("DPT", "2 m above ground"): "2d",
    ("PWAT", "entire atmosphere (considered as a single layer)"): "tcwv",
    ("TCDC", "entire atmosphere"): "tcc",
    ("UGRD", "100 m above ground"): "100u",
    ("VGRD", "100 m above ground"): "100v",
    ("PRES", "surface"): "sp",
    ("LCDC", "low cloud layer"): "lcc",
    ("MCDC", "middle cloud layer"): "mcc",
    ("HCDC", "high cloud layer"): "hcc",
    ("TMP", "surface"): "skt",
    ("TSOIL", "0-0.1 m below ground"): "stl1",
    ("SOILW", "0-0.1 m below ground"): "swvl1",
    ("ICEC", "surface"): "ci",
    ("WEASD", "surface"): "scaled_sd",
}
# GFS cloud covers are percent; Aurora (ECMWF convention) wants a 0-1 fraction.
_GFS_PERCENT = ("tcc", "lcc", "mcc", "hcc")


def _from_gfs(config: Config) -> Batch:
    t0 = config.analysis_time.replace(tzinfo=None)
    t_prev = t0 - timedelta(hours=6)

    prev = _gfs_state(config, t_prev)
    curr = _gfs_state(config, t0)
    if prev["lat"].shape != curr["lat"].shape or prev["lon"].shape != curr["lon"].shape:
        raise SystemExit("GFS cycles t0-6h and t0 have mismatched grids.")

    def surf(short: str) -> torch.Tensor:
        stacked = np.stack([prev["surf"][short], curr["surf"][short]], axis=0)
        return torch.from_numpy(stacked[None].astype("float32"))  # (1, 2, H, W)

    def atm(short: str) -> torch.Tensor:
        stacked = np.stack([prev["atmos"][short], curr["atmos"][short]], axis=0)
        return torch.from_numpy(stacked[None].astype("float32"))  # (1, 2, 13, H, W)

    static_vars = _load_static_pickle(config)
    surf_vars = {name: surf(name) for name in _surface_names(config)}
    if config.is_v1p5:
        surf_vars = _finish_v1p5_surface(surf_vars, curr["lat"], curr["lon"], (t_prev, t0))

    return Batch(
        surf_vars=surf_vars,
        static_vars=static_vars,
        atmos_vars={name: atm(name) for name in ("t", "u", "v", "q", "z")},
        metadata=Metadata(
            lat=torch.from_numpy(curr["lat"].astype("float32")),
            lon=torch.from_numpy(curr["lon"].astype("float32")),
            time=(t0,),
            atmos_levels=ATMOS_LEVELS,
        ),
    )


def _gfs_state(config: Config, cycle: datetime) -> dict:
    """Download and decode one GFS f000 analysis into plain numpy arrays."""
    url = _gfs_file_url(config, cycle)
    idx_text = _fetch_text(url + ".idx")
    grib_path = _download_gfs_subset(url, idx_text, cycle)
    extra_paths: dict[str, str] = {}
    try:
        if config.is_v1p5:
            extra_paths = _download_gfs_messages(url, idx_text, cycle)

        h2 = _open_gfs(grib_path, {"typeOfLevel": "heightAboveGround", "level": 2})
        h10 = _open_gfs(grib_path, {"typeOfLevel": "heightAboveGround", "level": 10})
        msl = _open_gfs(grib_path, {"typeOfLevel": "meanSea"})

        lat = np.asarray(msl["latitude"].values, dtype="float32")
        lon = np.asarray(msl["longitude"].values, dtype="float32")

        # Read each atmospheric field on its own so a variable that GFS ships on
        # fewer levels (SPFH) cannot break the decode of the fully-levelled ones.
        temperature = _iso_var(grib_path, "t")
        u_wind = _iso_var(grib_path, "u")
        v_wind = _iso_var(grib_path, "v")
        geo_height = _iso_var(grib_path, "gh")
        humidity = _gfs_specific_humidity(grib_path, temperature)

        atmos = {
            "t": temperature,
            "u": u_wind,
            "v": v_wind,
            "q": humidity,
            "z": geo_height * _G0,
        }
        for name in ("t", "u", "v", "z"):
            if not np.isfinite(atmos[name]).all():
                raise SystemExit(
                    f"GFS cycle {cycle:%Y-%m-%d %H}Z is missing '{name}' on one of "
                    f"the required levels {ATMOS_LEVELS}."
                )

        surf = {
            "2t": np.asarray(h2["t2m"].values, dtype="float32"),
            "10u": np.asarray(h10["u10"].values, dtype="float32"),
            "10v": np.asarray(h10["v10"].values, dtype="float32"),
            "msl": np.asarray(msl["prmsl"].values, dtype="float32"),
        }
        if extra_paths:
            extra = {short: _single_field(path) for short, path in extra_paths.items()}
            for short in _GFS_PERCENT:
                extra[short] = np.clip(extra[short] / 100.0, 0.0, 1.0)
            extra["scaled_sd"] = extra["scaled_sd"] / 1000.0  # kg m-2 -> m water equivalent
            surf.update(extra)
        return {"lat": lat, "lon": lon, "surf": surf, "atmos": atmos}
    finally:
        Path(grib_path).unlink(missing_ok=True)
        for path in extra_paths.values():
            Path(path).unlink(missing_ok=True)


def _single_field(path: str) -> np.ndarray:
    """Decode a one-message GRIB file into a (H, W) float32 array (NaN where masked)."""
    try:
        dataset = xr.open_dataset(path, engine="cfgrib", backend_kwargs={"indexpath": ""})
    except Exception as exc:  # noqa: BLE001 - GRIB decoding surfaces many error types
        raise SystemExit(f"Could not decode GFS GRIB message {path}: {exc}") from exc
    names = list(dataset.data_vars)
    if len(names) != 1:
        raise SystemExit(f"Expected one field in {path}, found {names}.")
    return np.asarray(dataset[names[0]].values, dtype="float32")


def _iso_var(path: str, short: str) -> np.ndarray:
    """One isobaric field reindexed onto Aurora's 13 levels (NaN where absent)."""
    dataset = _open_gfs(path, {"typeOfLevel": "isobaricInhPa", "shortName": short})
    dataset = dataset.reindex(isobaricInhPa=list(ATMOS_LEVELS))
    return np.asarray(dataset[short].values, dtype="float32")  # (13, H, W)


def _gfs_specific_humidity(grib_path: str, temperature: np.ndarray) -> np.ndarray:
    """Specific humidity on the 13 levels.

    GFS ships SPFH directly on the lower/mid levels but only relative humidity on
    the highest ones. Where SPFH is absent, derive it from RH and temperature so
    every value stays physically real rather than invented.
    """
    try:
        q = _iso_var(grib_path, "q")
    except SystemExit:
        q = np.full(temperature.shape, np.nan, dtype="float32")

    if not np.isfinite(q).all():
        rh = _iso_var(grib_path, "r")  # relative humidity, %
        levels = np.asarray(ATMOS_LEVELS, dtype="float32")
        pressure = (levels * 100.0)[:, None, None]  # Pa
        # Tetens saturation vapour pressure (over water), then mixing-ratio form.
        e_sat = 611.2 * np.exp(17.67 * (temperature - 273.15) / (temperature - 29.65))
        e = np.clip(rh, 0.0, 100.0) / 100.0 * e_sat
        q_from_rh = ((0.622 * e) / (pressure - 0.378 * e)).astype("float32")
        q = np.where(np.isfinite(q), q, q_from_rh)

    q = np.where(np.isfinite(q), q, 1e-6).astype("float32")
    return np.clip(q, 1e-9, None)


def _open_gfs(path: str, filter_by_keys: dict) -> xr.Dataset:
    try:
        return xr.open_dataset(
            path,
            engine="cfgrib",
            backend_kwargs={"filter_by_keys": filter_by_keys, "indexpath": ""},
        )
    except Exception as exc:  # noqa: BLE001 - GRIB decoding surfaces many error types
        raise SystemExit(
            f"Could not decode GFS GRIB with filter {filter_by_keys}: {exc}"
        ) from exc


def _gfs_file_url(config: Config, cycle: datetime) -> str:
    hh = f"{cycle.hour:02d}"
    ymd = cycle.strftime("%Y%m%d")
    fname = f"gfs.t{hh}z.pgrb2.0p25.f000"
    base = config.gfs_base_url.rstrip("/")
    # Layout gained an /atmos/ segment on 2021-03-22; try new then old.
    candidates = [
        f"{base}/gfs.{ymd}/{hh}/atmos/{fname}",
        f"{base}/gfs.{ymd}/{hh}/{fname}",
    ]
    return _first_reachable(candidates, cycle)


def _download_gfs_subset(url: str, idx_text: str, cycle: datetime) -> str:
    """Byte-range fetch only the messages Aurora needs into a local GRIB file."""
    return _write_ranges(url, _select_gfs_ranges(idx_text, cycle))


def _download_gfs_messages(url: str, idx_text: str, cycle: datetime) -> dict[str, str]:
    """Fetch each Aurora 1.5 extra surface message into its own GRIB file."""
    found: dict[str, tuple[int, int | None]] = {}
    for start, end, var, level in _parse_idx(idx_text):
        short = _GFS_V1P5_SURFACE.get((var, level))
        if short and short not in found:
            found[short] = (start, end)
    missing = set(_GFS_V1P5_SURFACE.values()) - set(found)
    if missing:
        raise SystemExit(
            f"GFS cycle {cycle:%Y-%m-%d %H}Z is missing Aurora 1.5 inputs {sorted(missing)}."
        )
    paths: dict[str, str] = {}
    try:
        for short, byte_range in found.items():
            paths[short] = _write_ranges(url, [byte_range])
    except Exception:
        for path in paths.values():
            Path(path).unlink(missing_ok=True)
        raise
    return paths


def _write_ranges(url: str, ranges: list[tuple[int, int | None]]) -> str:
    fd, tmp = tempfile.mkstemp(prefix="aurora-gfs-", suffix=".grib2")
    try:
        with open(fd, "wb") as out:
            for start, end in ranges:
                out.write(_fetch_range(url, start, end))
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise
    return tmp


def _parse_idx(idx_text: str) -> list[tuple[int, int | None, str, str]]:
    """GFS .idx lines -> (start, end, variable, level) byte ranges."""
    parsed: list[tuple[int, str, str]] = []
    for line in idx_text.splitlines():
        if not line.strip():
            continue
        fields = line.split(":")
        if len(fields) < 5:
            continue
        parsed.append((int(fields[1]), fields[3], fields[4]))  # start, var, level
    return [
        (start, parsed[i + 1][0] - 1 if i + 1 < len(parsed) else None, var, level)
        for i, (start, var, level) in enumerate(parsed)
    ]


def _select_gfs_ranges(idx_text: str, cycle: datetime) -> list[tuple[int, int | None]]:
    level_labels = {f"{lvl} mb" for lvl in ATMOS_LEVELS}
    selected = [
        (start, end)
        for start, end, var, level in _parse_idx(idx_text)
        if (var, level) in _GFS_SURFACE_SELECT
        or (var in _GFS_ATMOS_VARS and level in level_labels)
    ]
    if not selected:
        raise SystemExit(
            f"GFS index for {cycle:%Y-%m-%d %H}Z matched no required messages; "
            "the archive layout may have changed."
        )
    return selected


def _first_reachable(urls: list[str], cycle: datetime) -> str:
    for url in urls:
        request = urllib.request.Request(url + ".idx", method="HEAD")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                if response.status == 200:
                    return url
        except Exception:  # noqa: BLE001 - try the next candidate layout
            continue
    raise SystemExit(
        f"No GFS f000 file found for {cycle:%Y-%m-%d %H}Z at {urls[0]} "
        "(cycle may be too old for the 0.25-degree archive or not yet published)."
    )


def _fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def _fetch_range(url: str, start: int, end: int | None) -> bytes:
    byte_range = f"bytes={start}-" + ("" if end is None else str(end))
    request = urllib.request.Request(url, headers={"Range": byte_range})
    with urllib.request.urlopen(request, timeout=300) as response:
        return response.read()


# ---------------------------------------------------------------------------
# ERA5 (Copernicus CDS) — reference path
# ---------------------------------------------------------------------------


def _from_era5(config: Config) -> Batch:
    import cdsapi  # imported lazily so HRES users need not install it

    t0 = config.analysis_time
    t_prev = t0 - timedelta(hours=6)
    client = cdsapi.Client()

    with tempfile.TemporaryDirectory(prefix="aurora-era5-") as tmp:
        tmp_path = Path(tmp)
        surface_nc = tmp_path / "surface.nc"
        static_nc = tmp_path / "static.nc"
        atmos_nc = tmp_path / "atmospheric.nc"

        # Request both days and all synoptic hours, then select the two we need;
        # this is robust when t0-6h and t0 straddle midnight.
        days = sorted({t_prev.strftime("%Y-%m-%d"), t0.strftime("%Y-%m-%d")})
        hours = [f"{h:02d}:00" for h in (0, 6, 12, 18)]

        client.retrieve(
            "reanalysis-era5-single-levels",
            {
                "product_type": "reanalysis",
                "variable": list(_ERA5_SURFACE),
                "date": "/".join(days),
                "time": hours,
                "format": "netcdf",
            },
            str(surface_nc),
        )
        client.retrieve(
            "reanalysis-era5-single-levels",
            {
                "product_type": "reanalysis",
                "variable": list(_ERA5_STATIC),
                "date": t0.strftime("%Y-%m-%d"),
                "time": [t0.strftime("%H:00")],
                "format": "netcdf",
            },
            str(static_nc),
        )
        client.retrieve(
            "reanalysis-era5-pressure-levels",
            {
                "product_type": "reanalysis",
                "variable": list(_ERA5_ATMOS),
                "pressure_level": [str(level) for level in ATMOS_LEVELS],
                "date": "/".join(days),
                "time": hours,
                "format": "netcdf",
            },
            str(atmos_nc),
        )

        surface = xr.open_dataset(surface_nc, engine="netcdf4")
        static = xr.open_dataset(static_nc, engine="netcdf4")
        atmos = xr.open_dataset(atmos_nc, engine="netcdf4")

        i_prev, i_curr = _time_indices(surface, np.datetime64(t_prev), np.datetime64(t0))
        levels = tuple(int(level) for level in atmos["pressure_level"].values)
        _ensure_levels(levels)

        def surf(cds_name: str) -> torch.Tensor:
            var = surface[_ERA5_SURFACE[cds_name]].values
            return torch.from_numpy(var[[i_prev, i_curr]][None].astype("float32"))

        def stat(cds_name: str) -> torch.Tensor:
            return torch.from_numpy(static[_ERA5_STATIC[cds_name]].values[0].astype("float32"))

        def atm(cds_name: str) -> torch.Tensor:
            var = atmos[_ERA5_ATMOS[cds_name]].values
            return torch.from_numpy(var[[i_prev, i_curr]][None].astype("float32"))

        return Batch(
            surf_vars={
                "2t": surf("2m_temperature"),
                "10u": surf("10m_u_component_of_wind"),
                "10v": surf("10m_v_component_of_wind"),
                "msl": surf("mean_sea_level_pressure"),
            },
            static_vars={
                "z": stat("geopotential"),
                "lsm": stat("land_sea_mask"),
                "slt": stat("soil_type"),
            },
            atmos_vars={
                "t": atm("temperature"),
                "u": atm("u_component_of_wind"),
                "v": atm("v_component_of_wind"),
                "q": atm("specific_humidity"),
                "z": atm("geopotential"),
            },
            metadata=Metadata(
                lat=torch.from_numpy(surface["latitude"].values.astype("float32")),
                lon=torch.from_numpy(surface["longitude"].values.astype("float32")),
                time=(t0.replace(tzinfo=None),),
                atmos_levels=levels,
            ),
        )


def _time_indices(
    dataset: xr.Dataset, t_prev: np.datetime64, t0: np.datetime64
) -> tuple[int, int]:
    time_name = "valid_time" if "valid_time" in dataset.coords else "time"
    times = dataset[time_name].values.astype("datetime64[s]")

    def index_of(target: np.datetime64) -> int:
        matches = np.where(times == target.astype("datetime64[s]"))[0]
        if matches.size == 0:
            raise SystemExit(f"Initial-condition data is missing time step {target}.")
        return int(matches[0])

    return index_of(t_prev), index_of(t0)


def _ensure_levels(levels: tuple[int, ...]) -> None:
    if tuple(levels) != ATMOS_LEVELS:
        raise SystemExit(
            "Initial conditions must provide exactly Aurora's 13 pressure levels "
            f"{ATMOS_LEVELS}; got {levels}."
        )


# ---------------------------------------------------------------------------
# HRES GRIB — operational path
# ---------------------------------------------------------------------------


def _from_hres(config: Config) -> Batch:
    assert config.hres_input_dir is not None
    directory = Path(config.hres_input_dir)
    if not directory.is_dir():
        raise SystemExit(f"HRES_INPUT_DIR does not exist: {directory}")

    surface = _open_grib(directory, filter_keys={"typeOfLevel": "surface"})
    single = _open_grib(directory, filter_keys={"typeOfLevel": "heightAboveGround"})
    msl = _open_grib(directory, filter_keys={"typeOfLevel": "meanSea"})
    atmos = _open_grib(directory, filter_keys={"typeOfLevel": "isobaricInhPa"})

    t0 = config.analysis_time
    t_prev = t0 - timedelta(hours=6)
    i_prev, i_curr = _time_indices(atmos, np.datetime64(t_prev), np.datetime64(t0))

    atmos = atmos.sel(isobaricInhPa=list(ATMOS_LEVELS))
    _ensure_levels(tuple(int(level) for level in atmos["isobaricInhPa"].values))

    def two_step(dataset: xr.Dataset, name: str) -> torch.Tensor:
        return torch.from_numpy(
            dataset[name].values[[i_prev, i_curr]][None].astype("float32")
        )

    return Batch(
        surf_vars={
            "2t": two_step(single, "t2m"),
            "10u": two_step(single, "u10"),
            "10v": two_step(single, "v10"),
            "msl": two_step(msl, "msl"),
        },
        static_vars={
            "z": torch.from_numpy(surface["z"].values.astype("float32")),
            "lsm": torch.from_numpy(surface["lsm"].values.astype("float32")),
            "slt": torch.from_numpy(surface["slt"].values.astype("float32")),
        },
        atmos_vars={
            "t": two_step(atmos, "t"),
            "u": two_step(atmos, "u"),
            "v": two_step(atmos, "v"),
            "q": two_step(atmos, "q"),
            "z": two_step(atmos, "z"),
        },
        metadata=Metadata(
            lat=torch.from_numpy(atmos["latitude"].values.astype("float32")),
            lon=torch.from_numpy(atmos["longitude"].values.astype("float32")),
            time=(t0.replace(tzinfo=None),),
            atmos_levels=tuple(int(level) for level in atmos["isobaricInhPa"].values),
        ),
    )


def _open_grib(directory: Path, filter_keys: dict[str, str]) -> xr.Dataset:
    files = sorted(str(p) for p in directory.glob("*.grib")) + sorted(
        str(p) for p in directory.glob("*.grib2")
    )
    if not files:
        raise SystemExit(f"No .grib/.grib2 files found in {directory}.")
    try:
        return xr.open_mfdataset(
            files,
            engine="cfgrib",
            combine="nested",
            concat_dim="time",
            backend_kwargs={"filter_by_keys": filter_keys, "indexpath": ""},
        )
    except Exception as exc:  # noqa: BLE001 - GRIB decoding surfaces many error types
        raise SystemExit(
            f"Could not read HRES GRIB with filter {filter_keys}: {exc}"
        ) from exc
