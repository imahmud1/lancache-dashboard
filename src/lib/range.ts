/**
 * Client-side model of the dashboard's time-range selection. Everything is in
 * UTC: the parser buckets log lines by their UTC hour (honouring each line's
 * offset), so the selector and chart are UTC too (see ADR-0002). Hour strings
 * look like "2026-07-01T18".
 */
export type RangeSelection =
  | { kind: "all" }
  | { kind: "relative"; hours: number }
  | { kind: "custom"; start: string; end: string }
  | { kind: "saved"; id: number; name: string; start: string; end: string };

export interface ResolvedRange {
  start: string; // hour string, inclusive
  end: string;   // hour string, exclusive
}

export interface SavedRange {
  id: number;
  name: string;
  start: string; // hour string, inclusive
  end: string;   // hour string, exclusive
  createdAt: string;
}

export const ALL_TIME: RangeSelection = { kind: "all" };

export const RELATIVE_PRESETS: { hours: number; label: string }[] = [
  { hours: 6, label: "Last 6h" },
  { hours: 12, label: "Last 12h" },
  { hours: 24, label: "Last 24h" },
  { hours: 48, label: "Last 2d" },
  { hours: 168, label: "Last 7d" },
  { hours: 720, label: "Last 30d" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format a Date as a UTC hour string. */
export function toHourString(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`;
}

/** Parse an hour string back into a UTC Date. */
export function hourToDate(h: string): Date {
  const [datePart, hh] = h.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, Number(hh)));
}

/** A `datetime-local` value ("2026-07-01T18:30") floored to its hour string. */
export function floorToHour(local: string): string {
  return local.slice(0, 13); // "YYYY-MM-DDTHH"
}

/** An hour string as a `datetime-local` value. */
export function hourToLocalInput(h: string): string {
  return `${h}:00`;
}

/** Resolve a selection to concrete hour bounds, or null for "all time". */
export function resolveSelection(sel: RangeSelection): ResolvedRange | null {
  switch (sel.kind) {
    case "all":
      return null;
    case "relative": {
      const end = new Date();
      end.setUTCMinutes(0, 0, 0);
      end.setUTCHours(end.getUTCHours() + 1); // exclusive end includes the current partial hour
      const start = new Date(end);
      start.setUTCHours(start.getUTCHours() - sel.hours);
      return { start: toHourString(start), end: toHourString(end) };
    }
    case "custom":
    case "saved":
      return { start: sel.start, end: sel.end };
  }
}

/** Human label for an hour string, rendered in UTC (e.g. "1 Jul, 18:00 UTC"). */
export function formatHour(h: string): string {
  const [datePart, hh] = h.split("T");
  const [, m, d] = datePart.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}, ${hh}:00 UTC`;
}

/** Short human label for the summary chip. */
export function selectionLabel(sel: RangeSelection): string {
  switch (sel.kind) {
    case "all":
      return "All time";
    case "relative":
      return RELATIVE_PRESETS.find((p) => p.hours === sel.hours)?.label ?? `Last ${sel.hours}h`;
    case "saved":
      return sel.name;
    case "custom":
      return `${formatHour(sel.start)} → ${formatHour(sel.end)}`;
  }
}

/** Query-string suffix ("&start=..&end=..") for a resolved range, or "" for all-time. */
export function rangeQuery(resolved: ResolvedRange | null): string {
  if (!resolved) return "";
  return `&start=${encodeURIComponent(resolved.start)}&end=${encodeURIComponent(resolved.end)}`;
}
