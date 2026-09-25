# Fabric notebook: Storm → Operations Impact (Aurora)
# ---------------------------------------------------------------------------
# Predicts operational impact to the O&G estate from an Aurora storm forecast.
#
# Inputs:
#   * Aurora forecast  -> weather-events.json ({"events":[WeatherEvent,...]}),
#                         published by the Aurora pipeline to model-outputs.
#   * Operational sites -> og.dim_site (15 facilities: lat/lon, site_type,
#                         operator, region, business_unit, criticality).
#
# Output:
#   * og.fact_storm_impact  (one row per site x storm event) — the explainable,
#     rule-based impact scoring that feeds Power BI and the app.
#
# The scoring is a faithful port of the app's risk-engine.ts (haversine track
# proximity, radial wind decay, wind-arrival ETAs, weighted explainable score),
# so the notebook and the live UI agree. Deterministic + physics/rule-based —
# no black box.
#
# Parameters (override at run time):
WEATHER_EVENTS_PATH = "Files/aurora/weather-events.json"   # OneLake shortcut to model-outputs
OUTPUT_TABLE = "fact_storm_impact"                          # written to the attached lakehouse
HORIZON_HOURS = 120

import math
import json
from datetime import datetime, timezone
from pyspark.sql import Row

# ---------------------------------------------------------------------------
# 1) Impact model — ported 1:1 from webapp/src/lib/services/risk-engine.ts
# ---------------------------------------------------------------------------
EARTH_MI = 3958.8

def haversine_mi(a_lat, a_lon, b_lat, b_lon):
    d_lat = math.radians(b_lat - a_lat)
    d_lon = math.radians(b_lon - a_lon)
    h = (math.sin(d_lat / 2) ** 2
         + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lon / 2) ** 2)
    return 2 * EARTH_MI * math.asin(math.sqrt(min(1.0, max(0.0, h))))

def forecast_wind_at(distance_mi, core_wind):
    eyewall = 30.0
    if distance_mi <= eyewall:
        return float(core_wind)
    decay = math.exp(-(distance_mi - eyewall) / 95.0)
    return float(max(12, round(core_wind * decay)))

def forecast_rainfall_at(distance_mi, category):
    base = 3.0 + category * 1.9
    return float(max(0.2, round(base * math.exp(-distance_mi / 180.0), 1)))

def track_proximity(site_lat, site_lon, forecast, max_hour=HORIZON_HOURS):
    """Closest distance to the interpolated forecast centerline (+ hour, cone flag)."""
    points = [p for p in forecast if p["hour"] <= max_hour]
    best = None
    for i, p in enumerate(points):
        nxt = points[i + 1] if i + 1 < len(points) else None
        samples = [{"lat": p["lat"], "lon": p["lon"], "hour": p["hour"], "base": p}]
        if nxt:
            for t in range(1, 6):
                f = t / 6.0
                samples.append({
                    "lat": p["lat"] + (nxt["lat"] - p["lat"]) * f,
                    "lon": p["lon"] + (nxt["lon"] - p["lon"]) * f,
                    "hour": p["hour"] + (nxt["hour"] - p["hour"]) * f,
                    "base": p if f < 0.5 else nxt,
                })
        for s in samples:
            d = haversine_mi(site_lat, site_lon, s["lat"], s["lon"])
            if best is None or d < best["distance_mi"]:
                cone = s["base"].get("coneRadiusMi", 0) or 0
                best = {"distance_mi": d, "hours_to_impact": s["hour"],
                        "nearest": s["base"], "inside_cone": d <= max(cone, 25)}
    if best is None:
        base0 = forecast[0] if forecast else {"windMph": 0, "category": 0, "coneRadiusMi": 0}
        return {"distance_mi": float("inf"), "hours_to_impact": None, "nearest": base0, "inside_cone": False}
    return best

