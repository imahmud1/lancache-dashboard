"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Plus } from "lucide-react";
import {
  RangeSelection,
  SavedRange,
  RELATIVE_PRESETS,
  ALL_TIME,
  resolveSelection,
  floorToHour,
  hourToLocalInput,
  formatHour,
} from "@/lib/range";

interface RangePanelProps {
  /** Controlled open/collapsed state, driven by the top-bar Range button. */
  open: boolean;
  selection: RangeSelection;
  onSelect: (sel: RangeSelection) => void;
  canAdmin: boolean;
  adminHeaders?: HeadersInit;
  onAdminRejected?: () => void;
}

export function RangePanel({ open, selection, onSelect, canAdmin, adminHeaders, onAdminRejected }: RangePanelProps) {
  const [saved, setSaved] = useState<SavedRange[]>([]);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [error, setError] = useState("");

  const loadSaved = useCallback(() => {
    fetch("/api/ranges")
      .then((r) => r.json())
      .then((d) => setSaved(d.ranges || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  // Prefill custom inputs from the active window when it's a concrete range.
  useEffect(() => {
    if (selection.kind === "custom" || selection.kind === "saved") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCustomStart(hourToLocalInput(selection.start));
      setCustomEnd(hourToLocalInput(selection.end));
    }
  }, [selection]);

  const applyCustom = () => {
    if (!customStart || !customEnd) {
      setError("Pick both a start and an end.");
      return;
    }
    const start = floorToHour(customStart);
    const end = floorToHour(customEnd);
    if (end <= start) {
      setError("End must be after start.");
      return;
    }
    setError("");
    onSelect({ kind: "custom", start, end });
  };

  const saveCurrent = async () => {
    const resolved = resolveSelection(selection);
    if (!resolved) {
      setError("Pick a range before saving.");
      return;
    }
    const name = window.prompt("Name this range (e.g. LAN Friday)")?.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/ranges", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(adminHeaders || {}) },
        body: JSON.stringify({ name, start: resolved.start, end: resolved.end }),
      });
      if (res.status === 401) {
        onAdminRejected?.();
        alert("Admin key required or invalid. Please unlock again.");
        return;
      }
      if (!res.ok) {
        setError("Could not save range.");
        return;
      }
      const { range } = await res.json();
      loadSaved();
      if (range) onSelect({ kind: "saved", id: range.id, name: range.name, start: range.start, end: range.end });
    } catch {
      setError("Could not save range.");
    }
  };

  const deleteSaved = async (id: number) => {
    try {
      const res = await fetch(`/api/ranges?id=${id}`, { method: "DELETE", headers: adminHeaders });
      if (res.status === 401) {
        onAdminRejected?.();
        alert("Admin key required or invalid. Please unlock again.");
        return;
      }
      loadSaved();
      if (selection.kind === "saved" && selection.id === id) onSelect(ALL_TIME);
    } catch {
      /* ignore */
    }
  };

  const isAll = selection.kind === "all";
  const isCustom = selection.kind === "custom";

  if (!open) return null;

  const inputCls =
    "h-9 bg-ground/60 border border-line rounded-lg px-2.5 text-sm text-ink [color-scheme:dark] focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20";

  return (
    <section aria-label="Time range" className="rounded-xl border border-line bg-panel">
      <div className="grid gap-x-8 gap-y-4 px-5 py-4 lg:grid-cols-[auto_1fr]">
        <RowLabel>Quick</RowLabel>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill active={isAll} onClick={() => onSelect(ALL_TIME)}>All time</Pill>
          {RELATIVE_PRESETS.map((p) => (
            <Pill
              key={p.hours}
              active={selection.kind === "relative" && selection.hours === p.hours}
              onClick={() => onSelect({ kind: "relative", hours: p.hours })}
            >
              {p.label}
            </Pill>
          ))}
        </div>

        <RowLabel>Custom</RowLabel>
        <div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-3">From (UTC)</span>
              <input type="datetime-local" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-3">To (UTC)</span>
              <input type="datetime-local" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className={inputCls} />
            </label>
            <button
              onClick={applyCustom}
              className={`h-9 px-3.5 rounded-lg text-[13px] font-medium border transition-colors ${
                isCustom ? "border-accent/40 bg-accent/10 text-ink" : "border-line bg-raised text-ink-2 hover:text-ink hover:border-line-strong"
              }`}
            >
              Apply
            </button>
            <span className="text-xs text-ink-3 pb-2.5">Snaps to the hour.</span>
          </div>
          {error && (
            <p className="text-xs text-danger mt-2" role="alert">
              {error}
            </p>
          )}
        </div>

        <RowLabel>Saved</RowLabel>
        <div className="flex flex-wrap items-center gap-1.5">
          {saved.length === 0 && <span className="text-xs text-ink-3">No saved ranges yet{canAdmin ? "" : ". An admin can save event windows here."}</span>}
          {saved.map((r) => {
            const active = selection.kind === "saved" && selection.id === r.id;
            return (
              <span
                key={r.id}
                className={`inline-flex items-center h-8 rounded-lg border text-[13px] transition-colors ${
                  active ? "border-accent/40 bg-accent/10 text-ink" : "border-line bg-raised text-ink-2"
                }`}
              >
                <button
                  onClick={() => onSelect({ kind: "saved", id: r.id, name: r.name, start: r.start, end: r.end })}
                  title={`${formatHour(r.start)} → ${formatHour(r.end)}`}
                  className="h-full pl-2.5 pr-2 hover:text-ink"
                >
                  {r.name}
                </button>
                {canAdmin && (
                  <button
                    onClick={() => deleteSaved(r.id)}
                    title={`Delete "${r.name}"`}
                    aria-label={`Delete saved range ${r.name}`}
                    className="h-full pr-2 pl-0.5 text-ink-3 hover:text-danger"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </span>
            );
          })}
          {canAdmin && (
            <button
              onClick={saveCurrent}
              disabled={isAll}
              title={isAll ? "Pick a range first" : "Save the current range as a shared preset"}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[13px] font-medium border border-dashed border-line-strong text-ink-2 hover:text-ink hover:border-ink-3 disabled:opacity-50 disabled:pointer-events-none"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden /> Save current
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function RowLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-ink-3 lg:pt-2">{children}</div>;
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`h-8 px-3 rounded-lg text-[13px] font-medium border transition-colors ${
        active ? "border-accent/40 bg-accent/10 text-ink" : "border-line bg-raised text-ink-2 hover:text-ink hover:border-line-strong"
      }`}
    >
      {children}
    </button>
  );
}
