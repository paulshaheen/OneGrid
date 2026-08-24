# Fabric notebook source
# ============================================================================
#  _export_data  —  AUTHORING-SIDE, run ONCE against the SOURCE workspace to
#  generate the bundled historical-data parquet under Files/solution_export/.
#  Then download that folder to the solution's  data/lakehouse/  directory.
#
#  Bundles:
#    * ALL curated gold/ml/dbo tables in full (they are small)
#    * fact_pi + fact_icare_measurement  ->  last FACT_WINDOW_DAYS of data only
#      (relative to each table's own max date_key, so staleness is handled)
#  PiEvents (Eventhouse) is exported separately by _export_eventhouse.kql.
# ============================================================================

# PARAMETERS ****************
FACT_WINDOW_DAYS = 30
EXPORT_DIR       = "Files/solution_export/lakehouse"
BIG_TABLES       = {"fact_pi", "fact_icare_measurement"}   # windowed
SKIP_TABLES      = {"pi_data", "icare_datapoints", "icare_datapoints_enriched"}  # raw intermediates; curated versions bundled

# CELL ****************
from pyspark.sql import functions as F
import datetime, json

schemas = [s["namespace"] for s in spark.sql("SHOW SCHEMAS").collect()]
targets = []
for sch in schemas:
    for t in spark.sql(f"SHOW TABLES IN {sch}").collect():
        targets.append((sch, t["tableName"]))
print(f"{len(targets)} tables discovered across {schemas}")

# CELL ****************
manifest = []
for sch, tbl in targets:
    if tbl in SKIP_TABLES:
        print(f"skip {sch}.{tbl}"); continue
    df = spark.table(f"{sch}.{tbl}")
    if tbl in BIG_TABLES and "date_key" in df.columns:
        mx = df.agg(F.max("date_key")).collect()[0][0]
        if mx is not None:
            mxs = str(int(mx))
            d = datetime.date(int(mxs[0:4]), int(mxs[4:6]), int(mxs[6:8]))
            cut = d - datetime.timedelta(days=FACT_WINDOW_DAYS)
            cutkey = cut.year * 10000 + cut.month * 100 + cut.day
            df = df.filter(F.col("date_key") >= cutkey)
    n = df.count()
    path = f"{EXPORT_DIR}/{sch}/{tbl}"
    df.coalesce(1).write.mode("overwrite").parquet(path)
    manifest.append({"schema": sch, "table": tbl, "rows": n})
    print(f"exported {sch}.{tbl}: {n:,} rows")

# CELL ****************
try:
    import notebookutils; fs = notebookutils.fs
except Exception:
    from notebookutils import mssparkutils; fs = mssparkutils.fs
fs.put(f"{EXPORT_DIR}/_manifest.json", json.dumps(manifest, indent=2), overwrite=True)
print("wrote manifest with", len(manifest), "tables")
print("Now download Files/solution_export/lakehouse/ to the solution's data/lakehouse/")
