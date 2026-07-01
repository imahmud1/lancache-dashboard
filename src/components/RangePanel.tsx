"use client";

import { useEffect, useState, useCallback } from "react";
import { CalendarRange, ChevronDown, ChevronRight, X, Plus } from "lucide-react";
import {
  RangeSelection,
  SavedRange,
  RELATIVE_PRESETS,
  ALL_TIME,
  resolveSelection,
  selectionLabel,
  floorToHour,
  hourToLocalInput,
  formatHour,
} from "@/lib/range";

const OPEN_KEY = "rangePanelOpen";

interface RangePanelProps {
  selection: RangeSelection;
  onSelect: (sel: RangeSelection) => void;
  canAdmin: boolean;
  adminHeaders?: HeadersInit;
  onAdminRejected?: () => void;
}

export function RangePanel({ selection, onSelect, canAdmin, adminHeaders, onAdminRejected }: RangePanelProps) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedRange[]>([]);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [error, setError] = useState("");

  // Restore panel open/collapsed state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (typeof window !== "undefined") setOpen(localStorage.getItem(OPEN_KEY) === "1");
  }, []);

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

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") localStorage.setItem(OPEN_KEY, next ? "1" : "0");
      return next;
    });
  };

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

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl">
      {/* Header row (always visible) */}
      <button
        onClick={toggleOpen}
        className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center">
            <CalendarRange className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-50 leading-none">Range</h3>
            <p className="text-[11px] text-gray-500 mt-1">{selectionLabel(selection)}</p>
          </div>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
      </button>

      {open && (
        <div className="px-5 pb-4 pt-1 space-y-3 border-t border-gray-800/60">
          {/* Presets */}
          <div className="flex flex-wrap items-center gap-1.5 pt-3">
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

          {/* Custom absolute range */}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-gray-500">From</span>
              <input
                type="datetime-local"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 [color-scheme:dark]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-gray-500">To</span>
              <input
                type="datetime-local"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-200 [color-scheme:dark]"
              />
            </label>
            <button
              onClick={applyCustom}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                isCustom
                  ? "bg-blue-500/15 border-blue-500/30 text-blue-300"
                  : "bg-gray-800 border-gray-700 text-gray-300 hover:text-white"
              }`}
            >
              Apply
            </button>
            <span className="text-[11px] text-gray-600">Snaps to the hour.</span>
          </div>

          {error && <p className="text-[11px] text-red-400">{error}</p>}

          {/* Saved presets */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-gray-800/60 mt-1">
            <span className="text-[11px] text-gray-500 mr-1 pt-1">Saved:</span>
            {saved.length === 0 && <span className="text-[11px] text-gray-600 pt-1">none yet</span>}
            {saved.map((r) => {
              const active = selection.kind === "saved" && selection.id === r.id;
              return (
                <span
                  key={r.id}
                  className={`inline-flex items-center rounded-lg border text-sm transition-colors ${
                    active
                      ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-300"
                      : "bg-gray-800 border-gray-700 text-gray-300"
                  }`}
                >
                  <button
                    onClick={() => onSelect({ kind: "saved", id: r.id, name: r.name, start: r.start, end: r.end })}
                    title={`${formatHour(r.start)} → ${formatHour(r.end)}`}
                    className="pl-2.5 pr-2 py-1.5 hover:text-white"
                  >
                    {r.name}
                  </button>
                  {canAdmin && (
                    <button
                      onClick={() => deleteSaved(r.id)}
                      title="Delete preset"
                      className="pr-2 pl-0.5 py-1.5 text-gray-500 hover:text-red-400"
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
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sm font-medium border border-gray-700 bg-gray-800 text-gray-300 hover:text-white disabled:opacity-50 disabled:hover:text-gray-300"
              >
                <Plus className="w-3.5 h-3.5" /> Save current
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
        active
          ? "bg-blue-500/15 border-blue-500/30 text-blue-300"
          : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200"
      }`}
    >
      {children}
    </button>
  );
}
