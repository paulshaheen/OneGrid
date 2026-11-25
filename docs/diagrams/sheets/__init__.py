"""OneGrid architecture sheets, in reading order. Each module exposes build() -> Sheet,
LABEL (short navigation name) and SUMMARY (one sentence for the gallery).

Order follows the design guide: landing zone (where OneGrid sits), logical view (what it does),
deployment view (what the template creates), resource naming, then the detailed sheets."""

ORDER = (
    "landing_zone", "baseline", "deployment", "naming",
    "fabric", "enterprise", "dns", "weather",
    "identity", "monitoring", "regulated", "multiregion",
)

# Sheets that use letters (design areas) or no markers instead of numbered workflow steps.
UNNUMBERED = ("landing_zone", "naming")
