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
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-gradient-to-b from-emerald-500/[0.06] to-transparent" />

      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-gray-800/80 bg-gray-950/70 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Radar className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-none">Status Check</h1>
              <p className="text-[11px] text-gray-500 mt-0.5">Is this network using the cache?</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-400 hover:text-gray-200 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
            <button
              onClick={() => setLive((v) => !v)}
              title={live ? `Live: re-checking every ${intervalSec}s` : "Auto re-check while this page is open"}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                live ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200"
              }`}
            >
              <span className={`relative flex h-2 w-2 ${live ? "" : "opacity-50"}`}>
                {live && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${live ? "bg-emerald-400" : "bg-gray-500"}`} />
              </span>
              <span className="hidden sm:inline">Live</span>
            </button>
            {live && (
              <select
                value={intervalSec}
                onChange={(e) => setIntervalSec(Number(e.target.value))}
                title="How often to re-check while Live"
                className="px-2.5 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-300 focus:outline-none focus:border-gray-600 cursor-pointer"
              >
                {INTERVAL_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}s</option>
                ))}
              </select>
            )}
            <button
              onClick={runChecks}
              disabled={running || loading}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 disabled:text-gray-500 rounded-xl text-sm font-medium transition-colors shadow-lg shadow-emerald-600/20 disabled:shadow-none"
            >
              <RefreshCw className={`w-4 h-4 ${running ? "animate-spin" : ""}`} />
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
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25">
            <TriangleAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-amber-300">This page is loaded over HTTPS</p>
              <p className="text-amber-200/70 mt-0.5">
                Browsers block secure pages from reaching the cache&apos;s plain-HTTP heartbeat, so results below may read as
                unresolved even when the cache works. Open this page over <span className="font-mono text-amber-200">http://</span> for accurate results.
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
        <div className="rounded-2xl bg-gray-900/60 border border-gray-800 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-gray-200">Test any domain</h3>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="lancache.steamcontent.com   or   *.cdn.blizzard.com"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCustomCheck()}
              className="flex-1 px-4 py-2.5 bg-gray-950/60 border border-gray-700 rounded-xl text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50"
            />
            <button
              onClick={handleCustomCheck}
              disabled={customChecking}
              className="px-6 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 disabled:opacity-60 rounded-xl text-sm font-medium transition-colors"
            >
              {customChecking ? "Testing…" : "Test"}
            </button>
          </div>
          {customResult && (
            <div
              className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm rounded-xl px-3 py-2.5 border ${
                customResult.ok
                  ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                  : "text-rose-300 bg-rose-500/10 border-rose-500/25"
              }`}
            >
              {customResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
              <span className="font-mono text-[13px]">{customResult.domain}</span>
              <span className="text-gray-500">·</span>
              <span>{customResult.ok ? "Resolved through LanCache" : "Not routed through LanCache"}</span>
              <span className="ml-auto flex items-center gap-3 text-[11px] text-gray-500">
                <span>{customResult.ms} ms</span>
                {customResult.ok && customResult.host && <span className="font-mono text-emerald-400/80 truncate max-w-[160px]">{customResult.host}</span>}
              </span>
            </div>
          )}
        </div>

        {/* Services */}
        <div>
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Filter services or domains…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-gray-900/60 border border-gray-800 rounded-xl text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-700"
              />
            </div>
            <div className="flex items-center gap-1 p-1 bg-gray-900/60 border border-gray-800 rounded-xl overflow-x-auto">
              <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" count={services.length} />
              <FilterChip active={filter === "resolved"} onClick={() => setFilter("resolved")} label="Resolved" count={summary.resolved} tone="emerald" />
              <FilterChip active={filter === "partial"} onClick={() => setFilter("partial")} label="Partial" count={summary.partial} tone="amber" />
              <FilterChip active={filter === "unresolved"} onClick={() => setFilter("unresolved")} label="Unresolved" count={summary.unresolved} tone="rose" />
            </div>
            <button
              onClick={toggleAll}
              disabled={filtered.length === 0}
              title={allExpanded ? "Collapse all" : "Expand all"}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-900/60 border border-gray-800 hover:border-gray-700 disabled:opacity-50 rounded-xl text-[12px] font-medium text-gray-400 hover:text-gray-200 transition-colors whitespace-nowrap"
            >
              {allExpanded ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{allExpanded ? "Collapse" : "Expand"} all</span>
            </button>
            <div className="flex items-center rounded-xl bg-gray-900/60 border border-gray-800 overflow-hidden">
              <button
                onClick={copyReport}
                disabled={!hasRun}
                title="Copy a text report of these results"
                className="flex items-center gap-1.5 px-3 py-2 hover:bg-gray-800/60 disabled:opacity-50 text-[12px] font-medium text-gray-400 hover:text-gray-200 transition-colors whitespace-nowrap"
              >
                {reportCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <ClipboardList className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">{reportCopied ? "Copied" : "Copy report"}</span>
              </button>
              <button
                onClick={downloadReport}
                disabled={!hasRun}
                title="Download report as a .txt file"
                className="flex items-center px-2.5 py-2 border-l border-gray-800 hover:bg-gray-800/60 disabled:opacity-50 text-gray-400 hover:text-gray-200 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          {loading ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/40 divide-y divide-gray-800/70 overflow-hidden">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-10 text-center text-sm text-gray-500">
              No services match your filter.
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/40 divide-y divide-gray-800/70 overflow-hidden">
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
          <p className="mt-3 text-[11px] text-gray-600 text-center">
            Domain list sourced from{" "}
            <a href="https://github.com/uklans/cache-domains" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors">
              uklans/cache-domains
            </a>
          </p>
        </div>

        {/* How it works */}
        <div className="rounded-2xl bg-gray-900/40 border border-gray-800/70 p-5 text-sm text-gray-400 leading-relaxed">
          <p className="font-semibold text-gray-300 mb-1.5">How this works</p>
          <p>
            {"Your browser sends a tiny "}
            <span className="font-mono text-gray-300">/lancache-heartbeat</span>
            {" request to each CDN hostname. If this network's DNS points that hostname at a LanCache server, the cache replies with a special HTTP "}
            <span className="font-mono text-gray-300">204</span>
            {" and identifies itself — that counts as "}
            <span className="text-emerald-400 font-medium">Resolved</span>
            {". A real CDN has no such endpoint, so the request is rejected and shows as "}
            <span className="text-rose-400 font-medium">Unresolved</span>
            {". Resolved means traffic for that service is being intercepted by the cache; it does not measure what is currently stored on disk."}
          </p>
          <p className="mt-2.5 text-gray-500">
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
      ring: "from-emerald-500/25 to-emerald-500/0",
      iconBg: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
      title: "LanCache is active on this network",
      sub: "Supported services are being intercepted and cached.",
    },
    partial: {
      icon: ShieldAlert,
      ring: "from-amber-500/25 to-amber-500/0",
      iconBg: "bg-amber-500/15 text-amber-400 ring-amber-500/30",
      title: "LanCache is partially active",
      sub: "Some services resolve to the cache while others go straight to the internet.",
    },
    none: {
      icon: ShieldOff,
      ring: "from-rose-500/25 to-rose-500/0",
      iconBg: "bg-rose-500/15 text-rose-400 ring-rose-500/30",
      title: "No LanCache detected",
      sub: "This network isn't routing supported services through a cache.",
    },
    pending: {
      icon: Radar,
      ring: "from-gray-500/20 to-gray-500/0",
      iconBg: "bg-gray-700/40 text-gray-300 ring-gray-600/40",
      title: running ? "Testing this network…" : "Ready to test",
      sub: "Checking each supported CDN hostname from your browser.",
    },
  }[verdict];

  const Icon = config.icon;
  const showCounts = verdict === "active" || verdict === "partial";

  return (
    <div className="relative overflow-hidden rounded-3xl border border-gray-800 bg-gray-900/60 p-6 sm:p-7">
      <div className={`pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-gradient-to-br ${config.ring} blur-2xl`} />
      <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
        <div className={`w-16 h-16 rounded-2xl ring-1 flex items-center justify-center shrink-0 ${config.iconBg}`}>
          <Icon className={`w-8 h-8 ${running ? "animate-pulse" : ""}`} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight">{config.title}</h2>
          <p className="text-sm text-gray-400 mt-1">{config.sub}</p>
          {lastRun && (
            <p className="text-[11px] text-gray-600 mt-3">
              checked {lastRun.toLocaleTimeString()}
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
      <div className="text-3xl font-bold text-white leading-none">
        {value}
        <span className="text-lg text-gray-500 font-medium">/{total}</span>
      </div>
      <p className="text-[11px] text-gray-500 mt-1 uppercase tracking-wide">{label}</p>
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
    <div className="rounded-2xl bg-gray-900/60 border border-gray-800 p-4">
      <div className="flex items-center gap-2 text-[11px] text-gray-500 uppercase tracking-wide mb-2">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      {loading ? (
        <div className="h-4 w-24 rounded bg-gray-800 animate-pulse" />
      ) : (
        <div className={`text-sm text-gray-100 truncate ${mono ? "font-mono" : "font-semibold"}`}>{value}</div>
      )}
      {sub && !loading && <div className="text-[11px] text-gray-600 mt-0.5">{sub}</div>}
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

  const accent = host ? "bg-emerald-500/[0.07] border-emerald-500/25" : "bg-gray-900/60 border-gray-800";
  const iconColor = host ? "text-emerald-400/90" : "text-gray-500";

  return (
    <div className={`rounded-2xl border p-4 ${accent}`}>
      <div className={`flex items-center gap-2 text-[11px] uppercase tracking-wide mb-2 ${iconColor}`}>
        <Server className="w-3.5 h-3.5" /> Cache response
      </div>
      {loading ? (
        <div className="h-4 w-24 rounded bg-gray-800 animate-pulse" />
      ) : host ? (
        <>
          <div className="text-sm font-semibold text-emerald-300">
            Confirmed{instances > 1 ? ` · ${instances} nodes` : ""}
          </div>
          <button onClick={copy} className="group mt-0.5 flex items-center gap-1.5 max-w-full" title="Copy cache ID">
            <span className="font-mono text-[11px] text-gray-500 truncate group-hover:text-gray-400">{host}</span>
            {copied ? <Check className="w-3 h-3 text-emerald-400 shrink-0" /> : <Copy className="w-3 h-3 text-gray-600 group-hover:text-gray-400 shrink-0" />}
          </button>
        </>
      ) : (
        <>
          <div className="text-sm font-semibold text-gray-400">Not detected</div>
          <div className="text-[11px] text-gray-600 mt-0.5">no heartbeat came back</div>
        </>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone?: "emerald" | "amber" | "rose" }) {
  const dot = tone === "emerald" ? "bg-emerald-400" : tone === "amber" ? "bg-amber-400" : tone === "rose" ? "bg-rose-400" : "bg-gray-500";
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors ${
        active ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"
      }`}
    >
      {tone && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      {label}
      <span className={`text-[10px] ${active ? "text-gray-300" : "text-gray-600"}`}>{count}</span>
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
    loading: { label: "Checking", cls: "text-gray-400 bg-gray-800/70", dot: "bg-gray-500 animate-pulse", bar: "bg-gray-600" },
    resolved: { label: "Resolved", cls: "text-emerald-300 bg-emerald-500/10", dot: "bg-emerald-400", bar: "bg-emerald-500" },
    partial: { label: "Partial", cls: "text-amber-300 bg-amber-500/10", dot: "bg-amber-400", bar: "bg-amber-500" },
    unresolved: { label: "Unresolved", cls: "text-rose-300 bg-rose-500/10", dot: "bg-rose-400", bar: "bg-rose-500" },
  }[status];

  const domains: DomainResult[] = result?.domains.length
    ? result.domains
    : service.domains.map((d) => ({ domain: d, ok: false, ms: 0 }));

  return (
    <div className={expanded ? "bg-gray-900/70" : ""}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 sm:gap-4 px-4 py-3 text-left hover:bg-gray-800/30 transition-colors">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
          style={{ backgroundColor: color }}
        >
          {service.label.charAt(0).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-gray-100 truncate">{service.label}</h4>
          <p className="text-[11px] text-gray-500 truncate">{service.description}</p>
        </div>

        {/* Progress track */}
        <div className="hidden md:flex items-center gap-2.5 w-40 shrink-0">
          <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div className={`h-full rounded-full ${badge.bar} transition-all duration-500`} style={{ width: `${status === "loading" ? 40 : Math.max(pct, working > 0 ? 6 : 0)}%` }} />
          </div>
          <span className="text-[11px] text-gray-500 w-9 text-right tabular-nums">{working}/{total}</span>
        </div>

        {/* Status badge */}
        <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium w-[104px] justify-center ${badge.cls}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
          {badge.label}
        </span>

        <ChevronRight className={`w-4 h-4 text-gray-600 transition-transform shrink-0 ${expanded ? "rotate-90" : ""}`} />
      </button>

      {expanded && (
        <div className="bg-gray-950/40 border-t border-gray-800/60">
          <div className="hidden sm:flex items-center gap-3 px-4 py-2 text-[10px] uppercase tracking-wide text-gray-600 border-b border-gray-800/50">
            <span className="w-2" />
            <span className="flex-1">Domain</span>
            <span className="w-16 text-right">Latency</span>
            <span className="w-24 text-right">Status</span>
          </div>
          {domains.map((d) => (
            <div key={d.domain} className="flex items-center gap-3 px-4 py-2 border-b border-gray-800/30 last:border-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${status === "loading" ? "bg-gray-600 animate-pulse" : d.ok ? "bg-emerald-400" : "bg-rose-400"}`} />
              <span
                className="font-mono text-[12px] text-gray-300 truncate flex-1"
                title={d.target && d.target !== d.domain ? `tested: ${d.target}` : d.domain}
              >
                {d.domain}
              </span>
              <span className="hidden sm:block w-16 text-right text-[11px] text-gray-500 tabular-nums">{status === "loading" ? "…" : d.ok ? `${d.ms} ms` : "—"}</span>
              <span className={`w-24 text-right text-[11px] ${status === "loading" ? "text-gray-500" : d.ok ? "text-emerald-400" : "text-rose-400/80"}`}>
                {status === "loading" ? "checking" : d.ok ? "resolved" : d.reason ?? "unresolved"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
