"""Failover sequence: the OneGrid regional recovery procedure as stages, plus the failure mode
that fencing prevents.

Eight stages run left to right: Declare, Fence, Recover data, Rebind and refresh, Gate, Cut over,
Observe and Reconcile. Numbered markers 1-10 match the "Fail over" procedure in
docs/architecture/multiregion.md. The red dashed inset is modelled on the failure-mode drawing
in Microsoft's "Multiregion BCDR for Azure Virtual Desktop" article (two writers, one lock): it
shows why the primary writers are fenced (step 2) before the recovery publisher is enabled
(step 6) and why one checkpoint range is replayed once (step 4)."""

from diagram_engine import Sheet

LABEL = "Failover sequence"
SUMMARY = ("The regional failover as eight stages with numbered steps that match the recovery "
           "procedure, and a failure-mode inset that shows why fencing comes before recovery writers start")

W, H = 1800, 1040
STAGE_Y, STAGE_H, STAGE_W, STAGE_GAP = 150, 470, 186, 34
ROWS = (174, 282, 390, 498)           # icon tops shared by every four-item stage
INSET_Y, INSET_H = 684, 300

# stage key, title, items (name, caption, icon)
STAGES = (
    ("declare", "Declare", (
        ("Monitor", "alerts and probes", "monitor"),
        ("Log Analytics", "data age, lag", "log-analytics"),
        ("Incident owner", "declare, authorize", "users"),
        ("Recovery record", "start, scope, owner", "glyph:document"),
    )),
    ("fence", "Fence", (
        ("Forecast job", "primary schedule off", "container-apps-job"),
        ("OT connectors", "hold primary publish", "glyph:api"),
        ("Fabric schedules", "pause primary runs", "pipeline"),
        ("Checkpoints", "output, event, queue", "glyph:document"),
    )),
    ("recover", "Recover data", (
        ("Blob storage", "replica made writable", "blob-storage"),
        ("Fabric items", "Git sync, DR copy", "fabric"),
        ("GeoCatalog", "re-ingest imagery", "geocatalog"),
        ("Eventhouse", "replay checkpoint", "event-house"),
    )),
    ("rebind", "Rebind and refresh", (
        ("App Service", "recovery settings", "app-service"),
        ("Semantic model", "rebind, refresh", "semantic-model"),
        ("Microsoft Foundry", "recovery deployment", "ai-foundry"),
        ("Forecast job", "enable after fence", "container-apps-job"),
    )),
    ("gate", "Gate", (
        ("Origin access", "public origin denied", "front-door"),
        ("Application", "sign-in, API, WebSocket", "app-service"),
        ("Data", "DAX, KQL, freshness", "semantic-model"),
        ("Inference", "model, Aurora output", "machine-learning"),
        ("Publication ownership", "one active publisher", "container-apps-job"),
        ("Operations", "DNS, admin, alerts", "monitor"),
    )),
    ("cutover", "Cut over", (
        ("Azure Front Door", "recovery origin on", "front-door"),
        ("Primary origin", "disabled", "front-door"),
        ("OneGrid users", "same published host", "users"),
        ("Communicate", "degraded features", "glyph:chat"),
    )),
    ("observe", "Observe", (
        ("Monitor", "latency, errors", "monitor"),
        ("Fabric capacity", "load, throttling", "fabric"),
        ("Forecast job", "one publisher, age", "container-apps-job"),
        ("OT connectors", "lag, duplicates", "glyph:api"),
    )),
    ("reconcile", "Reconcile", (
        ("Recovery record", "achieved RTO, RPO", "glyph:document"),
        ("Reconcile data", "events, outputs", "glyph:database"),
        ("Re-protect", "reverse replication", "glyph:shield"),
        ("Failback decision", "approve or hold", "glyph:clock"),
    )),
)


