"""Environment-driven configuration for the Aurora forecast pipeline.

Every value comes from the environment (or an adjacent ``.env`` loaded by the
caller) so the same code runs locally, in a container job, or in an AML pipeline
without edits. :func:`load_config` validates the combination up front and fails
with an actionable message rather than deep in an Azure SDK call.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone

log = logging.getLogger("aurora_pipeline")

# Aurora's fine-tuned 0.25-degree model expects these 13 pressure levels, in hPa.
ATMOS_LEVELS: tuple[int, ...] = (
    1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50,
)

# Most recent synoptic hours that ECMWF produces analyses/forecasts for.
SYNOPTIC_HOURS: tuple[int, ...] = (0, 6, 12, 18)

# Public WeatherBench2 archive of IFS HRES T0 at 0.25 degrees (no credentials).
DEFAULT_WB2_ZARR = "gs://weatherbench2/datasets/hres_t0/2016-2022-6h-1440x721.zarr"
# Public Google ARCO-ERA5 reanalysis at 0.25 degrees, hourly, 1940 -> ~1 week ago
# (no credentials). Carries every Aurora 1.5 input, unlike the HRES T0 archive.
DEFAULT_ARCO_ERA5_ZARR = "gs://gcp-public-data-arco-era5/ar/full_37-1h-0p25deg-chunk-1.zarr-v3"
# Public NOAA GFS 0.25-degree archive on AWS Open Data (anonymous, no credentials).
# Operational analyses/forecasts, refreshed every 6 h, back to 2021-02-26.
DEFAULT_GFS_BASE_URL = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
# Aurora's own static variables, hosted on HuggingFace (no credentials).
DEFAULT_STATIC_REPO = "microsoft/aurora"
DEFAULT_STATIC_NAME = "aurora-0.25-static.pickle"
V1P5_STATIC_NAME = "aurora-0.25-v1.5-static.pickle"
# NOAA IBTrACS per-basin CSVs (NHC best track for NA/EP), refreshed weekly, no credentials.
DEFAULT_BEST_TRACK_URL_TEMPLATE = (
    "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/"
    "v04r01/access/csv/ibtracs.{basin}.list.v04r01.csv"
)

# Aurora 1.5 checkpoints (Foundry "Aurora-1.5" deployment). They need 18 surface
# variables + insolation and 36 static fields, so only sources that carry the full
# set (GFS, ARCO-ERA5) can drive them.
V1P5_MODELS = frozenset({"aurora-0.25-v1.5", "aurora-0.25-v1.5-ensemble"})
_V1P5_SOURCES = frozenset({"gfs", "era5_arco"})

# Default checkpoint per initial-condition source. hres_t0/hres/era5 only carry the
# original 4 surface variables and need the original Foundry "Aurora" deployment.
_MODEL_FOR_SOURCE = {
    "gfs": "aurora-0.25-v1.5",
    "era5_arco": "aurora-0.25-v1.5",
    "hres_t0": "aurora-0.25-finetuned",
    "hres": "aurora-0.25-finetuned",
    "era5": "aurora-0.25-pretrained",
}


@dataclass(frozen=True)
class BBox:
    """Detection domain in degrees. Longitudes use the -180..180 convention."""

    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    def contains(self, lon: float, lat: float) -> bool:
        return (
            self.min_lon <= lon <= self.max_lon
            and self.min_lat <= lat <= self.max_lat
        )


@dataclass(frozen=True)
class Config:
    endpoint: str
    # Endpoint bearer token. Empty means "acquire one from the managed identity"
    # (the scheduled-job path); a non-empty value is used as-is (local/manual runs).
    endpoint_token: str
    model_name: str
    num_steps: int

    # Blob channel the endpoint uses for scratch. Either an explicit read/write
    # SAS URL, or an account URL + container to mint a user-delegation SAS from.
    blob_channel_url: str | None
    blob_account_url: str | None
    blob_container: str | None

    initial_condition_source: str
    hres_input_dir: str | None
    wb2_zarr_url: str
    arco_era5_zarr_url: str
    gfs_base_url: str
    static_repo: str
    static_name: str
    analysis_time: datetime

    detection_bbox: BBox

    # Optional operator-supplied names for detected systems, in intensity order
    # (strongest first). Aurora only detects systems by genesis, so any official
    # name is a label the operator attaches, not something the model infers.
    storm_names: tuple[str, ...]

    output_container_url: str | None
    output_sas_url: str | None
    output_blob_name: str

    # A replay pins an explicit past ANALYSIS_TIME; scheduled cycles leave it unset.
    is_replay: bool
    # How long an empty scheduled cycle leaves a published replay on screen.
    replay_pin_hours: int

    # Replays take wind/pressure from the observed best track ("observed") or keep
    # Aurora's under-resolved 0.25-degree intensity ("model").
    replay_intensity: str
    best_track_url_template: str
    best_track_basins: tuple[str, ...]

    @property
    def horizon_hours(self) -> int:
        return self.num_steps * 6

    @property
    def is_v1p5(self) -> bool:
        return self.model_name in V1P5_MODELS


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def _parse_bbox(raw: str) -> BBox:
    parts = [p.strip() for p in raw.split(",")]
    if len(parts) != 4:
        raise SystemExit("DETECTION_BBOX must be 'minLon,minLat,maxLon,maxLat'.")
    try:
        min_lon, min_lat, max_lon, max_lat = (float(p) for p in parts)
    except ValueError as exc:  # noqa: BLE001 - surface a clear config error
        raise SystemExit(f"DETECTION_BBOX values must be numbers: {exc}") from exc
    if min_lon >= max_lon or min_lat >= max_lat:
        raise SystemExit("DETECTION_BBOX must have min < max for both lon and lat.")
    return BBox(min_lon, min_lat, max_lon, max_lat)


def _default_analysis_time(now: datetime | None = None) -> datetime:
    """Most recent synoptic cycle at least 6 h in the past (data latency buffer)."""
    now = now or datetime.now(timezone.utc)
    candidate = now.replace(minute=0, second=0, microsecond=0)
    # Step back to a synoptic hour, then one extra cycle for availability.
    while candidate.hour not in SYNOPTIC_HOURS:
        candidate = candidate.replace(hour=candidate.hour - 1)
    from datetime import timedelta

    return candidate - timedelta(hours=6)


def _parse_analysis_time(raw: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as exc:  # noqa: BLE001
        raise SystemExit(f"ANALYSIS_TIME is not ISO-8601: {exc}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    if parsed.hour not in SYNOPTIC_HOURS:
        raise SystemExit("ANALYSIS_TIME hour must be one of 00, 06, 12, 18 UTC.")
    return parsed


def load_config() -> Config:
    source = os.environ.get("INITIAL_CONDITION_SOURCE", "gfs").strip().lower()
    if source not in _MODEL_FOR_SOURCE:
        raise SystemExit(
            "INITIAL_CONDITION_SOURCE must be 'gfs' (default, public NOAA GFS, "
            "2021 -> now), 'era5_arco' (public ARCO-ERA5, 1940 -> ~1 week ago), "
            "'hres_t0' (public WeatherBench2), 'hres' (local GRIB), or 'era5' (CDS)."
        )

    hres_dir = os.environ.get("HRES_INPUT_DIR", "").strip() or None
    if source == "hres" and not hres_dir:
        raise SystemExit("HRES_INPUT_DIR is required when INITIAL_CONDITION_SOURCE=hres.")

    analysis_raw = os.environ.get("ANALYSIS_TIME", "").strip()
    analysis_time = (
        _parse_analysis_time(analysis_raw) if analysis_raw else _default_analysis_time()
    )

    num_steps = int(os.environ.get("AURORA_NUM_STEPS", "20"))
    if num_steps < 1 or num_steps > 60:
        raise SystemExit("AURORA_NUM_STEPS must be between 1 and 60.")

    # Default the checkpoint to the one valid for the chosen source; warn loudly
    # if the operator forces the fine-tuned model onto ERA5 (or vice versa).
    model_name = os.environ.get("AURORA_MODEL_NAME", "").strip() or _MODEL_FOR_SOURCE[source]
    if model_name != _MODEL_FOR_SOURCE[source]:
        log.warning(
            "AURORA_MODEL_NAME=%s is not the recommended checkpoint for source '%s' "
            "(expected %s); predictions may be degraded.",
            model_name, source, _MODEL_FOR_SOURCE[source],
        )
    if model_name in V1P5_MODELS and source not in _V1P5_SOURCES:
        raise SystemExit(
            f"{model_name} needs Aurora 1.5's 18 surface variables, which source "
            f"'{source}' does not carry. Use INITIAL_CONDITION_SOURCE=gfs (2021 -> now) "
            "or era5_arco (1940 -> ~1 week ago)."
        )
    default_static = V1P5_STATIC_NAME if model_name in V1P5_MODELS else DEFAULT_STATIC_NAME

    output_container = os.environ.get("OUTPUT_CONTAINER_URL", "").strip() or None
    output_sas = os.environ.get("OUTPUT_SAS_URL", "").strip() or None
    if not output_container and not output_sas:
        raise SystemExit("Set OUTPUT_CONTAINER_URL (managed identity) or OUTPUT_SAS_URL.")

    # The endpoint needs a read/write blob channel. Accept either an explicit SAS
    # URL or an account URL + container from which we mint a short-lived
    # user-delegation SAS using the job's managed identity.
    blob_channel_url = os.environ.get("AURORA_BLOB_CHANNEL_URL", "").strip() or None
    blob_account_url = os.environ.get("AURORA_BLOB_ACCOUNT_URL", "").strip() or None
    blob_container = os.environ.get("AURORA_BLOB_CONTAINER", "").strip() or None
    if not blob_channel_url and not (blob_account_url and blob_container):
        raise SystemExit(
            "Set AURORA_BLOB_CHANNEL_URL (read/write SAS), or "
            "AURORA_BLOB_ACCOUNT_URL + AURORA_BLOB_CONTAINER to mint one automatically."
        )

    return Config(
        endpoint=_require("AURORA_ENDPOINT"),
        endpoint_token=os.environ.get("AURORA_ENDPOINT_TOKEN", "").strip(),
        model_name=model_name,
        num_steps=num_steps,
        blob_channel_url=blob_channel_url,
        blob_account_url=blob_account_url,
        blob_container=blob_container,
        initial_condition_source=source,
        hres_input_dir=hres_dir,
        wb2_zarr_url=os.environ.get("AURORA_WB2_ZARR_URL", "").strip() or DEFAULT_WB2_ZARR,
        arco_era5_zarr_url=(
            os.environ.get("AURORA_ARCO_ERA5_ZARR_URL", "").strip() or DEFAULT_ARCO_ERA5_ZARR
        ),
        gfs_base_url=os.environ.get("AURORA_GFS_BASE_URL", "").strip() or DEFAULT_GFS_BASE_URL,
        static_repo=os.environ.get("AURORA_STATIC_REPO", "").strip() or DEFAULT_STATIC_REPO,
        static_name=os.environ.get("AURORA_STATIC_NAME", "").strip() or default_static,
        analysis_time=analysis_time,
        detection_bbox=_parse_bbox(os.environ.get("DETECTION_BBOX", "-100,15,-70,35")),
        storm_names=tuple(
            n.strip() for n in os.environ.get("STORM_NAMES", "").split(",") if n.strip()
        ),
        output_container_url=output_container,
        output_sas_url=output_sas,
        output_blob_name=os.environ.get("OUTPUT_BLOB_NAME", "weather-events.json").strip(),
        is_replay=bool(analysis_raw),
        replay_pin_hours=int(os.environ.get("REPLAY_PIN_HOURS", "24")),
        replay_intensity=_parse_replay_intensity(os.environ.get("REPLAY_INTENSITY", "observed")),
        best_track_url_template=(
            os.environ.get("AURORA_BEST_TRACK_URL_TEMPLATE", "").strip()
            or DEFAULT_BEST_TRACK_URL_TEMPLATE
        ),
        best_track_basins=tuple(
            b.strip().upper()
            for b in os.environ.get("AURORA_BEST_TRACK_BASINS", "NA,EP").split(",")
            if b.strip()
        ),
    )


def _parse_replay_intensity(raw: str) -> str:
    value = raw.strip().lower()
    if value not in ("observed", "model"):
        raise SystemExit("REPLAY_INTENSITY must be 'observed' or 'model'.")
    return value
