import os, json, subprocess, datetime, urllib.request, urllib.error
import pyarrow as pa, pyarrow.parquet as pq

CLUSTER = "https://trd-8a08ckb2duw406mvvg.z2.kusto.fabric.microsoft.com"
DB      = "pi-realtime-db"
TABLE   = "PiEvents"
OUT     = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "eventhouse", "PiEvents")

# Data is concentrated in a few dense periods; chunk those finely, bulk the sparse tail.
DENSE = [
    (datetime.datetime(2026,5,25), datetime.datetime(2026,6,23), 6),   # 6h windows
    (datetime.datetime(2026,8,1),  datetime.datetime(2026,8,13), 6),
]
SPARSE_BEFORE = datetime.datetime(2026,5,25)   # everything older in one query

PROJECT = ("| project Ts, WebId, Tag, Plant, Value=tostring(Value), ValueType, "
           "Questionable, Substituted, Source, Host, IngestedAt")

def tok():
    return subprocess.check_output(
        ["az","account","get-access-token","--resource",CLUSTER,"--query","accessToken","-o","tsv"],
        shell=True).decode().strip()

def run_kql(csl, token):
    body = json.dumps({"db": DB, "csl": csl}).encode()
    req = urllib.request.Request(f"{CLUSTER}/v1/rest/query", data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read().decode())

def primary_table(res):
    for t in res.get("Tables", []):
        names = [c["ColumnName"] for c in t.get("Columns", [])]
        if "Tag" in names and "Ts" in names:
            return t
    return None

def write_window(csl, token, part):
    res = None
    for attempt in range(3):
        try:
            res = run_kql(csl, token); break
        except urllib.error.HTTPError as e:
            if e.code in (401,403): token = tok(); continue
            print(f"  HTTP {e.code}: {e.read()[:150]}"); return 0, token
        except Exception as e:
            print(f"  retry {attempt}: {repr(e)[:120]}")
    if res is None: return 0, token
    tbl = primary_table(res)
    if not tbl or not tbl.get("Rows"): return 0, token
    names = [c["ColumnName"] for c in tbl["Columns"]]
    rows = tbl["Rows"]
    data = {name: [r[i] for r in rows] for i, name in enumerate(names)}
    pq.write_table(pa.table(data), os.path.join(OUT, f"part-{part:04d}.parquet"), compression="zstd")
    return len(rows), token

os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    try: os.remove(os.path.join(OUT, f))
    except: pass

token = tok(); part = 0; total = 0

csl = f"set notruncation;\n{TABLE} | where Ts < datetime({SPARSE_BEFORE.isoformat()}) {PROJECT}"
n, token = write_window(csl, token, part)
if n: print(f"sparse (<{SPARSE_BEFORE.date()}): {n:,} rows -> part-{part:04d}"); total += n; part += 1

for start, end, hrs in DENSE:
    d = start
    while d < end:
        e = d + datetime.timedelta(hours=hrs)
        csl = f"set notruncation;\n{TABLE} | where Ts >= datetime({d.isoformat()}) and Ts < datetime({e.isoformat()}) {PROJECT}"
        n, token = write_window(csl, token, part)
        if n: print(f"{d}..{e}: {n:,} -> part-{part:04d}"); total += n; part += 1
        d = e

print(f"\nDONE PiEvents: {total:,} rows in {part} parts")
