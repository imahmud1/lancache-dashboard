# LanCache Dashboard

A self-hosted dashboard that aggregates a LanCache `access.log` into rollup tables and visualises cache savings, per-service and per-client breakdowns, live downloads, and cached games.

## Language

### Time & filtering

**Time Range**:
A `[start, end)` window the viewer applies to scope the dashboard's stats. Hour-granular and expressed in [[log-local-wall-clock]]; `end` is exclusive at the hour boundary.
_Avoid_: date filter, period, timespan

**Relative Range**:
A Time Range defined against "now" (e.g. "Last 12h"), recomputed on every load so it always tracks the present. "Now" is the viewer's browser wall-clock.
_Avoid_: rolling window (in UI copy), dynamic range

**Absolute Range**:
A Time Range with a fixed start and end (e.g. a LAN event's opening hours). Does not move when reloaded.
_Avoid_: fixed range, static range

**Log-local wall-clock**:
The single timezone frame the app operates in: the wall-clock time written in the log line, with its `+0000`-style offset discarded during parsing. No UTC conversion happens anywhere. Correct as long as the dashboard is viewed from the same timezone as the lancache server.
_Avoid_: UTC, server time, local time (ambiguous)

**Saved Range** (a.k.a. Preset):
A named [[absolute-range]] persisted server-side and shared across all viewers (e.g. "LAN Friday"). Creating and deleting presets is gated behind `ADMIN_API_KEY`; selecting one is open to everyone.
_Avoid_: bookmark, favourite

**All time**:
The default, unfiltered selection — the app's historical behaviour of aggregating every row. Serves as the escape hatch back to unscoped totals.
