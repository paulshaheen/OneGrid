"""Observed intensity for historical replays, from NOAA IBTrACS (NHC best track).

Aurora's 0.25-degree grid resolves a tropical cyclone's *track* but not its eyewall,
so peak winds come out far too low (Laura 2020: Aurora 62 mph vs 150 mph observed,
988 vs 938 hPa). For a replay of a past storm the observed record exists, so the
published event keeps Aurora's forecast positions and takes wind and pressure from
the best track at the same valid times. Points outside the best-track record keep
Aurora's values, and every point records which source its intensity came from.
"""

from __future__ import annotations

import dataclasses
import io
import logging
import math
import urllib.request
from datetime import datetime

import numpy as np
import pandas as pd

from .config import Config
from .tracking import Track

log = logging.getLogger("aurora_pipeline")

_KT_TO_MS = 0.514444
# An Aurora analysis-time centre within this distance of a best-track fix is that storm.
_MATCH_RADIUS_KM = 400.0
_COLUMNS = ["SID", "SEASON", "NAME", "ISO_TIME", "USA_LAT", "USA_LON", "USA_WIND", "USA_PRES"]


def apply_observed_intensity(config: Config, tracks: list[Track]) -> list[Track]:
    if not tracks:
        return tracks
    try:
        frame = _load(config, config.analysis_time.year)
    except Exception as exc:  # noqa: BLE001 - never lose the forecast over the overlay
        log.warning("Best-track download failed (%s); keeping Aurora intensity.", exc)
        return tracks

    out: list[Track] = []
    for track in tracks:
        storm = _match(frame, track, config.analysis_time)
        out.append(track if storm is None else _overlay(track, storm, config.analysis_time))
    return out


def _load(config: Config, year: int) -> pd.DataFrame:
    frames = []
    for basin in config.best_track_basins:
        url = config.best_track_url_template.format(basin=basin)
        with urllib.request.urlopen(url, timeout=300) as response:
            raw = response.read()
        # Row 2 is a units row, blanks are single spaces.
        frame = pd.read_csv(
            io.BytesIO(raw), skiprows=[1], usecols=_COLUMNS, keep_default_na=False, low_memory=False
        )
        frames.append(frame)
    frame = pd.concat(frames, ignore_index=True)
    for column in ("SEASON", "USA_LAT", "USA_LON", "USA_WIND", "USA_PRES"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    # A storm can straddle the year boundary; keep both seasons around the analysis.
    frame = frame[frame["SEASON"].between(year - 1, year + 1)]
    frame = frame.dropna(subset=["USA_LAT", "USA_LON", "USA_WIND"])
    frame["time"] = pd.to_datetime(frame["ISO_TIME"], utc=True)
    return frame


def _match(frame: pd.DataFrame, track: Track, analysis_time: datetime) -> pd.DataFrame | None:
    t0 = pd.Timestamp(analysis_time)
    near = frame[(frame["time"] - t0).abs() <= pd.Timedelta(hours=3)]
    if near.empty:
        return None
    seed = track[0]
    distances = _haversine_km(near["USA_LAT"].to_numpy(), near["USA_LON"].to_numpy(), seed.lat, seed.lon)
    best = int(np.argmin(distances))
    if distances[best] > _MATCH_RADIUS_KM:
        log.info("No best-track storm within %.0f km of the Aurora centre; keeping Aurora intensity.", _MATCH_RADIUS_KM)
        return None
    sid = near["SID"].iloc[best]
    storm = frame[frame["SID"] == sid].sort_values("time")
    log.info(
        "Observed intensity from best track %s (%s), %.0f km from Aurora's analysis centre.",
        sid, storm["NAME"].iloc[0], distances[best],
    )
    return storm


def _overlay(track: Track, storm: pd.DataFrame, analysis_time: datetime) -> Track:
    hours = (storm["time"] - pd.Timestamp(analysis_time)).dt.total_seconds().to_numpy() / 3600.0
    wind_ms = storm["USA_WIND"].to_numpy() * _KT_TO_MS
    pressure = storm["USA_PRES"].to_numpy()
    has_pressure = ~np.isnan(pressure)

    out: Track = []
    for centre in track:
        h = centre.lead_hours
        if not hours[0] <= h <= hours[-1]:
            out.append(centre)
            continue
        pressure_hpa = (
            float(np.interp(h, hours[has_pressure], pressure[has_pressure]))
            if has_pressure.any()
            else centre.pressure_hpa
        )
        out.append(
            dataclasses.replace(
                centre,
                wind_ms=float(np.interp(h, hours, wind_ms)),
                pressure_hpa=pressure_hpa,
                intensity_source="observed",
            )
        )
    return out


def _haversine_km(lat1: np.ndarray, lon1: np.ndarray, lat2: float, lon2: float) -> np.ndarray:
    p1, p2 = np.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlmb = math.radians(lon2) - np.radians(lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * math.cos(p2) * np.sin(dlmb / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))