def wind_arrival(site_lat, site_lon, forecast, max_hour=HORIZON_HOURS):
    """First forecast hour storm-force (>=39) and hurricane-force (>=74) winds reach the site."""
    points = [p for p in forecast if p["hour"] <= max_hour]
    ts_eta = None
    hur_eta = None
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        for t in range(13):
            f = t / 12.0
            lat = a["lat"] + (b["lat"] - a["lat"]) * f
            lon = a["lon"] + (b["lon"] - a["lon"]) * f
            core = a["windMph"] + (b["windMph"] - a["windMph"]) * f
            hour = a["hour"] + (b["hour"] - a["hour"]) * f
            w = forecast_wind_at(haversine_mi(site_lat, site_lon, lat, lon), core)
            if ts_eta is None and w >= 39:
                ts_eta = hour
            if hur_eta is None and w >= 74:
                hur_eta = hour
    return {
        "ts_wind_eta_h": None if ts_eta is None else round(ts_eta),
        "hur_wind_eta_h": None if hur_eta is None else round(hur_eta),
        "evac_window_h": None if ts_eta is None else max(0, round(ts_eta)),
    }

def level_from_score(score):
    if score >= 80: return "critical"
    if score >= 62: return "high"
    if score >= 42: return "elevated"
    if score >= 22: return "monitor"
    return "normal"

TYPE_SENSITIVITY = {"offshore_platform": 8, "pipeline": 5, "lng_terminal": 6,
                    "refinery": 6, "storage": 4, "port": 5, "well": 2}
CRITICALITY = {"business_critical": 10, "important": 6, "standard": 2}
SITE_TYPE_TO_ASSET = {"offshore_platform": "offshore_platform", "well": "well",
                      "pipeline": "pipeline", "refinery": "refinery", "port": "port",
                      "lng": "lng_terminal", "terminal": "storage", "power_plant": "refinery"}

def predicted_status(asset_type, wind, inside_cone):
    """Rule-based predicted operating status from forecast wind + facility type."""
    if asset_type == "offshore_platform":
        if wind >= 90: return "evacuating"
        if wind >= 74: return "shut_in"
        if wind >= 60: return "reduced"
        return "producing"
    if wind >= 74: return "shut_in"
    if wind >= 50 or inside_cone: return "reduced"
    return "producing"

def recommend(asset_type, wind, eta, inside_cone, rain):
    out = []
    eta_text = "the forecast horizon" if eta is None else f"{round(eta)} hours"
    if asset_type == "offshore_platform":
        if wind >= 90:
            out.append(f"Initiate non-essential personnel down-manning; full evacuation decision within {eta_text}.")
        elif wind >= 60:
            out.append("Begin pre-storm secure checklist and suspend crane and helideck operations.")
        else:
            out.append("Maintain normal operations; confirm weather-window reporting cadence.")
        if wind >= 74:
            out.append("Prepare production shut-in sequence and confirm subsea isolation readiness.")
    elif asset_type == "pipeline":
        out.append("Review right-of-way access and scour-prone crossings ahead of rainfall."
                   if rain >= 5 else "Confirm pigging and inspection schedule against forecast window.")
        if wind >= 74:
            out.append("Coordinate throughput reduction with upstream shut-in plan.")
    elif asset_type in ("refinery", "storage"):
        out.append("Activate flood-preparedness plan and verify drainage and berm readiness."
                   if rain >= 6 else "Verify safe-shutdown lead time against forecast onset.")
        if wind >= 74:
            out.append("Stage safe-shutdown crews and secure atmospheric tanks/units.")
    elif asset_type in ("lng_terminal", "port"):
        out.append("Suspend marine loading and clear berths ahead of storm-force winds."
                   if wind >= 60 else "Confirm vessel scheduling against the forecast window.")
    else:  # well
        out.append("Confirm wellhead is secured; limited manned exposure.")
    if inside_cone and not out:
        out.append("Asset lies inside the projected impact corridor; monitor closely.")
    return out

