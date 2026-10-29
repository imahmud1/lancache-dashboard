"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { Database, RefreshCw, Boxes, Eye, EyeOff, Lock, Unlock, Radar, ChevronDown, AlertTriangle, CalendarRange, MonitorPlay } from "lucide-react";
import { ServiceChart } from "@/components/ServiceChart";
import { BandwidthChart } from "@/components/BandwidthChart";
import { ClientsTable } from "@/components/ClientsTable";
import { RecentActivity } from "@/components/RecentActivity";
import { LiveDownloads } from "@/components/LiveDownloads";
import { CachedGames, useGames } from "@/components/CachedGames";
import { SummaryBand, type Overview } from "@/components/SummaryBand";
import { RangePanel } from "@/components/RangePanel";
import { BrandMark, useBrand } from "@/components/Brand";
import { ToolButton } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import { RangeSelection, ALL_TIME, resolveSelection, selectionLabel } from "@/lib/range";

interface DashboardData {
  overview: Overview;
  services: { service: string; bytesSent: number; requests: number; cacheHits: number; cacheMisses: number; hitBytes: number; missBytes: number }[];
  bandwidth: { bucket: string; bytesSent: number; requests: number; cacheHits: number; cacheMisses: number; hitBytes: number; missBytes: number }[];
  bandwidthGranularity: "hour" | "3h" | "day";
}

const linkCls =
  "inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-panel text-[13px] font-medium text-ink-2 hover:text-ink hover:border-line-strong transition-colors";