def build():
    s = Sheet(
        "onegrid-reference-multiregion-failover",
        "OneGrid · failover sequence",
        "OneGrid regional failover sequence",
        "Declare, fence, recover, rebind, gate, cut over, observe and reconcile, with the numbered steps of "
        "the recovery procedure and the failure mode that fencing prevents.",
        width=W, height=H, style="learn",
    )
    s.footnote = ("Numbers match the Fail over procedure in the multiregion article and repeat in the inset where "
                  "a step guards that path.")
    s.unit_label = "Failure mode to avoid"

    xs = [40 + i * (STAGE_W + STAGE_GAP) for i in range(len(STAGES))]
    for x, (key, title, items) in zip(xs, STAGES):
        s.stage(key, x, STAGE_Y, STAGE_W, STAGE_H, title)
        cx = x + STAGE_W / 2
        if key == "gate":
            for i, (name, caption, icon) in enumerate(items):
                s.node(f"{key}-{i}", cx, 172 + 72 * i, name, caption, icon, w=166, size=30, font=12)
        else:
            for i, ((name, caption, icon), y) in enumerate(zip(items, ROWS)):
                s.node(f"{key}-{i}", cx, y, name, caption, icon, w=156)
    for i, ((a, *_), (b, *_)) in enumerate(zip(STAGES, STAGES[1:])):
        s.flow(f"next-{i + 1}", a, b, kind="request")

    # Numbered steps (multiregion.md, "Fail over")
    stage_x = dict(zip((k for k, *_ in STAGES), xs))
    for number, key in ((1, "declare"), (2, "fence"), (3, "recover"), (5, "rebind"),
                        (7, "gate"), (8, "cutover"), (9, "observe"), (10, "reconcile")):
        s.step(number, stage_x[key], STAGE_Y)
    s.step(4, stage_x["recover"], ROWS[3] + 22)      # replay the recorded checkpoint range once
    s.step(6, stage_x["rebind"], ROWS[3] + 22)       # enable the recovery publisher after the fence

    # ----- failure mode: two active writers ------------------------------------------------------------
    s.boundary("failure", 40, INSET_Y, 1720, INSET_H, "Failure mode: two active writers",
               "what steps 2, 4 and 6 prevent", accent=True)
    top, bottom, mid = INSET_Y + 56, INSET_Y + 176, INSET_Y + 116

    # Forecast publication: both jobs write the same output name
    s.node("job-primary", 180, top, "Primary job", "schedule still on", "container-apps-job", w=150)
    s.node("job-recovery", 180, bottom, "Recovery job", "enabled early", "container-apps-job", w=150)
    s.node("output", 480, mid, "weather-events.json", "last write wins", "blob-storage", w=170)
    s.node("web", 760, mid, "OneGrid web app", "forecast flips", "app-service", w=150)
    s.flow("w-primary", "job-primary", "output", sides=("r", "l"), offsets=(0, -8))
    s.flow("w-recovery", "job-recovery", "output", sides=("r", "l"), offsets=(0, 8))
    s.flow("w-read", "output", "web", kind="request")
    s.step(2, 80, top + 22)
    s.step(6, 80, bottom + 22)

    # Live events: two connector hosts replay the same checkpoint range
    s.node("conn-a", 1000, top, "Connector host A", "replays checkpoint", "glyph:api", w=150)
    s.node("conn-b", 1000, bottom, "Connector host B", "same checkpoint", "glyph:api", w=150)
    s.node("eventhouse", 1260, mid, "Eventhouse", "duplicate events", "event-house", w=150)
    s.flow("e-a", "conn-a", "eventhouse", sides=("r", "l"), offsets=(0, -8))
    s.flow("e-b", "conn-b", "eventhouse", sides=("r", "l"), offsets=(0, 8))
    s.step(2, 900, top + 22)
    s.step(4, 900, bottom + 22)

    s.note("why", 1420, top + 4, 320, "Why fencing comes first", (
        "a. Two publishers: the older run can win.",
        "b. Two replays: the same events twice.",
        "c. Fence (2), then replay once (4).",
        "d. Enable the recovery job last (6).",
    ))
    return s
