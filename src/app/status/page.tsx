"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Radar,
  CheckCircle2,
  XCircle,
  Search,
  RefreshCw,
  ArrowLeft,
  TriangleAlert,
  ShieldCheck,
  ShieldOff,
  ShieldAlert,
  Server,
  Globe,
  Gauge,
  ChevronRight,
  Copy,
  Check,
  Zap,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardList,
  Download,
} from "lucide-react";
import Link from "next/link";
import { getServiceColor } from "@/lib/services";

const WILDCARD_PREFIX = "lancachetest.";
const INTERVAL_OPTIONS = [5, 10, 20, 30];

interface ServiceEntry {
  key: string;
  label: string;
  description: string;
  domains: string[];
}

type Status = "loading" | "resolved" | "partial" | "unresolved";
type Filter = "all" | "resolved" | "partial" | "unresolved";

interface DomainResult {
  domain: string;
  target?: string; // actual hostname tested (wildcards become lancachetest.*)
  ok: boolean;
  ms: number;
  host?: string;
  reason?: string; // why a check failed
}

interface ServiceResult {
  status: Status;
  working: number;
  total: number;
  domains: DomainResult[];
  respondingHost?: string;
  avgMs: number;
}

/**
 * Fires a heartbeat request from the visitor's browser straight to the CDN
 * hostname. When that hostname points at a LanCache instance, nginx answers
 * /lancache-heartbeat with HTTP 204 plus an X-LanCache-Processed-By header.
 * A real CDN has no such endpoint, so the request fails or is blocked.
 */