def score_site(site, event, horizon=HORIZON_HOURS):
    forecast = event["forecast"]
    prox = track_proximity(site["lat"], site["lon"], forecast, horizon)
    wind = forecast_wind_at(prox["distance_mi"], prox["nearest"]["windMph"])
    rain = forecast_rainfall_at(prox["distance_mi"], prox["nearest"].get("category", 0))
    dist_pts = round(max(0, 26 * math.exp(-prox["distance_mi"] / 70.0)))
    wind_pts = round(min(24, max(0, (wind - 50) / 3.7)))
    rain_pts = round(min(8, rain * 0.9))
    eta = prox["hours_to_impact"]
    eta_pts = 0 if eta is None else round(max(0, 10 - eta / 12.0))
    intensity_pts = 0 if prox["distance_mi"] > 220 else round(prox["nearest"].get("category", 0) * 2)
    crit_pts = CRITICALITY.get(site["criticality"], 2)
    type_pts = TYPE_SENSITIVITY.get(site["asset_type"], 4)
    cone_pts = 6 if prox["inside_cone"] else 0
    score = int(max(0, min(100, round(dist_pts + wind_pts + rain_pts + eta_pts
                                      + intensity_pts + crit_pts + type_pts + cone_pts))))
    arr = wind_arrival(site["lat"], site["lon"], forecast, horizon)
    dist = None if math.isinf(prox["distance_mi"]) else round(prox["distance_mi"])
    return {
        "event_id": event.get("id"),
        "event_name": event.get("name"),
        "model_source": event.get("modelSource"),
        "site_id": site["site_id"],
        "site_name": site["site_name"],
        "asset_type": site["asset_type"],
        "operator": site.get("operator"),
        "region": site.get("region"),
        "business_unit": site.get("business_unit"),
        "criticality": site["criticality"],
        "lat": site["lat"],
        "lon": site["lon"],
        "distance_mi": dist,
        "forecast_wind_mph": int(wind),
        "rainfall_in": float(rain),
        "hours_to_impact": None if eta is None else round(eta),
        "ts_wind_eta_h": arr["ts_wind_eta_h"],
        "hur_wind_eta_h": arr["hur_wind_eta_h"],
        "evac_window_h": arr["evac_window_h"],
        "inside_cone": bool(prox["inside_cone"]),
        "impact_score": score,
        "risk_level": level_from_score(score),
        "predicted_status": predicted_status(site["asset_type"], wind, prox["inside_cone"]),
        "recommended_actions": "; ".join(recommend(site["asset_type"], wind, eta, prox["inside_cone"], rain)),
        "forecast_updated_at": event.get("updatedAtIso"),
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }

# ---------------------------------------------------------------------------
# 2) Load the Aurora forecast (weather-events.json)
# ---------------------------------------------------------------------------
raw = spark.read.text(WEATHER_EVENTS_PATH, wholetext=True).collect()[0][0]
payload = json.loads(raw)
events = payload["events"] if isinstance(payload, dict) and "events" in payload else payload
events = [e for e in events if e.get("forecast")]
print(f"Loaded {len(events)} storm event(s) from {WEATHER_EVENTS_PATH}")

# ---------------------------------------------------------------------------
# 3) Load operational sites (og.dim_site) and normalize to the impact grain
# ---------------------------------------------------------------------------
site_rows = spark.sql("""
    SELECT site_id, site_name, lat, lon, site_type, operator, region,
           business_unit, criticality
    FROM dim_site
""").collect()

sites = []
for s in site_rows:
    if s["lat"] is None or s["lon"] is None:
        continue
    sites.append({
        "site_id": s["site_id"],
        "site_name": s["site_name"] or s["site_id"],
        "lat": float(s["lat"]),
        "lon": float(s["lon"]),
        "asset_type": SITE_TYPE_TO_ASSET.get(s["site_type"], s["site_type"] or "storage"),
        "operator": s["operator"] or "",
        "region": s["region"] or "",
        "business_unit": s["business_unit"] or "",
        "criticality": s["criticality"] or "standard",
    })
print(f"Loaded {len(sites)} operational site(s) from dim_site")

# ---------------------------------------------------------------------------
# 4) Score every site x storm event
# ---------------------------------------------------------------------------
results = [score_site(site, event) for event in events for site in sites]
print(f"Computed {len(results)} impact row(s) ({len(sites)} sites x {len(events)} events)")

# ---------------------------------------------------------------------------
# 5) Write og.fact_storm_impact (overwrite — current forecast cycle)
# ---------------------------------------------------------------------------
if results:
    impact_df = spark.createDataFrame([Row(**r) for r in results])
    (impact_df.write.mode("overwrite").option("overwriteSchema", "true")
        .format("delta").saveAsTable(OUTPUT_TABLE))
    print(f"Wrote {impact_df.count()} rows to {OUTPUT_TABLE}")
    impact_df.select("event_name", "site_name", "asset_type", "distance_mi",
                     "forecast_wind_mph", "hours_to_impact", "impact_score",
                     "risk_level", "predicted_status") \
        .orderBy(impact_df.impact_score.desc()).show(20, truncate=False)
else:
    print("No storm events in the forecast; fact_storm_impact left unchanged / empty.")