export default function Dashboard() {
  const brand = useBrand();
  const gamesData = useGames(5 * 60_000);
  const [data, setData] = useState<DashboardData | null>(null);
  const [clients, setClients] = useState<
    { clientIp: string; requests: number; bytesSent: number; cacheHits: number; cacheMisses: number; hitBytes: number; missBytes: number; topService: string; hostname?: string | null; excluded?: boolean }[]
  >([]);
  const [recent, setRecent] = useState<
    { id: number; timestamp: string; service: string; clientIp: string; requestPath: string; bytesSent: number; cacheStatus: string; upstreamHost: string; hostname?: string | null }[]
  >([]);
  const [ingest, setIngest] = useState<{ running: boolean; error: boolean; percent: number; lines: number; message: string }>({
    running: false, error: false, percent: 0, lines: 0, message: "",
  });
  const [depot, setDepot] = useState<{ running: boolean; percent: number; phase: string; message: string; speedBps: number }>({
    running: false, percent: 0, phase: "idle", message: "", speedBps: 0,
  });
  const [includeAll, setIncludeAll] = useState(false);
  const [selection, setSelection] = useState<RangeSelection>(ALL_TIME);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminInput, setAdminInput] = useState("");
  const [adminError, setAdminError] = useState("");
  const [adminChecking, setAdminChecking] = useState(false);

  // Load persisted toggle + admin password, and check whether auth is required
  useEffect(() => {
    const savedToggle = typeof window !== "undefined" ? localStorage.getItem("includeAll") : null;
    const savedKey = typeof window !== "undefined" ? localStorage.getItem("adminKey") : null;
    const savedRange = typeof window !== "undefined" ? localStorage.getItem("rangeSelection") : null;
    const savedRangeOpen = typeof window !== "undefined" ? localStorage.getItem("rangePanelOpen") : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (savedToggle === "1") setIncludeAll(true);
    if (savedRangeOpen === "1") setRangeOpen(true);
    if (savedKey) setAdminKey(savedKey);
    if (savedRange) {
      try {
        const parsed = JSON.parse(savedRange) as RangeSelection;
        if (parsed && typeof parsed.kind === "string") setSelection(parsed);
      } catch {
        /* ignore malformed persisted selection */
      }
    }
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setAuthRequired(!!d.authRequired))
      .catch(() => {});
  }, []);

  const canAdmin = !authRequired || !!adminKey;
  const adminHeaders: HeadersInit | undefined = adminKey ? { "x-api-key": adminKey } : undefined;

  const openAdminModal = () => {
    setAdminInput("");
    setAdminError("");
    setAdminModalOpen(true);
  };

  const submitAdminKey = async () => {
    const key = adminInput.trim();
    if (!key) return;
    setAdminChecking(true);
    setAdminError("");
    try {
      const res = await fetch("/api/auth", { method: "POST", headers: { "x-api-key": key } });
      if (res.ok) {
        localStorage.setItem("adminKey", key);
        setAdminKey(key);
        setAdminModalOpen(false);
      } else {
        setAdminError("That password wasn't accepted. Check it and try again.");
      }
    } catch {
      setAdminError("Couldn't reach the server to validate the key.");
    } finally {
      setAdminChecking(false);
    }
  };

  const handleLock = () => {
    localStorage.removeItem("adminKey");
    setAdminKey(null);
  };

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (includeAll) params.set("includeAll", "1");
      const resolved = resolveSelection(selection);
      if (resolved) {
        params.set("start", resolved.start);
        params.set("end", resolved.end);
      }
      const q = params.toString() ? `?${params.toString()}` : "";
      const [statsRes, clientsRes, recentRes] = await Promise.all([
        fetch(`/api/stats${q}`),
        fetch(`/api/clients${q}`),
        fetch(`/api/recent${q}`),
      ]);
      const statsData = await statsRes.json();
      const clientsData = await clientsRes.json();
      const recentData = await recentRes.json();

      setData(statsData);
      setClients(clientsData.clients || []);
      setRecent(recentData.recent || []);
    } catch (err) {
      console.error("Failed to fetch data:", err);
    } finally {
      setLoading(false);
    }
  }, [includeAll, selection]);

  const handleSelectRange = (sel: RangeSelection) => {
    setSelection(sel);
    if (typeof window !== "undefined") localStorage.setItem("rangeSelection", JSON.stringify(sel));
  };

  const toggleRange = () => {
    setRangeOpen((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") localStorage.setItem("rangePanelOpen", next ? "1" : "0");
      return next;
    });
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    const interval = setInterval(fetchData, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  const toggleIncludeAll = () => {
    setIncludeAll((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") localStorage.setItem("includeAll", next ? "1" : "0");
      return next;
    });
  };

  const handleIngest = async (reprocess = false) => {
    try {
      const url = reprocess ? "/api/ingest?reprocess=1" : "/api/ingest";
      const res = await fetch(url, { method: "POST", headers: adminHeaders });
      if (res.status === 401) {
        handleLock();
        alert("Admin login required or expired. Please log in again.");
        return;
      }
      // 409 = already running; fall through and poll its progress
    } catch {
      return;
    }
    setIngest((s) => ({ ...s, running: true, error: false, message: reprocess ? "Rebuilding…" : "Starting…" }));

    const poll = async () => {
      try {
        const r = await fetch("/api/ingest");
        const p = await r.json();
        setIngest({ running: p.running, error: !!p.error, percent: p.percent ?? 0, lines: p.lines ?? 0, message: p.message ?? "" });
        if (p.running) {
          setTimeout(poll, 1000);
        } else {
          await fetchData();
        }
      } catch {
        setIngest((s) => ({ ...s, running: false }));
      }
    };
    setTimeout(poll, 600);
  };

  const confirmRebuild = () => {
    setRebuildOpen(false);
    handleIngest(true);
  };

  const handleDepotRefresh = async () => {
    try {
      const res = await fetch("/api/depots/refresh", { method: "POST", headers: adminHeaders });
      if (res.status === 401) {
        handleLock();
        alert("Admin login required or expired. Please log in again.");
        return;
      }
    } catch {
      return;
    }
    setDepot((s) => ({ ...s, running: true, message: "Starting…" }));

    const poll = async () => {
      try {
        const r = await fetch("/api/depots/refresh");
        const p = await r.json();
        setDepot({ running: p.running, percent: p.percent ?? 0, phase: p.phase ?? "", message: p.message ?? "", speedBps: p.speedBps ?? 0 });
        if (p.running) {
          setTimeout(poll, 1000);
        }
      } catch {
        setDepot((s) => ({ ...s, running: false }));
      }
    };
    setTimeout(poll, 600);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-ink-3 text-sm flex items-center gap-3" role="status">
          <RefreshCw className="w-4 h-4 animate-spin" aria-hidden />
          Loading dashboard…
        </div>
      </div>
    );
  }

  const rangeLabel = selectionLabel(selection);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-ground/85 backdrop-blur-md">
        <div className="max-w-[90rem] mx-auto px-5 min-h-16 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <BrandMark brand={brand} className="text-[15px] shrink-0" />

          <nav className="flex flex-wrap items-center gap-2 w-full sm:w-auto" aria-label="Dashboard controls">
            <ToolButton
              onClick={toggleIncludeAll}
              active={includeAll}
              tone="internet"
              aria-pressed={includeAll}
              aria-label={includeAll ? "Prefill traffic shown" : "Prefill traffic hidden"}
              title={
                includeAll
                  ? "Showing all traffic, including the cache host and any PREFILL_IPS / EXCLUDE_IPS clients"
                  : "Cache-host and PREFILL_IPS / EXCLUDE_IPS clients are hidden from stats"
              }
            >
              {includeAll ? <Eye className="w-4 h-4" aria-hidden /> : <EyeOff className="w-4 h-4" aria-hidden />}
              <span className="md:hidden">Prefill</span>
              <span className="hidden md:inline">{includeAll ? "Showing prefill" : "Hiding prefill"}</span>
            </ToolButton>

            <ToolButton
              onClick={toggleRange}
              active={rangeOpen}
              aria-expanded={rangeOpen}
              aria-label={`Time range: ${rangeLabel}`}
              title="Time range filter"
              className="min-w-0"
            >
              <CalendarRange className="w-4 h-4 shrink-0" aria-hidden />
              <span className="max-w-[7rem] md:max-w-[12rem] truncate">{rangeLabel}</span>
              <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-ink-3 transition-transform ${rangeOpen ? "rotate-180" : ""}`} aria-hidden />
            </ToolButton>

            <Link href="/display" className={linkCls} aria-label="Display: fullscreen 16:9 view" title="Fullscreen 16:9 view for a TV or projector">
              <MonitorPlay className="w-4 h-4" aria-hidden />
              <span>Display</span>
            </Link>

            <Link
              href="/status"
              className={linkCls}
              aria-label="Status check"
              title="Check whether this network's LanCache is intercepting supported services"
            >
              <Radar className="w-4 h-4" aria-hidden />
              <span className="lg:hidden">Status</span>
              <span className="hidden lg:inline">Status check</span>
            </Link>

            {canAdmin && (
              <div className="relative">
                <ToolButton
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-expanded={menuOpen}
                  aria-label="Manage: ingest, rebuild, and depot actions"
                  active={menuOpen}
                  title="Ingest, rebuild, and depot actions"
                >
                  {ingest.running || depot.running ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-accent" aria-hidden />
                  ) : (
                    <Database className="w-4 h-4" aria-hidden />
                  )}
                  <span>Manage</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-ink-3 transition-transform ${menuOpen ? "rotate-180" : ""}`} aria-hidden />
                </ToolButton>

                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 mt-2 w-64 z-40 rounded-xl border border-line-strong bg-raised shadow-[0_16px_40px_rgba(0,0,0,0.5)] p-1.5" role="menu">
                      <MenuItem
                        icon={RefreshCw}
                        label={ingest.running ? "Ingesting…" : "Ingest new logs"}
                        hint="Add log lines written since the last run"
                        disabled={ingest.running}
                        onClick={() => { setMenuOpen(false); handleIngest(false); }}
                      />
                      <MenuItem
                        icon={Boxes}
                        label={depot.running ? "Updating depots…" : "Update depots"}
                        hint="Refresh the Steam depot → game name mapping"
                        disabled={depot.running}
                        onClick={() => { setMenuOpen(false); handleDepotRefresh(); }}
                      />
                      <div className="my-1.5 border-t border-line" />
                      <MenuItem
                        icon={AlertTriangle}
                        label="Rebuild from log…"
                        hint="Clears totals and recounts from access.log"
                        danger
                        disabled={ingest.running}
                        onClick={() => { setMenuOpen(false); setRebuildOpen(true); }}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {authRequired &&
              (adminKey ? (
                <ToolButton onClick={handleLock} active tone="cache" aria-label="Admin: log out" title="Log out of admin on this browser">
                  <Unlock className="w-4 h-4" aria-hidden />
                  <span>Admin</span>
                </ToolButton>
              ) : (
                <ToolButton onClick={openAdminModal} aria-label="Admin login" title="Log in to manage the dashboard">
                  <Lock className="w-4 h-4" aria-hidden />
                  <span>Admin</span>
                </ToolButton>
              ))}
          </nav>
        </div>

        {(ingest.running || depot.running) && (
          <div className="max-w-[90rem] mx-auto px-5 pb-3 space-y-2">
            {ingest.running && (
              <ProgressBar
                label="Ingesting logs"
                detail={`${ingest.lines.toLocaleString()} entries · ${ingest.percent}%`}
                percent={ingest.percent}
              />
            )}
            {depot.running && (
              <ProgressBar
                label={
                  depot.phase === "checking" ? "Checking for updates"
                  : depot.phase === "downloading" ? "Downloading depot mappings"
                  : depot.phase === "parsing" ? "Parsing mappings"
                  : "Applying mappings"
                }
                detail={depot.phase === "downloading" ? `${depot.percent}% · ${formatBytes(depot.speedBps)}/s` : "Working…"}
                percent={depot.phase === "downloading" ? depot.percent : 100}
                indeterminate={depot.phase !== "downloading"}
              />
            )}
          </div>
        )}

        {((!ingest.running && ingest.message) || (!depot.running && depot.message)) && (
          <div className="max-w-[90rem] mx-auto px-5 pb-2 flex flex-wrap gap-x-6 text-xs" role="status">
            {!ingest.running && ingest.message && <span className={ingest.error ? "text-danger" : "text-ink-3"}>{ingest.message}</span>}
            {!depot.running && depot.message && <span className="text-ink-3">{depot.message}</span>}
          </div>
        )}
      </header>

      <main className="max-w-[90rem] mx-auto px-5 py-6 space-y-5">
        <RangePanel
          open={rangeOpen}
          selection={selection}
          onSelect={handleSelectRange}
          canAdmin={canAdmin}
          adminHeaders={adminHeaders}
          onAdminRejected={handleLock}
        />

        <SummaryBand overview={data?.overview} rangeLabel={rangeLabel} services={data?.services || []} />

        {/* Live gets the full width: at an event this can be hundreds of clients */}
        <LiveDownloads includeAll={includeAll} />

        <BandwidthChart data={data?.bandwidth || []} granularity={data?.bandwidthGranularity || "day"} />

        <CachedGames data={gamesData} />

        <ServiceChart data={data?.services || []} />

        <div className="grid gap-5 lg:grid-cols-12 items-start">
          <ClientsTable clients={clients} className="lg:col-span-7" />
          <RecentActivity entries={recent} className="lg:col-span-5" />
        </div>
      </main>

      <footer className="border-t border-line mt-10">
        <div className="max-w-[90rem] mx-auto px-5 py-5 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-3">
          <p>
            LanCache Dashboard by{" "}
            <a href="https://github.com/imahmud1" target="_blank" rel="noopener noreferrer" className="text-ink-2 hover:text-ink underline-offset-4 hover:underline">
              imahmud1
            </a>
            {" · "}
            <a href="https://github.com/imahmud1/lancache-dashboard" target="_blank" rel="noopener noreferrer" className="text-ink-2 hover:text-ink underline-offset-4 hover:underline">
              Source
            </a>
          </p>
          <p>MIT License</p>
        </div>
      </footer>

      {rebuildOpen && (
        <Modal onClose={() => setRebuildOpen(false)} labelledBy="rebuild-title">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" aria-hidden />
            <div>
              <h3 id="rebuild-title" className="text-base font-semibold text-ink">Rebuild from log?</h3>
              <p className="text-sm text-ink-2 mt-1.5 leading-relaxed">
                This clears all current totals and recounts from <span className="font-mono text-ink">access.log</span>. It fixes inflated numbers, but any
                history that has already rotated out of the log <span className="text-danger">can&apos;t be recovered</span>.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={() => setRebuildOpen(false)}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-ink-2 bg-panel hover:text-ink border border-line hover:border-line-strong transition-colors"
            >
              Cancel
            </button>
            <button onClick={confirmRebuild} className="h-9 px-4 rounded-lg text-[13px] font-semibold text-white bg-[#c93c37] hover:bg-[#da4540] transition-colors">
              Rebuild
            </button>
          </div>
        </Modal>
      )}

      {adminModalOpen && (
        <Modal onClose={() => setAdminModalOpen(false)} labelledBy="admin-title">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-accent shrink-0 mt-0.5" aria-hidden />
            <div className="flex-1">
              <h3 id="admin-title" className="text-base font-semibold text-ink">Admin login</h3>
              <p className="text-sm text-ink-2 mt-1.5">Viewing is open to everyone. Log in to ingest, rebuild, update depots and manage saved ranges on this browser.</p>
            </div>
          </div>
          <label className="block mt-4">
            <span className="sr-only">Admin password</span>
            <input
              type="password"
              autoFocus
              value={adminInput}
              onChange={(e) => setAdminInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitAdminKey()}
              placeholder="Admin password"
              className="w-full h-10 px-3.5 bg-ground/60 border border-line rounded-lg text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
            />
          </label>
          {adminError && (
            <p className="mt-2 text-xs text-danger" role="alert">
              {adminError}
            </p>
          )}
          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={() => setAdminModalOpen(false)}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-ink-2 bg-panel hover:text-ink border border-line hover:border-line-strong transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submitAdminKey}
              disabled={adminChecking || !adminInput.trim()}
              className="h-9 px-4 rounded-lg text-[13px] font-semibold text-ground bg-accent hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {adminChecking ? "Checking…" : "Log in"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose, labelledBy }: { children: ReactNode; onClose: () => void; labelledBy: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <div className="absolute inset-0 bg-black/65" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-line-strong bg-raised shadow-[0_24px_64px_rgba(0,0,0,0.6)] p-6">{children}</div>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  hint,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof RefreshCw;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-start gap-3 px-3 py-2 rounded-lg text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        danger ? "hover:bg-danger/10" : "hover:bg-panel"
      }`}
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${danger ? "text-danger" : "text-ink-3"}`} aria-hidden />
      <span className="min-w-0">
        <span className={`block text-[13px] font-medium ${danger ? "text-danger" : "text-ink"}`}>{label}</span>
        {hint && <span className="block text-xs text-ink-3 leading-snug mt-0.5">{hint}</span>}
      </span>
    </button>
  );
}

function ProgressBar({ label, detail, percent, indeterminate }: { label: string; detail?: string; percent: number; indeterminate?: boolean }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={indeterminate ? undefined : percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="flex items-center justify-between mb-1 text-xs">
        <span className="font-medium text-ink-2">{label}</span>
        {detail && <span className="figure text-ink-3">{detail}</span>}
      </div>
      <div className="h-1 rounded-full bg-raised overflow-hidden">
        <div
          className={`h-full rounded-full bg-accent transition-[width] duration-300 ${indeterminate ? "animate-pulse w-full" : ""}`}
          style={indeterminate ? undefined : { width: `${Math.max(percent, 2)}%` }}
        />
      </div>
    </div>
  );
}
