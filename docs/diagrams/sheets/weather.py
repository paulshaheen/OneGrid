"""Weather orchestration, drawn in Azure Architecture Center style.

Inputs on the left feed one scheduled Container Apps job whose four steps run top to
bottom. The job exchanges model input and output through a Blob container, calls the
standing Aurora endpoint in Azure Machine Learning, and publishes storm events that the
web app reads. Numbered markers match the Weather run list in
docs/architecture/traffic-and-security.md, which holds the schedule, sizes, roles,
token audience and formulas."""

from diagram_engine import Sheet

LABEL = "Weather orchestration"
SUMMARY = ("One scheduled CPU job prepares two starting states, submits them to a standing "
           "Aurora GPU endpoint through a Blob exchange and publishes storm events")

IN, JOB, AZ, AZ2, OUT = 140, 460, 900, 1090, 1420   # column centres
A, B, C, D, E = 210, 330, 450, 570, 700             # icon tops of the input rows
MID = {r: r + 22 for r in (A, B, C, D, E)}
STEP = 32                                           # small step icons inside the job


def build():
    s = Sheet(
        "onegrid-reference-weather",
        "OneGrid · weather orchestration",
        "Weather forecast orchestration",
        "One scheduled CPU job prepares, submits and publishes each run; GPU inference is a "
        "separate standing endpoint.",
        width=1600, height=860, style="learn",
    )
    s.footnote = ("Numbered steps match the Weather run list in the traffic and security guide. "
                  "Dashed lines are control or diagnostic paths.")

    # Containers
    s.stage("inputs", 40, 190, 200, 480, "Inputs")
    s.zone("job-env", 300, 150, 320, 650, "Container Apps environment", icon="container-apps-job")
    s.zone("ml", 690, 380, 490, 140, "Azure Machine Learning", icon="machine-learning")
    s.zone("blob", 690, 528, 490, 272, "Blob storage", icon="blob-storage")
    s.header(OUT, 178, "Consumers")

    # Inputs
    s.node("registry", IN, A, "Container Registry", "pipeline image", "container-registry", w=180)
    s.node("trigger", IN, B, "Job trigger", "schedule or ARM", "glyph:clock", w=180)
    s.node("gfs", 92, C, "NOAA GFS", "two analyses", "glyph:globe", w=96)
    s.node("hf", 190, C, "Hugging Face", "static fields", "glyph:database", w=96)
    s.node("nhc", IN, D, "NHC", "active storms", "glyph:document", w=180)

    # The forecast job's four steps (small icons, centred on the input rows)
    off = (44 - STEP) // 2
    s.node("start", JOB, B + off, "Start", "one execution", "container-apps-job", w=170, size=STEP)
    s.node("prepare", JOB, C + off, "Prepare", "two starting states", "container-apps-job", w=170, size=STEP)
    s.node("detect", JOB, D + off, "Detect and submit", "storm seeds", "container-apps-job", w=170, size=STEP)
    s.node("track", JOB, E + off, "Track and publish", "storm events", "container-apps-job", w=170, size=STEP)

    # Azure Machine Learning and Blob storage
    s.node("endpoint", AZ, 430, "Aurora endpoint", "managed online", "machine-learning", w=150)
    s.node("deployment", AZ2, 430, "Model deployment", "A100 GPU", "machine-learning", w=150)
    s.node("channel", AZ, MID[D] + 8 - 22, "aurora-channel", "model exchange", "blob-storage", w=150)
    s.node("outputs", AZ, E, "model-outputs", "weather-events.json", "blob-storage", w=150)

    # Consumers
    s.node("logs", OUT, A, "Log Analytics", "job logs", "log-analytics", w=150)
    s.node("app", OUT, E, "OneGrid web app", "App Service", "app-service", w=150)

    # 1 Start: schedule or ARM call; the environment pulls the image
    s.flow("pull", "inputs", "job-env", [(240, MID[A]), (300, MID[A])], label="Pull", at=(270, MID[A] - 8))
    s.flow("start-run", "inputs", "start", [(240, MID[B]), s.port("start", "l")], "control")
    # 2 Prepare, 3 Detect
    s.flow("prepare-in", "inputs", "prepare", [(240, MID[C]), s.port("prepare", "l")])
    s.flow("nhc-in", "inputs", "detect", [(240, MID[D]), s.port("detect", "l")])
    # The job's sequence
    s.flow("s1", "start", "prepare", [s.port("start", "b"), s.port("prepare", "t")], "control")
    s.flow("s2", "prepare", "detect", [s.port("prepare", "b"), s.port("detect", "t")])
    s.flow("s3", "detect", "track", [s.port("detect", "b"), s.port("track", "t")])
    # 4 Exchange through the Blob channel, 5 score, 6 rollout
    s.flow("sas", "detect", "channel", [s.port("detect", "r", 8), s.port("channel", "l")], both=True,
           label="SAS", at=(790, MID[D]))
    x = 660
    s.flow("score", "detect", "endpoint",
           [s.port("detect", "r", -8), (x, MID[D] - 8), (x, 452), s.port("endpoint", "l")],
           "request", label="Score", at=(790, 444))
    s.flow("rollout", "endpoint", "channel", [s.port("endpoint", "b"), s.port("channel", "t")], both=True)
    s.flow("model", "endpoint", "deployment", sides=("r", "l"))
    # 7 Publish, 8 Read, 9 Logs
    s.flow("publish", "track", "outputs", [s.port("track", "r"), s.port("outputs", "l")],
           label="Publish", at=(800, MID[E] - 8))
    s.flow("read", "outputs", "app", sides=("r", "l"))
    s.flow("job-logs", "job-env", "logs", [(620, MID[A]), s.port("logs", "l")], "audit",
           label="Logs", at=(1020, MID[A] - 8))

    # Numbered run (Weather run list in traffic-and-security.md)
    s.step(1, 270, MID[B])
    s.step(2, 270, MID[C])
    s.step(3, 270, MID[D])
    s.step(4, 725, MID[D] + 8)
    s.step(5, x, 520)
    s.step(6, AZ, 544)
    s.step(7, 725, MID[E])
    s.step(8, 1200, MID[E])
    s.step(9, 680, MID[A])
    return s
