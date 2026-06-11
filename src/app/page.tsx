"use client";

import { useEffect, useState, useCallback } from "react";
import { HardDrive, Activity, Users, Gauge, Database, RefreshCw, Boxes, Eye, EyeOff, Lock, Unlock, RotateCcw } from "lucide-react";
import { StatsCard } from "@/components/StatsCard";
import { ServiceChart } from "@/components/ServiceChart";
import { BandwidthChart } from "@/components/BandwidthChart";
import { ClientsTable } from "@/components/ClientsTable";
import { RecentActivity } from "@/components/RecentActivity";
import { LiveDownloads } from "@/components/LiveDownloads";
import { CachedGames } from "@/components/CachedGames";
import { CacheSavings } from "@/components/CacheSavings";
import { formatBytes, formatNumber } from "@/lib/format";

interface DashboardData {
  overview: {
    totalRequests: number;
    totalBytesSent: number;
    cacheHitRate: number;
    cacheHitRateByReq: number;
    servedFromCache: number;
    servedFromUpstream: number;
    totalClients: number;
    totalServices: number;
  };
  services: { service: string; bytesSent: number; requests: number; cacheHits: number; cacheMisses: number; hitBytes: number; missBytes: number }[];
  dailyBandwidth: { day: string; bytesSent: number; requests: number; cacheHits: number; cacheMisses: number; hitBytes: number; missBytes: number }[];
  hourlyToday: { hour: string; bytesSent: number }[];
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [clients, setClients] = useState<
    { clientIp: string; requests: number; bytesSent: number; cacheHits: number; cacheMisses: number; hitBytes: number; missBytes: number; topService: string }[]
  >([]);
  const [recent, setRecent] = useState<
    { id: number; timestamp: string; service: string; clientIp: string; requestPath: string; bytesSent: number; cacheStatus: string; upstreamHost: string }[]
  >([]);
  const [ingest, setIngest] = useState<{ running: boolean; percent: number; lines: number; message: string }>({
    running: false, percent: 0, lines: 0, message: "",
  });
  const [depot, setDepot] = useState<{ running: boolean; percent: number; phase: string; message: string; speedBps: number }>({
    running: false, percent: 0, phase: "idle", message: "", speedBps: 0,
  });
  const [includeAll, setIncludeAll] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load persisted toggle + admin key, and check whether auth is required
  useEffect(() => {
    const savedToggle = typeof window !== "undefined" ? localStorage.getItem("includeAll") : null;
    const savedKey = typeof window !== "undefined" ? localStorage.getItem("adminKey") : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (savedToggle === "1") setIncludeAll(true);
    if (savedKey) setAdminKey(savedKey);
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setAuthRequired(!!d.authRequired))
      .catch(() => {});
  }, []);

  const canAdmin = !authRequired || !!adminKey;
  const adminHeaders: HeadersInit | undefined = adminKey ? { "x-api-key": adminKey } : undefined;

  const handleUnlock = async () => {
    const key = typeof window !== "undefined" ? window.prompt("Enter admin key") : null;
    if (!key) return;
    try {
      const res = await fetch("/api/auth", { method: "POST", headers: { "x-api-key": key } });
      if (res.ok) {
        localStorage.setItem("adminKey", key);
        setAdminKey(key);
      } else {
        alert("Invalid admin key");
      }
    } catch {
      alert("Could not validate key");
    }
  };

  const handleLock = () => {
    localStorage.removeItem("adminKey");
    setAdminKey(null);
  };

  const fetchData = useCallback(async () => {
    try {
      const q = includeAll ? "?includeAll=1" : "";
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
  }, [includeAll]);

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
        alert("Admin key required or invalid. Please unlock again.");
        return;
      }
      if (res.status === 409) {
        // already running — just start polling
      }
    } catch {
      return;
    }
    setIngest((s) => ({ ...s, running: true, message: reprocess ? "Reprocessing..." : "Starting..." }));

    const poll = async () => {
      try {
        const r = await fetch("/api/ingest");
        const p = await r.json();
        setIngest({ running: p.running, percent: p.percent ?? 0, lines: p.lines ?? 0, message: p.message ?? "" });
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

  const handleDepotRefresh = async () => {
    try {
      const res = await fetch("/api/depots/refresh", { method: "POST", headers: adminHeaders });
      if (res.status === 401) {
        handleLock();
        alert("Admin key required or invalid. Please unlock again.");
        return;
      }
    } catch {
      return;
    }
    setDepot((s) => ({ ...s, running: true, message: "Starting..." }));

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
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 flex items-center gap-3">
          <RefreshCw className="w-5 h-5 animate-spin" />
          Loading dashboard...
        </div>
      </div>
    );
  }

  const hitRate = data?.overview.cacheHitRate || 0;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-gray-800 bg-gray-950/80 backdrop-blur-lg">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-none">LanCache</h1>
              <p className="text-[11px] text-gray-500 mt-0.5">Monitoring Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleIncludeAll}
              title={includeAll ? "Currently showing all traffic including localhost prefill" : "Localhost/prefill traffic is hidden"}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors border ${
                includeAll
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                  : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200"
              }`}
            >
              {includeAll ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
              <span className="hidden md:inline">{includeAll ? "Showing prefill" : "Hiding prefill"}</span>
            </button>

            {canAdmin && (
              <>
                <button
                  onClick={handleDepotRefresh}
                  disabled={depot.running}
                  title="Download the latest Steam depot → game mapping"
                  className="flex items-center gap-2 px-3.5 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-60 rounded-xl text-sm font-medium transition-colors border border-gray-700"
                >
                  <Boxes className={`w-4 h-4 ${depot.running ? "animate-pulse text-purple-400" : "text-gray-400"}`} />
                  <span className="hidden sm:inline">{depot.running ? "Updating…" : "Update Depots"}</span>
                </button>
                <button
                  onClick={() => handleIngest(true)}
                  disabled={ingest.running}
                  title="Reprocess entire log with latest extraction logic"
                  className="flex items-center gap-2 px-3.5 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-60 rounded-xl text-sm font-medium transition-colors border border-gray-700 text-gray-400 hover:text-gray-200"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span className="hidden sm:inline">Reprocess</span>
                </button>
                <button
                  onClick={() => handleIngest(false)}
                  disabled={ingest.running}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-500 rounded-xl text-sm font-medium transition-colors shadow-lg shadow-blue-600/20 disabled:shadow-none"
                >
                  <RefreshCw className={`w-4 h-4 ${ingest.running ? "animate-spin" : ""}`} />
                  {ingest.running ? "Ingesting…" : "Ingest Logs"}
                </button>
              </>
            )}

            {authRequired && (
              adminKey ? (
                <button
                  onClick={handleLock}
                  title="Lock admin actions"
                  className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 text-green-400 rounded-xl text-sm font-medium transition-colors hover:bg-green-500/20"
                >
                  <Unlock className="w-4 h-4" />
                  <span className="hidden md:inline">Admin</span>
                </button>
              ) : (
                <button
                  onClick={handleUnlock}
                  title="Unlock admin actions with your key"
                  className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 text-gray-400 hover:text-gray-200 rounded-xl text-sm font-medium transition-colors"
                >
                  <Lock className="w-4 h-4" />
                  <span className="hidden md:inline">Admin</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Progress bars */}
        {(ingest.running || depot.running) && (
          <div className="max-w-7xl mx-auto px-6 pb-3 space-y-2">
            {ingest.running && (
              <ProgressBar
                label="Ingesting logs"
                detail={`${ingest.lines.toLocaleString()} entries · ${ingest.percent}%`}
                percent={ingest.percent}
                color="bg-blue-500"
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
                detail={
                  depot.phase === "downloading"
                    ? `${depot.percent}% · ${formatBytes(depot.speedBps)}/s`
                    : "working…"
                }
                percent={depot.phase === "downloading" ? depot.percent : 100}
                indeterminate={depot.phase !== "downloading"}
                color="bg-purple-500"
              />
            )}
          </div>
        )}

        {/* Last result toast */}
        {!ingest.running && ingest.message && (
          <div className="max-w-7xl mx-auto px-6 pb-2">
            <span className="text-[11px] text-gray-500">{ingest.message}</span>
          </div>
        )}
        {!depot.running && depot.message && (
          <div className="max-w-7xl mx-auto px-6 pb-2">
            <span className="text-[11px] text-gray-500">{depot.message}</span>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Cache savings hero */}
        <CacheSavings
          servedFromCache={data?.overview.servedFromCache || 0}
          servedFromUpstream={data?.overview.servedFromUpstream || 0}
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatsCard
            title="Total Bandwidth"
            value={formatBytes(data?.overview.totalBytesSent || 0)}
            subtitle="Served to clients"
            icon={HardDrive}
            accent="blue"
          />
          <StatsCard
            title="Total Requests"
            value={formatNumber(data?.overview.totalRequests || 0)}
            icon={Activity}
            accent="green"
          />
          <StatsCard
            title="Cache Hit Rate"
            value={`${hitRate.toFixed(1)}%`}
            subtitle="By bandwidth"
            icon={Gauge}
            accent="amber"
          />
          <StatsCard
            title="Unique Clients"
            value={String(data?.overview.totalClients || 0)}
            icon={Users}
            accent="purple"
          />
          <StatsCard
            title="Services"
            value={String(data?.overview.totalServices || 0)}
            icon={Database}
            accent="cyan"
          />
        </div>

        {/* Live Downloads */}
        <LiveDownloads includeAll={includeAll} />

        {/* Bandwidth chart - full width */}
        <BandwidthChart data={data?.dailyBandwidth || []} />

        {/* Services - own full-width section */}
        <ServiceChart data={data?.services || []} />

        {/* Recent Activity */}
        <RecentActivity entries={recent} />

        {/* Cached Games */}
        <CachedGames />

        {/* Clients Table */}
        <ClientsTable clients={clients} />
      </main>
    </div>
  );
}

function ProgressBar({
  label,
  detail,
  percent,
  color,
  indeterminate,
}: {
  label: string;
  detail?: string;
  percent: number;
  color: string;
  indeterminate?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] font-medium text-gray-300">{label}</span>
        {detail && <span className="text-[11px] text-gray-500">{detail}</span>}
      </div>
      <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-300 ${indeterminate ? "animate-pulse w-full" : ""}`}
          style={indeterminate ? undefined : { width: `${Math.max(percent, 2)}%` }}
        />
      </div>
    </div>
  );
}
