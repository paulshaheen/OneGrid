#!/usr/bin/env python3
"""Generate the OneGrid knowledge graph (ontology) from the
Fabric semantic model TMDL, so the graph stays in sync with the real Fabric
data model. Emits report-app/server/ontology.json (nodes + edges + metadata).

The same node/edge/meta definitions are mirrored by the Fabric notebook
`Ontology-Knowledge-Graph`, which writes ontology_nodes / ontology_edges Delta
tables into the lakehouse — so the ontology exists both locally and in Fabric.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TABLES_DIR = os.path.join(ROOT, "fabric", "semanticmodel", "semantic-main", "definition", "tables")
REL_FILE = os.path.join(ROOT, "fabric", "semanticmodel", "semantic-main", "definition", "relationships.tmdl")
OUT_FILE = os.path.join(ROOT, "report-app", "server", "ontology.json")

# ---- ontology categories (semantic grouping of the model) ----
CATEGORIES = {
    "dimension": {"label": "Dimension", "color": "#5aa9ff", "blurb": "Master data — the things we monitor"},
    "bridge":    {"label": "Bridge",    "color": "#a78bfa", "blurb": "Maps sensors to the equipment they measure"},
    "telemetry": {"label": "Telemetry", "color": "#37e0d0", "blurb": "Raw + modeled sensor readings"},
    "event":     {"label": "Events",    "color": "#ffcc4d", "blurb": "Outages, condition rounds & work"},
    "ml":        {"label": "ML Scoring", "color": "#ff8c42", "blurb": "Predictive model outputs"},
    "advisory":  {"label": "Advisory",  "color": "#ff5470", "blurb": "Alerts, watch signals & diagnoses"},
    "narrative": {"label": "Narrative", "color": "#8ea3bd", "blurb": "Generated analyst summaries"},
}

# ---- curated per-table metadata (label / category / grain / description / role) ----
META = {
    "dim_asset": dict(label="Asset", category="dimension", role="hub",
        grain="one row per monitored asset",
        desc="The central entity: every generating asset (turbine, boiler, pump, generator) in the fleet, with its plant, unit and equipment category."),
    "dim_equipment": dict(label="Equipment", category="dimension",
        grain="one row per equipment item (iCare id)",
        desc="Physical equipment master keyed by iCare id — the bridge between condition-monitoring identity and the analytics asset id."),
    "dim_date": dict(label="Date", category="dimension",
        grain="one row per calendar day",
        desc="Standard date dimension used to trend facts and scores over time."),
    "bridge_pi_tag_to_asset": dict(label="Tag → Asset Bridge", category="bridge", role="hub",
        grain="one row per PI tag",
        desc="Maps each PI sensor tag to the asset/equipment it belongs to — the join that turns raw tags into asset context."),
    "selected_tags": dict(label="Selected Tags", category="bridge",
        grain="one row per model-selected tag",
        desc="The curated set of tags chosen as features for the predictive models."),
    "fact_pi": dict(label="PI Telemetry", category="telemetry",
        grain="one row per tag per timestamp",
        desc="Raw process-historian (PI) time-series readings streamed from plant sensors."),
    "fact_icare_measurement": dict(label="iCare Measurements", category="telemetry",
        grain="one row per condition reading",
        desc="Condition-monitoring measurements (vibration, oil, thermography) collected on equipment rounds."),
    "aakr_scores": dict(label="AAKR Residuals", category="telemetry",
        grain="one row per tag per scoring run",
        desc="Auto-Associative Kernel Regression residuals — how far each tag drifts from its expected healthy value."),
    "aakr_health": dict(label="AAKR Health", category="telemetry",
        grain="one row per asset per scoring run",
        desc="Rolled-up asset health index derived from AAKR residuals across the asset's tags."),
    "fact_gads_event": dict(label="GADS Outages", category="event",
        grain="one row per outage/derate event",
        desc="GADS reliability events — forced outages, derates and their causes for each asset."),
    "fact_work_requests": dict(label="Work Requests", category="event",
        grain="one row per work request",
        desc="Maintenance work requests / orders raised against equipment."),
    "predictions_longterm": dict(label="Long-Term Survival", category="ml",
        grain="one row per asset per horizon",
        desc="Cox survival model output — 7/14-day survival probability, risk score and median days to failure."),
    "predictions_shortterm": dict(label="Short-Term Stop Risk", category="ml",
        grain="one row per asset per horizon",
        desc="Near-term stop-probability model — likelihood the asset trips within 4h/8h/24h with an alert level."),
    "anomaly_advisories": dict(label="Anomaly Advisories", category="advisory",
        grain="one row per anomaly episode",
        desc="SmartSignal anomaly episodes per tag — peak z-score, direction, duration and an advisory message."),
    "watchlist": dict(label="Watchlist", category="advisory",
        grain="one row per watched signal",
        desc="Ranked watch signals per asset — descriptor, normal range, trend and recommended action, contributing to asset risk."),
    "root_cause": dict(label="Root Cause", category="advisory",
        grain="one row per diagnosed fault",
        desc="Diagnosed failure mechanisms per asset/tag with likely cause narrative, confidence and recommended action."),
    "daily_narrative": dict(label="Daily Narrative", category="narrative",
        grain="one row per asset per day",
        desc="Auto-generated plain-language daily briefing summarizing each asset's state."),
}

# ---- curated relationship verbs, keyed by (from_table, to_table) ----
EDGE_VERB = {
    ("predictions_longterm", "dim_asset"): "long-term survival for",
    ("predictions_shortterm", "dim_asset"): "short-term stop risk for",
    ("watchlist", "dim_asset"): "watch signals for",
    ("root_cause", "dim_asset"): "diagnoses",
    ("fact_gads_event", "dim_asset"): "outage events for",
    ("fact_icare_measurement", "dim_asset"): "condition readings for",
    ("aakr_health", "dim_asset"): "health index for",
    ("daily_narrative", "dim_asset"): "narrates",
    ("dim_equipment", "dim_asset"): "describes",
    ("fact_pi", "bridge_pi_tag_to_asset"): "telemetry on tag",
    ("anomaly_advisories", "bridge_pi_tag_to_asset"): "anomaly on tag",
    ("aakr_scores", "bridge_pi_tag_to_asset"): "residual on tag",
    ("selected_tags", "bridge_pi_tag_to_asset"): "selects tag",
    ("root_cause", "bridge_pi_tag_to_asset"): "cause on tag",
    ("bridge_pi_tag_to_asset", "dim_equipment"): "maps tag to",
    ("bridge_pi_tag_to_asset", "dim_asset"): "belongs to",
    ("fact_work_requests", "dim_equipment"): "work on",
}


def parse_table(path):
    name, source, cols = None, None, []
    cur = None
    with open(path, "r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.rstrip("\n")
            s = line.strip()
            m = re.match(r"^table\s+(\S+)", s)
            if m:
                name = m.group(1).strip("'")
                continue
            m = re.match(r"^sourceLineageTag:\s*(.+)$", s)
            if m and source is None:
                source = m.group(1).strip()
                continue
            m = re.match(r"^column\s+(.+)$", s)
            if m:
                cur = {"name": m.group(1).strip().strip("'"), "type": "string"}
                cols.append(cur)
                continue
            m = re.match(r"^dataType:\s*(\S+)", s)
            if m and cur is not None:
                cur["type"] = m.group(1).strip()
                cur = None
    return name, source, cols


def parse_relationships(path):
    edges = []
    cur = {}
    def flush():
        if cur.get("from") and cur.get("to"):
            edges.append(dict(cur))
    with open(path, "r", encoding="utf-8") as fh:
        for raw in fh:
            s = raw.strip()
            if s.startswith("relationship "):
                if cur:
                    flush()
                cur = {"id": s.split()[1]}
                continue
            m = re.match(r"^fromColumn:\s*([^.]+)\.(.+)$", s)
            if m:
                cur["from"], cur["fromCol"] = m.group(1).strip(), m.group(2).strip()
                continue
            m = re.match(r"^toColumn:\s*([^.]+)\.(.+)$", s)
            if m:
                cur["to"], cur["toCol"] = m.group(1).strip(), m.group(2).strip()
                continue
            m = re.match(r"^crossFilteringBehavior:\s*(\S+)", s)
            if m:
                cur["crossFilter"] = m.group(1).strip()
    if cur:
        flush()
    return edges


def main():
    if not os.path.isdir(TABLES_DIR):
        print(f"tables dir not found: {TABLES_DIR}", file=sys.stderr)
        sys.exit(1)

    tables = {}
    for fn in sorted(os.listdir(TABLES_DIR)):
        if not fn.endswith(".tmdl"):
            continue
        name, source, cols = parse_table(os.path.join(TABLES_DIR, fn))
        if name:
            tables[name] = {"source": source, "columns": cols}

    rels = parse_relationships(REL_FILE)

    # figure out which columns are foreign keys (participate in an edge)
    fk = {}  # table -> set(col)
    for e in rels:
        fk.setdefault(e["from"], set()).add(e["fromCol"])
        fk.setdefault(e["to"], set()).add(e["toCol"])

    # primary-key heuristic per table
    def pk_for(tname, colnames):
        prefer = {
            "dim_asset": "asset_id", "dim_equipment": "icare_id", "dim_date": None,
            "bridge_pi_tag_to_asset": "Tag",
        }.get(tname)
        if prefer and prefer in colnames:
            return prefer
        return None

    nodes = []
    for tname, tinfo in tables.items():
        meta = META.get(tname, dict(label=tname, category="telemetry", grain="", desc=""))
        colnames = [c["name"] for c in tinfo["columns"]]
        pk = pk_for(tname, colnames)
        cols = []
        for c in tinfo["columns"]:
            key = "pk" if c["name"] == pk else ("fk" if c["name"] in fk.get(tname, set()) else None)
            cols.append({"name": c["name"], "type": c["type"], "key": key})
        nodes.append({
            "id": tname,
            "label": meta["label"],
            "table": tname,
            "source": tinfo["source"],
            "category": meta["category"],
            "role": meta.get("role", "leaf"),
            "grain": meta["grain"],
            "description": meta["desc"],
            "columns": cols,
        })

    node_ids = {n["id"] for n in nodes}

    edges = []
    seen = set()
    for e in rels:
        if e["from"] not in node_ids or e["to"] not in node_ids:
            continue
        verb = EDGE_VERB.get((e["from"], e["to"]), "relates to")
        eid = f"{e['from']}::{e['to']}"
        seen.add((e["from"], e["to"]))
        edges.append({
            "id": eid, "from": e["from"], "to": e["to"],
            "fromCol": e.get("fromCol"), "toCol": e.get("toCol"),
            "label": verb, "kind": "physical",
            "cardinality": "many-to-one",
        })

    # logical edges: connect tables that share a key but have no modeled relationship
    def add_logical(frm, to, fromcol, tocol):
        if frm not in node_ids or to not in node_ids:
            return
        if (frm, to) in seen or (to, frm) in seen:
            return
        seen.add((frm, to))
        edges.append({
            "id": f"{frm}::{to}", "from": frm, "to": to,
            "fromCol": fromcol, "toCol": tocol,
            "label": EDGE_VERB.get((frm, to), "relates to"),
            "kind": "logical", "cardinality": "many-to-one",
        })

    for tname, tinfo in tables.items():
        colnames = {c["name"] for c in tinfo["columns"]}
        if tname not in ("dim_asset",) and "asset_id" in colnames:
            add_logical(tname, "dim_asset", "asset_id", "asset_id")
        if tname not in ("bridge_pi_tag_to_asset",) and ("Tag" in colnames or "tag" in colnames):
            col = "Tag" if "Tag" in colnames else "tag"
            add_logical(tname, "bridge_pi_tag_to_asset", col, "Tag")

    # temporal edges: make dim_date the time spine for anything with a date column
    def date_col(colnames):
        for c in colnames:
            lc = c.lower()
            if lc == "date_key" or lc == "date":
                return c
        for c in colnames:
            if c.lower().endswith("_date") or c.lower().endswith("date"):
                return c
        return None
    if "dim_date" in node_ids:
        for tname, tinfo in tables.items():
            if tname in ("dim_date", "dim_asset", "dim_equipment", "bridge_pi_tag_to_asset", "selected_tags"):
                continue
            colnames = [c["name"] for c in tinfo["columns"]]
            dc = date_col(colnames)
            if not dc or (tname, "dim_date") in seen:
                continue
            seen.add((tname, "dim_date"))
            edges.append({
                "id": f"{tname}::dim_date", "from": tname, "to": "dim_date",
                "fromCol": dc, "toCol": "date",
                "label": "dated by", "kind": "temporal", "cardinality": "many-to-one",
            })

    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "semantic-main",
        "title": "OneGrid Knowledge Graph",
        "categories": CATEGORIES,
        "nodes": sorted(nodes, key=lambda n: (n["category"], n["id"])),
        "edges": edges,
        "stats": {"nodes": len(nodes), "edges": len(edges),
                   "physical": sum(1 for e in edges if e["kind"] == "physical"),
                   "logical": sum(1 for e in edges if e["kind"] == "logical"),
                   "temporal": sum(1 for e in edges if e["kind"] == "temporal")},
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
    print(f"wrote {OUT_FILE}: {out['stats']}")


if __name__ == "__main__":
    main()