async function checkDomain(domain: string): Promise<DomainResult> {
  const target = domain.replace(/^\*\./, WILDCARD_PREFIX);
  const start = performance.now();
  try {
    const res = await fetch(`//${target}/lancache-heartbeat`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const ms = Math.round(performance.now() - start);
    if (res.status === 204) {
      return { domain, target, ok: true, ms, host: res.headers.get("X-LanCache-Processed-By") || undefined };
    }
    // Something answered but it wasn't the cache's heartbeat.
    return { domain, target, ok: false, ms, reason: "not cached" };
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    const reason = e instanceof DOMException && e.name === "TimeoutError" ? "timed out" : "no response";
    return { domain, target, ok: false, ms, reason };
  }
}

export default function StatusPage() {
  const [services, setServices] = useState<ServiceEntry[]>([]);
  const [results, setResults] = useState<Record<string, ServiceResult>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [live, setLive] = useState(false);
  const [intervalSec, setIntervalSec] = useState(20);
  const [reportCopied, setReportCopied] = useState(false);
  const [isHttps, setIsHttps] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [origin, setOrigin] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Custom domain test
  const [customDomain, setCustomDomain] = useState("");
  const [customResult, setCustomResult] = useState<DomainResult | null>(null);
  const [customChecking, setCustomChecking] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsHttps(window.location.protocol === "https:");
      setOrigin(window.location.host);
    }
    fetch("/api/cache-domains")
      .then((r) => r.json())
      .then((d) => setServices(d.services || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const hasRunRef = useRef(false);
  const runChecks = useCallback(async () => {
    if (services.length === 0) return;
    setRunning(true);
    const started = performance.now();

    // Only show the "loading" skeleton on the very first run. On live refreshes
    // we update each service in place so the counts and verdict never flicker.
    if (!hasRunRef.current) {
      setResults(() => {
        const seed: Record<string, ServiceResult> = {};
        for (const s of services) seed[s.key] = { status: "loading", working: 0, total: s.domains.length, domains: [], respondingHost: undefined, avgMs: 0 };
        return seed;
      });
    }

    await Promise.all(
      services.map(async (s) => {
        const domainResults = await Promise.all(s.domains.map((d) => checkDomain(d)));
        const working = domainResults.filter((d) => d.ok).length;
        const respondingHost = domainResults.find((d) => d.host)?.host;
        const okMs = domainResults.filter((d) => d.ok).map((d) => d.ms);
        const avgMs = okMs.length ? Math.round(okMs.reduce((a, b) => a + b, 0) / okMs.length) : 0;
        const status: Status = working === 0 ? "unresolved" : working < s.domains.length ? "partial" : "resolved";
        setResults((prev) => ({ ...prev, [s.key]: { status, working, total: s.domains.length, domains: domainResults, respondingHost, avgMs } }));
      })
    );

    setDurationMs(Math.round(performance.now() - started));
    setLastRun(new Date());
    hasRunRef.current = true;
    setHasRun(true);
    setRunning(false);
  }, [services]);

  // Initial auto-run
  useEffect(() => {
    if (services.length > 0 && Object.keys(results).length === 0) runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services]);

  // Live auto-refresh (only while the page is open)
  const runRef = useRef(runChecks);
  runRef.current = runChecks;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => runRef.current(), intervalSec * 1000);
    return () => clearInterval(id);
  }, [live, intervalSec]);

  const handleCustomCheck = async () => {
    const d = customDomain.trim();
    if (!d) return;
    setCustomChecking(true);
    setCustomResult(null);
    setCustomResult(await checkDomain(d));
    setCustomChecking(false);
  };

  const handleToggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const summary = useMemo(() => {
    const acc = { resolved: 0, partial: 0, unresolved: 0, loading: 0 };
    for (const r of Object.values(results)) acc[r.status]++;
    return acc;
  }, [results]);

  const totalDomains = useMemo(() => services.reduce((n, s) => n + s.domains.length, 0), [services]);
  const resolvedDomains = useMemo(() => Object.values(results).reduce((n, r) => n + r.working, 0), [results]);
  const cacheHost = useMemo(() => {
    for (const r of Object.values(results)) if (r.respondingHost) return r.respondingHost;
    return undefined;
  }, [results]);
  const latencies = useMemo(
    () => Object.values(results).flatMap((r) => r.domains.filter((d) => d.ok).map((d) => d.ms)),
    [results]
  );
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const fastestLatency = latencies.length ? Math.min(...latencies) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter((s) => {
      const r = results[s.key];
      const matchesFilter = filter === "all" || r?.status === filter;
      const matchesQuery = !q || s.label.toLowerCase().includes(q) || s.domains.some((d) => d.toLowerCase().includes(q));
      return matchesFilter && matchesQuery;
    });
  }, [services, results, filter, query]);

  const allExpanded = filtered.length > 0 && filtered.every((s) => expanded.has(s.key));
  const toggleAll = () => {
    setExpanded(allExpanded ? new Set() : new Set(filtered.map((s) => s.key)));
  };

  const anyResolved = summary.resolved + summary.partial > 0;
  const verdict: "active" | "partial" | "none" | "pending" = !hasRun
    ? "pending"
    : summary.resolved > 0 && summary.unresolved === 0
    ? "active"
    : anyResolved
    ? "partial"
    : "none";

  const distinctInstances = useMemo(() => {
    const set = new Set<string>();
    for (const r of Object.values(results)) if (r.respondingHost) set.add(r.respondingHost);
    return set.size;
  }, [results]);

  const buildReport = () => {
    const L: string[] = [];
    L.push(`LanCache Status Check — ${new Date().toLocaleString()}`);
    L.push(`Serving host: ${origin || "unknown"} (${isHttps ? "https" : "http"})`);
    if (cacheHost) L.push(`Responding cache instance: ${cacheHost}${distinctInstances > 1 ? ` (+${distinctInstances - 1} more)` : ""}`);
    L.push(`Services resolved: ${summary.resolved + summary.partial}/${services.length}`);
    L.push(`Domains resolved: ${resolvedDomains}/${totalDomains}`);
    if (avgLatency != null) L.push(`Average response: ${avgLatency} ms`);
    L.push("");
    for (const s of services) {
      const r = results[s.key];
      const doms = r?.domains.length ? r.domains : s.domains.map((d) => ({ domain: d, ok: false, ms: 0 } as DomainResult));
      L.push(`[${s.label}] ${r ? r.status : "unchecked"} ${r ? `${r.working}/${r.total}` : ""}`.trimEnd());
      for (const d of doms) {
        L.push(`   ${d.domain}  |  ${d.ok ? `${d.ms}ms` : "-"}  |  ${d.ok ? "resolved" : d.reason ?? "unresolved"}`);
      }
      L.push("");
    }
    return L.join("\n");
  };

  const copyReport = () => {
    navigator.clipboard?.writeText(buildReport()).then(() => {
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 1800);
    });
  };

  const downloadReport = () => {
    const blob = new Blob([buildReport()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lancache-status-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-ground text-ink">
      {/* Header: same chrome as the dashboard */}
      <header className="sticky top-0 z-20 border-b border-line bg-ground/85 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-5 min-h-16 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-accent/12 text-accent flex items-center justify-center" aria-hidden>
              <Radar className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-base font-semibold leading-tight text-ink">Status check</h1>
              <p className="text-xs text-ink-3 mt-0.5">Is this network using the cache?</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/" className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-line bg-panel text-[13px] font-medium text-ink-2 hover:text-ink hover:border-line-strong transition-colors">
              <ArrowLeft className="w-4 h-4" aria-hidden />
              <span>Dashboard</span>
            </Link>
            <button
              onClick={() => setLive((v) => !v)}
              aria-pressed={live}
              title={live ? `Live: re-checking every ${intervalSec}s` : "Auto re-check while this page is open"}
              className={`inline-flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] font-medium border transition-colors ${
                live ? "bg-accent/10 border-accent/40 text-ink" : "bg-panel border-line text-ink-2 hover:text-ink hover:border-line-strong"
              }`}
            >
              <span className={`relative flex h-2 w-2 ${live ? "" : "opacity-50"}`}>
                {live && <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-75 animate-ping" />}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${live ? "bg-accent" : "bg-ink-3"}`} />
              </span>
              <span>Live</span>
            </button>
            {live && (
              <select
                value={intervalSec}
                onChange={(e) => setIntervalSec(Number(e.target.value))}
                aria-label="Re-check interval"
                title="How often to re-check while Live"
                className="h-9 px-2.5 bg-panel border border-line rounded-lg text-[13px] text-ink focus:outline-none focus:border-accent/60 cursor-pointer"
              >
                {INTERVAL_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}s</option>
                ))}
              </select>
            )}
            <button
              onClick={runChecks}
              disabled={running || loading}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[13px] font-semibold text-ground bg-accent hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <RefreshCw className={`w-4 h-4 ${running ? "animate-spin" : ""}`} aria-hidden />
              {running ? "Testing…" : "Re-run"}
            </button>
          </div>
        </div>
      </header>

      <main className="relative max-w-5xl mx-auto px-6 py-8 space-y-5">
        <VerdictHero
          verdict={verdict}
          running={running}
          resolvedServices={summary.resolved + summary.partial}
          totalServices={services.length}
          resolvedDomains={resolvedDomains}
          totalDomains={totalDomains}
          lastRun={lastRun}
          durationMs={durationMs}
        />

        {isHttps && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-internet/10 border border-internet/25">
            <TriangleAlert className="w-5 h-5 text-internet shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-internet">This page is loaded over HTTPS</p>
              <p className="text-internet/70 mt-0.5">
                Browsers block secure pages from reaching the cache&apos;s plain-HTTP heartbeat, so results below may read as
                unresolved even when the cache works. Open this page over <span className="font-mono text-internet">http://</span> for accurate results.
              </p>
            </div>
          </div>
        )}

        {/* Session / network info */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <CacheResponseTile host={cacheHost} instances={distinctInstances} loading={!hasRun} />
          <InfoTile icon={Gauge} label="Avg response" value={avgLatency != null ? `${avgLatency} ms` : "—"} sub={avgLatency != null ? "per resolved domain" : undefined} loading={!hasRun} />
          <InfoTile icon={Zap} label="Fastest response" value={fastestLatency != null ? `${fastestLatency} ms` : "—"} sub={fastestLatency != null ? "quickest heartbeat" : undefined} loading={!hasRun} />
          <InfoTile icon={Globe} label="Serving host" value={origin || "—"} sub={isHttps ? "https" : "http"} mono />
        </div>

        {/* Custom domain test */}
        <div className="rounded-xl bg-panel/60 border border-line p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-cache" />
            <h3 className="text-sm font-semibold text-ink">Test any domain</h3>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="lancache.steamcontent.com   or   *.cdn.blizzard.com"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCustomCheck()}
              className="flex-1 px-4 py-2.5 bg-ground/60 border border-line-strong rounded-xl text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-cache/30 focus:border-cache/50"
            />
            <button
              onClick={handleCustomCheck}
              disabled={customChecking}
              className="px-6 py-2.5 bg-raised hover:bg-line-strong border border-line-strong disabled:opacity-60 rounded-xl text-sm font-medium transition-colors"
            >
              {customChecking ? "Testing…" : "Test"}
            </button>
          </div>
          {customResult && (
            <div
              className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm rounded-xl px-3 py-2.5 border ${
                customResult.ok
                  ? "text-cache bg-cache/10 border-cache/25"
                  : "text-danger bg-danger/10 border-danger/25"
              }`}
            >
              {customResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
              <span className="font-mono text-[13px]">{customResult.domain}</span>
              <span className="text-ink-3">·</span>
              <span>{customResult.ok ? "Resolved through LanCache" : "Not routed through LanCache"}</span>
              <span className="ml-auto flex items-center gap-3 text-[11px] text-ink-3">
                <span>{customResult.ms} ms</span>
                {customResult.ok && customResult.host && <span className="font-mono text-cache/80 truncate max-w-[160px]">{customResult.host}</span>}
              </span>
            </div>
          )}
        </div>

        {/* Services */}
        <div>
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
              <input
                type="text"
                placeholder="Filter services or domains…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-panel/60 border border-line rounded-xl text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:border-line-strong"
              />
            </div>
            <div className="flex items-center gap-1 p-1 bg-panel/60 border border-line rounded-xl overflow-x-auto">
              <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" count={services.length} />
              <FilterChip active={filter === "resolved"} onClick={() => setFilter("resolved")} label="Resolved" count={summary.resolved} tone="emerald" />
              <FilterChip active={filter === "partial"} onClick={() => setFilter("partial")} label="Partial" count={summary.partial} tone="amber" />
              <FilterChip active={filter === "unresolved"} onClick={() => setFilter("unresolved")} label="Unresolved" count={summary.unresolved} tone="rose" />
            </div>
            <button
              onClick={toggleAll}
              disabled={filtered.length === 0}
              title={allExpanded ? "Collapse all" : "Expand all"}
              className="flex items-center gap-1.5 px-3 py-2 bg-panel/60 border border-line hover:border-line-strong disabled:opacity-50 rounded-xl text-[12px] font-medium text-ink-2 hover:text-ink transition-colors whitespace-nowrap"
            >
              {allExpanded ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{allExpanded ? "Collapse" : "Expand"} all</span>
            </button>
            <div className="flex items-center rounded-xl bg-panel/60 border border-line overflow-hidden">
              <button
                onClick={copyReport}
                disabled={!hasRun}
                title="Copy a text report of these results"
                className="flex items-center gap-1.5 px-3 py-2 hover:bg-raised/60 disabled:opacity-50 text-[12px] font-medium text-ink-2 hover:text-ink transition-colors whitespace-nowrap"
              >
                {reportCopied ? <Check className="w-3.5 h-3.5 text-cache" /> : <ClipboardList className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{reportCopied ? "Copied" : "Copy report"}</span>
              </button>
              <button
                onClick={downloadReport}
                disabled={!hasRun}
                title="Download report as a .txt file"
                className="flex items-center px-2.5 py-2 border-l border-line hover:bg-raised/60 disabled:opacity-50 text-ink-2 hover:text-ink transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          {loading ? (
            <div className="rounded-xl border border-line bg-panel/40 divide-y divide-line/70 overflow-hidden">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-line bg-panel/40 p-10 text-center text-sm text-ink-3">
              No services match your filter.
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-panel/40 divide-y divide-line/70 overflow-hidden">
              {filtered.map((s) => (
                <ServiceRow
                  key={s.key}
                  service={s}
                  result={results[s.key]}
                  expanded={expanded.has(s.key)}
                  onToggle={() => handleToggle(s.key)}
                />
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] text-ink-3 text-center">
            Domain list sourced from{" "}
            <a href="https://github.com/uklans/cache-domains" target="_blank" rel="noopener noreferrer" className="text-ink-3 hover:text-ink underline underline-offset-2 transition-colors">
              uklans/cache-domains
            </a>
          </p>
        </div>

        {/* How it works */}
        <div className="rounded-xl bg-panel/40 border border-line/70 p-5 text-sm text-ink-2 leading-relaxed">
          <p className="font-semibold text-ink mb-1.5">How this works</p>
          <p>
            {"Your browser sends a tiny "}
            <span className="font-mono text-ink">/lancache-heartbeat</span>
            {" request to each CDN hostname. If this network's DNS points that hostname at a LanCache server, the cache replies with a special HTTP "}
            <span className="font-mono text-ink">204</span>
            {" and identifies itself — that counts as "}
            <span className="text-cache font-medium">Resolved</span>
            {". A real CDN has no such endpoint, so the request is rejected and shows as "}
            <span className="text-danger font-medium">Unresolved</span>
            {". Resolved means traffic for that service is being intercepted by the cache; it does not measure what is currently stored on disk."}
          </p>
          <p className="mt-2.5 text-ink-3">
            {"Every check runs entirely in your browser against your own connection, so the results reflect the network you're on right now — not the server hosting this page. Nothing is measured or stored server-side."}
          </p>
        </div>
      </main>
    </div>
  );
}

function VerdictHero({
  verdict,
  running,
  resolvedServices,
  totalServices,
  resolvedDomains,
  totalDomains,
  lastRun,
  durationMs,
}: {
  verdict: "active" | "partial" | "none" | "pending";
  running: boolean;
  resolvedServices: number;
  totalServices: number;
  resolvedDomains: number;
  totalDomains: number;
  lastRun: Date | null;
  durationMs: number | null;
}) {
  const config = {
    active: {
      icon: ShieldCheck,
      tint: "bg-cache/[0.07] border-cache/30",
      iconBg: "bg-cache/15 text-cache ring-cache/30",
      title: "LanCache is active on this network",
      sub: "Supported services are being intercepted and cached.",
    },
    partial: {
      icon: ShieldAlert,
      tint: "bg-internet/[0.07] border-internet/30",
      iconBg: "bg-internet/15 text-internet ring-internet/30",
      title: "LanCache is partially active",
      sub: "Some services resolve to the cache while others go straight to the internet.",
    },
    none: {
      icon: ShieldOff,
      tint: "bg-danger/[0.07] border-danger/30",
      iconBg: "bg-danger/15 text-danger ring-danger/30",
      title: "No LanCache detected",
      sub: "This network isn't routing supported services through a cache.",
    },
    pending: {
      icon: Radar,
      tint: "bg-panel border-line",
      iconBg: "bg-line-strong/40 text-ink ring-line-strong/40",
      title: running ? "Testing this network…" : "Ready to test",
      sub: "Checking each supported CDN hostname from your browser.",
    },
  }[verdict];

  const Icon = config.icon;
  const showCounts = verdict === "active" || verdict === "partial";

  return (
    <div className={`relative overflow-hidden rounded-xl border p-6 sm:p-7 transition-colors duration-500 ${config.tint}`}>
      <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
        <div className={`w-16 h-16 rounded-xl ring-1 flex items-center justify-center shrink-0 ${config.iconBg}`}>
          <Icon className={`w-8 h-8 ${running ? "animate-pulse" : ""}`} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-[-0.01em] text-ink">{config.title}</h2>
          <p className="text-sm text-ink-2 mt-1">{config.sub}</p>
          {lastRun && (
            <p className="text-[11px] text-ink-3 mt-3">
              Checked {lastRun.toLocaleTimeString()}
              {durationMs != null && ` · ${(durationMs / 1000).toFixed(1)}s`}
            </p>
          )}
        </div>
        {showCounts && (
          <div className="flex gap-6 sm:gap-8 shrink-0">
            <Counter value={resolvedServices} total={totalServices} label="services" />
            <Counter value={resolvedDomains} total={totalDomains} label="domains" />
          </div>
        )}
      </div>
    </div>
  );
}

function Counter({ value, total, label }: { value: number; total: number; label: string }) {
  return (
    <div className="sm:text-right">
      <div className="figure text-4xl font-semibold text-ink leading-none">
        {value}
        <span className="text-lg text-ink-3 font-medium">/{total}</span>
      </div>
      <p className="text-[11px] text-ink-3 mt-1">{label}</p>
    </div>
  );
}

function InfoTile({
  icon: Icon,
  label,
  value,
  sub,
  mono,
  loading,
}: {
  icon: typeof Radar;
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl bg-panel/60 border border-line p-4">
      <div className="flex items-center gap-2 text-[11px] text-ink-3 mb-2">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      {loading ? (
        <div className="h-4 w-24 rounded bg-raised animate-pulse" />
      ) : (
        <div className={`text-sm text-ink truncate ${mono ? "font-mono" : "font-semibold"}`}>{value}</div>
      )}
      {sub && !loading && <div className="text-[11px] text-ink-3 mt-0.5">{sub}</div>}
    </div>
  );
}

/**
 * The primary evidence: whether a cache actually answered the visitor's
 * heartbeat. The X-LanCache-Processed-By value (a container ID/hostname) is kept
 * as small supporting proof — it's cryptic but uniquely fingerprints the cache
 * that replied, which matters in multi-node setups and for support reports.
 * Correct for every visitor; no server-side resolution or DNS config.
 */
function CacheResponseTile({ host, instances, loading }: { host?: string; instances: number; loading: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!host) return;
    navigator.clipboard?.writeText(host).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const accent = host ? "bg-cache/[0.07] border-cache/25" : "bg-panel/60 border-line";
  const iconColor = host ? "text-cache/90" : "text-ink-3";

  return (
    <div className={`rounded-xl border p-4 ${accent}`}>
      <div className={`flex items-center gap-2 text-[11px] mb-2 ${iconColor}`}>
        <Server className="w-3.5 h-3.5" /> Cache response
      </div>
      {loading ? (
        <div className="h-4 w-24 rounded bg-raised animate-pulse" />
      ) : host ? (
        <>
          <div className="text-sm font-semibold text-cache">
            Confirmed{instances > 1 ? ` · ${instances} nodes` : ""}
          </div>
          <button onClick={copy} className="group mt-0.5 flex items-center gap-1.5 max-w-full" title="Copy cache ID">
            <span className="font-mono text-[11px] text-ink-3 truncate group-hover:text-ink-2">{host}</span>
            {copied ? <Check className="w-3 h-3 text-cache shrink-0" /> : <Copy className="w-3 h-3 text-ink-3 group-hover:text-ink-2 shrink-0" />}
          </button>
        </>
      ) : (
        <>
          <div className="text-sm font-semibold text-ink-2">Not detected</div>
          <div className="text-[11px] text-ink-3 mt-0.5">no heartbeat came back</div>
        </>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone?: "emerald" | "amber" | "rose" }) {
  const dot = tone === "emerald" ? "bg-cache" : tone === "amber" ? "bg-internet" : tone === "rose" ? "bg-danger" : "bg-ink-3";
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors ${
        active ? "bg-line-strong text-ink" : "text-ink-2 hover:text-ink"
      }`}
    >
      {tone && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      {label}
      <span className={`text-[10px] ${active ? "text-ink" : "text-ink-3"}`}>{count}</span>
    </button>
  );
}

