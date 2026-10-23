"""Official storm reference from the National Hurricane Center (NHC).

Aurora's genesis detection (:mod:`aurora_pipeline.tracking`) finds any deep surface
low with tropical-storm-force winds, which includes strong mid-latitude
(extratropical) lows that are not tropical cyclones. NHC's ``CurrentStorms.json``
lists the systems it is actively advising on in the Atlantic and East/Central
Pacific, so it is used to:

* keep only detected systems that correspond to an NHC-tracked storm, and
* label each one with its official name by position (not by detection rank,
  which changes from cycle to cycle).

Only names and positions are taken from NHC. Intensity, pressure and the forecast
track remain Aurora's. When the feed cannot be reached the caller falls back to a
tropical-latitude filter so a network hiccup never publishes extratropical lows.
Standard library only, so it adds no dependencies to the job image.
"""

from __future__ import annotations

import json
import logging
import math
import urllib.request
from dataclasses import dataclass
from typing import Iterable, Protocol, TypeVar

log = logging.getLogger("aurora_pipeline.nhc")

DEFAULT_NHC_URL = "https://www.nhc.noaa.gov/CurrentStorms.json"
_EARTH_RADIUS_KM = 6371.0


@dataclass(frozen=True)
class NhcStorm:
    id: str
    name: str
    classification: str
    lat: float
    lon: float  # -180..180
    wind_kt: float | None
    pressure_mb: float | None


class _HasPosition(Protocol):
    lat: float
    lon: float


T = TypeVar("T", bound=_HasPosition)


def fetch_active_storms(url: str = DEFAULT_NHC_URL, timeout: float = 20.0) -> list[NhcStorm] | None:
    """Return NHC's active storms, an empty list when there are none, or ``None``
    when the feed could not be read (so callers can fall back)."""
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "onegrid-aurora-pipeline"})
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - fixed https URL
            payload = json.load(response)
    except Exception as exc:  # noqa: BLE001 - any failure means "feed unavailable"
        log.warning("NHC active-storm feed unavailable (%s): %s", url, exc)
        return None
    storms: list[NhcStorm] = []
    for raw in payload.get("activeStorms") or []:
        try:
            storms.append(
                NhcStorm(
                    id=str(raw.get("id", "")),
                    name=str(raw.get("name", "")).strip(),
                    classification=str(raw.get("classification", "")),
                    lat=_coord(raw.get("latitudeNumeric"), raw.get("latitude")),
                    lon=_coord(raw.get("longitudeNumeric"), raw.get("longitude")),
                    wind_kt=_number(raw.get("intensity")),
                    pressure_mb=_number(raw.get("pressure")),
                )
            )
        except ValueError as exc:
            log.warning("Skipping unparseable NHC storm entry %s: %s", raw.get("id"), exc)
    log.info(
        "NHC is tracking %d storm(s): %s",
        len(storms),
        ", ".join(f"{s.name} ({s.lat:.1f}, {s.lon:.1f})" for s in storms) or "none",
    )
    return storms


def nearest(lat: float, lon: float, storms: Iterable[NhcStorm], max_km: float) -> NhcStorm | None:
    """The official storm closest to ``(lat, lon)`` within ``max_km``, if any."""
    best: tuple[float, NhcStorm] | None = None
    for storm in storms:
        distance = haversine_km(lat, lon, storm.lat, storm.lon)
        if distance <= max_km and (best is None or distance < best[0]):
            best = (distance, storm)
    return best[1] if best else None


def filter_seeds(
    seeds: list[T],
    official: list[NhcStorm] | None,
    *,
    mode: str,
    match_km: float,
    tropical_max_lat: float,
) -> list[T]:
    """Keep the detected systems worth forecasting.

    ``mode="nhc"`` with a readable feed keeps, for each NHC storm, the single
    closest detected centre within ``match_km``; every other centre is dropped.
    ``mode="tropical"`` (or ``"nhc"`` when the feed is unavailable) keeps centres
    equatorward of ``tropical_max_lat``. ``mode="none"`` keeps everything.
    """
    if mode == "none":
        return seeds
    if mode == "nhc" and official is not None:
        kept: list[T] = []
        for storm in official:
            candidates = [
                (haversine_km(s.lat, s.lon, storm.lat, storm.lon), s) for s in seeds
            ]
            candidates = [c for c in candidates if c[0] <= match_km]
            if candidates:
                distance, seed = min(candidates, key=lambda c: c[0])
                if seed not in kept:
                    kept.append(seed)
                    log.info("Matched %s to detected centre %.0f km away.", storm.name, distance)
            else:
                log.warning("NHC storm %s has no detected centre within %.0f km.", storm.name, match_km)
        dropped = len(seeds) - len(kept)
        if dropped:
            log.info("Dropped %d detected centre(s) that NHC is not tracking.", dropped)
        return kept
    kept = [s for s in seeds if abs(s.lat) <= tropical_max_lat]
    if len(kept) != len(seeds):
        log.info(
            "Dropped %d centre(s) poleward of %.0f deg (likely extratropical).",
            len(seeds) - len(kept),
            tropical_max_lat,
        )
    return kept


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(((lon2 - lon1 + 180.0) % 360.0) - 180.0)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(math.sqrt(min(1.0, max(0.0, a))))


def _coord(numeric: object, text: object) -> float:
    if isinstance(numeric, (int, float)):
        return float(numeric)
    raw = str(text or "").strip().upper()
    if not raw:
        raise ValueError("missing coordinate")
    sign = -1.0 if raw.endswith(("S", "W")) else 1.0
    return sign * float(raw.rstrip("NSEW"))


def _number(value: object) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
