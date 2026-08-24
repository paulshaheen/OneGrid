import os, sys, json, datetime, subprocess
import deltalake
import pyarrow as pa
import pyarrow.parquet as pq
import pyarrow.compute as pc

WS  = "163ba38c-3869-406f-adb7-37cbc981390c"
LH  = "7e08480c-cf8d-4206-901d-38b74dbe35d9"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "lakehouse")
FACT_WINDOW_DAYS = 30
BIG = {"fact_pi", "fact_icare_measurement"}
SKIP = {"pi_data", "icare_datapoints", "icare_datapoints_enriched"}   # raw intermediates; curated gold/ml versions are bundled
ROWS_PER_FILE = 2_000_000          # partition big tables to keep parquet parts < ~200MB / LFS-friendly

def tok():
    return subprocess.check_output(
        ["az","account","get-access-token","--resource","https://storage.azure.com/","--query","accessToken","-o","tsv"],
        shell=True).decode().strip()

SO = {"bearer_token": tok(), "use_fabric_endpoint": "true"}

# table list passed in as argv (schema.table per line file)
tables = [l.strip() for l in open(sys.argv[1], encoding="utf-8") if l.strip()]

manifest = []
for full in tables:
    sch, tbl = full.split(".", 1)
    if tbl in SKIP:
        print(f"skip {full}"); continue
    path = f"abfss://{WS}@onelake.dfs.fabric.microsoft.com/{LH}/Tables/{sch}/{tbl}"
    try:
        dt = deltalake.DeltaTable(path, storage_options=SO)
    except Exception as e:
        print(f"WARN open {full}: {repr(e)[:150]}"); continue

    # Window big fact tables to last N days relative to their own max date_key.
    filt = None
    if tbl in BIG:
        # cheap: read only date_key column to find max
        try:
            dk = dt.to_pyarrow_table(columns=["date_key"])
            mx = pc.max(dk["date_key"]).as_py()
            mxs = str(int(mx))
            d = datetime.date(int(mxs[0:4]), int(mxs[4:6]), int(mxs[6:8]))
            cut = d - datetime.timedelta(days=FACT_WINDOW_DAYS)
            cutkey = cut.year*10000 + cut.month*100 + cut.day
            filt = ("date_key", ">=", cutkey)
        except Exception as e:
            print(f"WARN window {full}: {repr(e)[:120]}")

    outdir = os.path.join(OUT, sch, tbl)
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):
        try: os.remove(os.path.join(outdir, f))
        except: pass

    total = 0; parts = 0
    if filt:
        # stream via dataset with filter, batch to files
        ds = dt.to_pyarrow_dataset()
        expr = pc.field("date_key") >= filt[2]
        scanner = ds.scanner(filter=expr, batch_size=200_000)
        batches, cur = [], 0
        for b in scanner.to_batches():
            batches.append(b); cur += b.num_rows; total += b.num_rows
            if cur >= ROWS_PER_FILE:
                t = pa.Table.from_batches(batches)
                pq.write_table(t, os.path.join(outdir, f"part-{parts:04d}.parquet"), compression="zstd")
                parts += 1; batches, cur = [], 0
        if batches:
            t = pa.Table.from_batches(batches)
            pq.write_table(t, os.path.join(outdir, f"part-{parts:04d}.parquet"), compression="zstd")
            parts += 1
    else:
        t = dt.to_pyarrow_table()
        total = t.num_rows
        if total > ROWS_PER_FILE:
            for i in range(0, total, ROWS_PER_FILE):
                pq.write_table(t.slice(i, ROWS_PER_FILE), os.path.join(outdir, f"part-{parts:04d}.parquet"), compression="zstd")
                parts += 1
        else:
            pq.write_table(t, os.path.join(outdir, "part-0000.parquet"), compression="zstd")
            parts = 1

    manifest.append({"schema": sch, "table": tbl, "rows": total, "parts": parts})
    print(f"exported {full}: {total:,} rows -> {parts} part(s)")

with open(os.path.join(OUT, "_manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=2)
print(f"\nDONE: {len(manifest)} tables")
