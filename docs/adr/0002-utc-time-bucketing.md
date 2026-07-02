# UTC time bucketing for the range selector, chart, and rollups

Supersedes [ADR-0001](0001-hour-granular-naive-local-time-filtering.md).

## Context

ADR-0001 bucketed everything in **naive log-local wall-clock**: the parser
discarded each log line's timezone offset and keyed rollups by the literal hour
in the log. This was "correct only when the dashboard is viewed from the same
timezone as the lancache server."

In practice that assumption broke. LanCache logs carry an offset (e.g. `+0600`),
and other log systems that ingest the same `access.log` (Logstash/Elasticsearch)
parse that offset and store timestamps in **UTC**. Comparing a relative window
like "last 24h" between the two systems put their 24-hour windows on clocks
offset by the log's UTC offset. With bursty traffic (a LAN event's evening peak),
that offset swung a single-service total by ~2×, which read as a "factor-of-2
calculation error."

## Decision

All time buckets are keyed in **UTC**, end to end:

- **Parser** (`parseTimestamp`): parses the log line's trailing offset and shifts
  the wall-clock components to UTC before deriving the `timestamp`/`hour`/`day`
  buckets. A line with no offset is assumed to already be UTC.
- **Range lib** (`range.ts`): `toHourString`/`hourToDate` use UTC components,
  relative presets anchor to UTC "now", and `formatHour` renders "... UTC".
- **UI**: the custom `datetime-local` inputs are labelled "(UTC)" and treated as
  UTC verbatim (no local↔UTC conversion); the bandwidth chart's hourly/3h
  subtitle notes "(UTC)".
- **Queries** were already UTC-based (`chooseGranularity`/`nextHour` use `…:00:00Z`),
  so no query change was needed.

## Consequences

- The dashboard now agrees with UTC-based systems (Elasticsearch) for the same
  absolute or relative window, provided IP-exclusion filters match too.
- **Requires a one-time re-ingest.** Rows written under ADR-0001 are keyed in
  log-local hours and are incompatible with new UTC-keyed rows. On upgrade, clear
  the rollup tables and reset the parse cursor, then re-parse the full log:
  `DELETE FROM hourly_stats; DELETE FROM daily_stats; DELETE FROM recent_activity;
  DELETE FROM cached_games; UPDATE parse_state SET last_position = 0, last_file_size = 0;`
  and re-run ingestion. (Alternatively delete `lancache.db` and re-ingest.)
- Times shown to viewers are UTC, not their local clock. This is deliberate: it
  makes the dashboard reconcilable with server-side log tooling. A future
  viewer-local display layer could format UTC buckets into local time without
  changing the storage basis.
- Hour-granular snapping and the rollup-table mechanics from ADR-0001 are
  unchanged.
