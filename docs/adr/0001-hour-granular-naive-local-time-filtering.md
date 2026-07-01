# Hour-granular, naive-local time filtering over rollup tables

## Context

The dashboard aggregates the LanCache `access.log` into `daily_stats` and `hourly_stats` rollup tables (keyed by service + client_ip), retained indefinitely; only the last 1000 raw log lines survive in `recent_activity`. We wanted a viewer-selectable date/time Range (including LAN-event windows and relative windows like "last 12h").

## Decision

Time Ranges are **hour-granular** and evaluated by string-comparing against the `hour` column of `hourly_stats` (`WHERE hour >= start AND hour < end`); "All time" and multi-day ranges fall back to `daily_stats`. All times are **naive log-local wall-clock**: the parser already discards the log line's timezone offset, so no UTC conversion happens anywhere — a picked `18:00` matches the stored `...T18` bucket directly, and relative ranges anchor to the browser's wall-clock "now".

## Consequences

- No new raw-events table and no schema/parser change — reuses existing rollups, so no DB growth and no re-ingest.
- Minute-level precision is impossible; ranges snap to the hour.
- Correct only when the dashboard is viewed from the same timezone as the lancache server. Cross-timezone viewing would require honouring the log offset (parser change + re-ingest) and local↔UTC conversion in the UI — deliberately deferred.
- Cached Games is excluded from range filtering (it stores lifetime totals, not per-hour buckets); Live Downloads stays live.