function ServiceRow({
  service,
  result,
  expanded,
  onToggle,
}: {
  service: ServiceEntry;
  result?: ServiceResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = result?.status ?? "loading";
  const working = result?.working ?? 0;
  const total = result?.total ?? service.domains.length;
  const pct = total > 0 ? (working / total) * 100 : 0;
  const color = getServiceColor(service.key);

  const badge = {
    loading: { label: "Checking", cls: "text-ink-2 bg-raised/70", dot: "bg-ink-3 animate-pulse", bar: "bg-line-strong" },
    resolved: { label: "Resolved", cls: "text-cache bg-cache/10", dot: "bg-cache", bar: "bg-cache" },
    partial: { label: "Partial", cls: "text-internet bg-internet/10", dot: "bg-internet", bar: "bg-internet" },
    unresolved: { label: "Unresolved", cls: "text-danger bg-danger/10", dot: "bg-danger", bar: "bg-danger" },
  }[status];

  const domains: DomainResult[] = result?.domains.length
    ? result.domains
    : service.domains.map((d) => ({ domain: d, ok: false, ms: 0 }));

  return (
    <div className={expanded ? "bg-panel/70" : ""}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 sm:gap-4 px-4 py-3 text-left hover:bg-raised/30 transition-colors">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-ink shrink-0"
          style={{ backgroundColor: color }}
        >
          {service.label.charAt(0).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-ink truncate">{service.label}</h4>
          <p className="text-[11px] text-ink-3 truncate">{service.description}</p>
        </div>

        {/* Progress track */}
        <div className="hidden md:flex items-center gap-2.5 w-40 shrink-0">
          <div className="flex-1 h-1.5 rounded-full bg-raised overflow-hidden">
            <div className={`h-full rounded-full ${badge.bar} transition-all duration-500`} style={{ width: `${status === "loading" ? 40 : Math.max(pct, working > 0 ? 6 : 0)}%` }} />
          </div>
          <span className="text-[11px] text-ink-3 w-9 text-right tabular-nums">{working}/{total}</span>
        </div>

        {/* Status badge */}
        <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium w-[104px] justify-center ${badge.cls}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
          {badge.label}
        </span>

        <ChevronRight className={`w-4 h-4 text-ink-3 transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`} />
      </button>

      {expanded && (
        <div className="bg-ground/40 border-t border-line/60">
          <div className="hidden sm:flex items-center gap-3 px-4 py-2 text-[10px] text-ink-3 border-b border-line/50">
            <span className="w-2" />
            <span className="flex-1">Domain</span>
            <span className="w-16 text-right">Latency</span>
            <span className="w-24 text-right">Status</span>
          </div>
          {domains.map((d) => (
            <div key={d.domain} className="flex items-center gap-3 px-4 py-2 border-b border-line/30 last:border-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${status === "loading" ? "bg-line-strong animate-pulse" : d.ok ? "bg-cache" : "bg-danger"}`} />
              <span
                className="font-mono text-[12px] text-ink truncate flex-1"
                title={d.target && d.target !== d.domain ? `tested: ${d.target}` : d.domain}
              >
                {d.domain}
              </span>
              <span className="hidden sm:block w-16 text-right text-[11px] text-ink-3 tabular-nums">{status === "loading" ? "…" : d.ok ? `${d.ms} ms` : "—"}</span>
              <span className={`w-24 text-right text-[11px] ${status === "loading" ? "text-ink-3" : d.ok ? "text-cache" : "text-danger/80"}`}>
                {status === "loading" ? "checking" : d.ok ? "resolved" : d.reason ?? "unresolved"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
