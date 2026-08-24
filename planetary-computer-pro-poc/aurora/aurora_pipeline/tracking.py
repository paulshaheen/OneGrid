"""Detect tropical-cyclone *seeds* in Aurora's initial-condition field.

The propagation itself is done by Aurora's own :class:`aurora.Tracker` (the
algorithm from the Nature paper), which tracks a *single, already-located* storm
forward. It has no genesis detection, so this module supplies that missing piece:
it scans a surface field for mean-sea-level-pressure minima that (a) sit below a
pressure threshold, (b) are a local minimum in a neighbourhood, and (c) coincide
with a 10 m wind maximum above tropical-storm strength. Each surviving centre
seeds one official tracker in :mod:`aurora_pipeline.inference`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from .config import BBox
from .inference import ForecastField

# Detection thresholds. Tropical-storm strength is ~17 m/s sustained wind; a
# tropical low is typically below ~1005 hPa. These are deliberately permissive so
# developing systems are caught early, then filtered by track quality.
_PRESSURE_THRESHOLD_PA = 1005_00.0  # 1005 hPa in Pa
_WIND_THRESHOLD_MS = 17.0
_NEIGHBOURHOOD_DEG = 2.0  # half-width of the local-minimum / wind search window
_MIN_CENTRE_SEPARATION_KM = 300.0
_MIN_TRACK_POINTS = 2

EARTH_RADIUS_KM = 6371.0


@dataclass(frozen=True)
class Centre:
    lead_hours: int
    lat: float
    lon: float  # -180..180
    pressure_hpa: float
    wind_ms: float


Track = list[Centre]


def find_centres(field: ForecastField, bbox: BBox) -> list[Centre]:
    """Genesis detection: locate cyclone centres in a single surface field."""
    lon180 = _to_180(field.lon)
    lat_mask = (field.lat >= bbox.min_lat) & (field.lat <= bbox.max_lat)
    lon_mask = (lon180 >= bbox.min_lon) & (lon180 <= bbox.max_lon)
    lat_idx = np.where(lat_mask)[0]
    lon_idx = np.where(lon_mask)[0]
    if lat_idx.size == 0 or lon_idx.size == 0:
        return []

    sub_msl = field.msl[np.ix_(lat_idx, lon_idx)]
    sub_wind = field.wind10[np.ix_(lat_idx, lon_idx)]
    sub_lat = field.lat[lat_idx]
    sub_lon = lon180[lon_idx]

    # Grid resolution in cells for the neighbourhood window.
    dlat = abs(float(sub_lat[1] - sub_lat[0])) if sub_lat.size > 1 else 0.25
    radius = max(1, int(round(_NEIGHBOURHOOD_DEG / max(dlat, 1e-6))))

    local_min = _windowed(sub_msl, radius, np.min)
    wind_max = _windowed(sub_wind, radius, np.max)

    candidate = (
        (sub_msl == local_min)
        & (sub_msl < _PRESSURE_THRESHOLD_PA)
        & (wind_max >= _WIND_THRESHOLD_MS)
    )

    rows, cols = np.where(candidate)
    raw = [
        Centre(
            lead_hours=field.lead_hours,
            lat=float(sub_lat[r]),
            lon=float(sub_lon[c]),
            pressure_hpa=float(sub_msl[r, c]) / 100.0,
            wind_ms=float(wind_max[r, c]),
        )
        for r, c in zip(rows.tolist(), cols.tolist())
    ]
    return _deduplicate(raw)


def _windowed(grid: np.ndarray, radius: int, reducer) -> np.ndarray:
    window = 2 * radius + 1
    padded = np.pad(grid, radius, mode="edge")
    view = sliding_window_view(padded, (window, window))
    return reducer(view, axis=(2, 3))


def _deduplicate(centres: list[Centre]) -> list[Centre]:
    # Keep the deepest (lowest-pressure) centre when several are within the
    # minimum separation — avoids reporting one storm as several.
    kept: list[Centre] = []
    for centre in sorted(centres, key=lambda c: c.pressure_hpa):
        if all(
            _haversine_km(centre.lat, centre.lon, k.lat, k.lon) >= _MIN_CENTRE_SEPARATION_KM
            for k in kept
        ):
            kept.append(centre)
    return kept


def is_valid_track(track: Track) -> bool:
    if len(track) < _MIN_TRACK_POINTS:
        return False
    return min(c.pressure_hpa for c in track) < 1005.0


def _to_180(lon: np.ndarray) -> np.ndarray:
    return ((lon + 180.0) % 360.0) - 180.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    a = min(1.0, max(0.0, a))
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))
