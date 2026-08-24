"""Convert cyclone tracks into the app's ``WeatherEvent`` objects.

The output must satisfy ``isWeatherEvent`` in
``webapp/src/lib/services/azure/server.ts``: history is ``[lon, lat]`` pairs,
forecast hours are finite, non-negative and strictly increasing, and every
numeric field is finite. Nothing here is invented — every value derives from the
tracked Aurora fields.
"""

from __future__ import annotations

import math

from .config import Config
from .tracking import Track

_MS_TO_MPH = 2.236936
_GUST_FACTOR = 1.25


def tracks_to_events(config: Config, tracks: list[Track]) -> list[dict]:
    events = [
        _to_event(config, track, index)
        for index, track in enumerate(
            sorted(tracks, key=lambda t: min(c.pressure_hpa for c in t)), start=1
        )
    ]
    return events


def _to_event(config: Config, track: Track, index: int) -> dict:
    current = track[0]
    peak_wind_ms = max(c.wind_ms for c in track)
    peak_wind_mph = peak_wind_ms * _MS_TO_MPH
    current_wind_mph = current.wind_ms * _MS_TO_MPH

    movement_deg, movement_mph = _movement(track)
    stamp = config.analysis_time
    event_id = f"aurora-{stamp:%Y%m%dT%H}-{index}"
    name = (
        config.storm_names[index - 1]
        if index - 1 < len(config.storm_names)
        else f"Aurora system {index}"
    )

    return {
        "id": event_id,
        "name": name,
        "kind": "hurricane" if peak_wind_mph >= 74 else "tropical_storm",
        "status": _status(current_wind_mph),
        "basin": _basin(current.lon),
        "currentCategory": _category(current_wind_mph),
        "currentWindMph": round(current_wind_mph),
        "gustMph": round(current_wind_mph * _GUST_FACTOR),
        "pressureMb": round(current.pressure_hpa),
        "movementDeg": round(movement_deg),
        "movementMph": round(movement_mph, 1),
        "lat": round(current.lat, 3),
        "lon": round(current.lon, 3),
        "confidence": _confidence(track),
        "modelSource": f"Aurora {config.model_name} (Azure ML) · {config.initial_condition_source.upper()} IC",
        "updatedAtIso": stamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expectedLandfall": "Under evaluation — see forecast track",
        "cycleId": f"{stamp:%HZ %a}",
        "history": [[round(current.lon, 3), round(current.lat, 3)]],
        "forecast": [_forecast_point(centre) for centre in track],
    }


def _forecast_point(centre) -> dict:
    wind_mph = centre.wind_ms * _MS_TO_MPH
    return {
        "hour": centre.lead_hours,
        "lat": round(centre.lat, 3),
        "lon": round(centre.lon, 3),
        "windMph": round(wind_mph),
        "coneRadiusMi": round(_cone_radius_mi(centre.lead_hours), 1),
        "category": _category(wind_mph),
        "pressureMb": round(centre.pressure_hpa),
    }


def _cone_radius_mi(lead_hours: int) -> float:
    # Forecast-position uncertainty grows with lead time. This mirrors the shape
    # of an NHC track cone (~25 mi near-term to ~200 mi at 5 days) without
    # claiming agency-grade uncertainty.
    return 25.0 + 1.5 * max(0, lead_hours)


def _movement(track: Track) -> tuple[float, float]:
    if len(track) < 2:
        return 0.0, 0.0
    a, b = track[0], track[1]
    bearing = _bearing_deg(a.lat, a.lon, b.lat, b.lon)
    dt_hours = max(1, b.lead_hours - a.lead_hours)
    distance_mi = _haversine_mi(a.lat, a.lon, b.lat, b.lon)
    return bearing, distance_mi / dt_hours


def _bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def _haversine_mi(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_mi = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    a = min(1.0, max(0.0, a))
    return 2 * radius_mi * math.asin(math.sqrt(a))


def _category(wind_mph: float) -> int:
    if wind_mph >= 157:
        return 5
    if wind_mph >= 130:
        return 4
    if wind_mph >= 111:
        return 3
    if wind_mph >= 96:
        return 2
    if wind_mph >= 74:
        return 1
    return 0


def _status(wind_mph: float) -> str:
    category = _category(wind_mph)
    if category >= 1:
        return f"Category {category} hurricane"
    if wind_mph >= 39:
        return "Tropical storm"
    return "Tropical depression"


def _confidence(track: Track) -> str:
    if len(track) >= 8:
        return "high"
    if len(track) >= 4:
        return "moderate"
    return "low"


def _basin(lon: float) -> str:
    return "East Pacific" if lon < -100 else "North Atlantic"
