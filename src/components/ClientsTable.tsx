"use client";

import { Users } from "lucide-react";
import { formatBytes, formatNumber, getServiceLabel, getServiceColor } from "@/lib/format";
import { Panel, Empty, HitRate, pct } from "./ui";

interface Client {
  clientIp: string;
  requests: number;
  bytesSent: number;
  cacheHits: number;
  cacheMisses: number;
  hitBytes: number;
  missBytes: number;
  topService: string;
  hostname?: string | null;
  /** On the prefill/exclude list; only present in the list when "Showing prefill". */
  excluded?: boolean;
}

export function ClientsTable({ clients, className = "" }: { clients: Client[]; className?: string }) {
  const maxBytes = clients[0]?.bytesSent || 1;

  return (
    <Panel title="Top clients" icon={Users} meta={`${clients.length} by bandwidth`} className={className} bodyClassName="pb-3">
      {clients.length === 0 ? (
        <Empty icon={Users} title="No client data yet" hint="Clients appear after their first download is ingested." />
      ) : (
        <div className="max-h-[26rem] overflow-y-auto px-3">
          <table className="w-full text-left border-separate border-spacing-0">
            <thead className="sticky top-0 bg-panel z-10">
              <tr className="text-xs text-ink-3">
                <th scope="col" className="font-normal py-2 pl-2 w-8">#</th>
                <th scope="col" className="font-normal py-2">Client</th>
                <th scope="col" className="font-normal py-2 text-right hidden md:table-cell">Saved</th>
                <th scope="col" className="font-normal py-2 text-right hidden sm:table-cell">Hit rate</th>
                <th scope="col" className="font-normal py-2 pr-2 text-right">Served</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client, i) => {
                const hitRate = Math.round(pct(client.hitBytes, client.hitBytes + client.missBytes));
                return (
                  <tr key={client.clientIp} className="group">
                    <td className="figure py-2.5 pl-2 text-sm text-ink-3 border-t border-line align-middle">{i + 1}</td>
                    <td className="py-2.5 border-t border-line">
                      <div className="relative">
                        <div className="flex items-center gap-2 min-w-0">
                          {client.hostname ? (
                            <>
                              <span className="text-sm font-medium text-ink truncate" title={client.hostname}>{client.hostname}</span>
                              <span className="text-xs text-ink-3 font-mono shrink-0">{client.clientIp}</span>
                            </>
                          ) : (
                            <span className="text-sm font-medium text-ink font-mono">{client.clientIp}</span>
                          )}
                          {client.excluded && <PrefillBadge />}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-ink-3">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getServiceColor(client.topService) }} aria-hidden />
                          <span>{getServiceLabel(client.topService)}</span>
                          <span aria-hidden>·</span>
                          <span className="figure">{formatNumber(client.requests)} req</span>
                        </div>
                        {/* Share of the top client's bandwidth, as a hairline under the name */}
                        <div className="mt-1.5 h-px bg-line">
                          <div className="h-px bg-ink-3/50" style={{ width: `${pct(client.bytesSent, maxBytes)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="figure py-2.5 text-right text-sm font-semibold text-cache border-t border-line hidden md:table-cell">
                      {formatBytes(client.hitBytes)}
                    </td>
                    <td className="py-2.5 border-t border-line hidden sm:table-cell">
                      <HitRate rate={hitRate} />
                    </td>
                    <td className="figure py-2.5 pr-2 text-right text-[15px] font-semibold text-ink border-t border-line">
                      {formatBytes(client.bytesSent)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Marks a client on the EXCLUDE_IPS / PREFILL_IPS list (hidden unless "Showing prefill"). */
export function PrefillBadge() {
  return (
    <span
      className="shrink-0 px-1.5 py-px rounded border border-internet/30 text-[10px] font-semibold text-internet"
      title="On the prefill/exclude list (EXCLUDE_IPS / PREFILL_IPS). Hidden from stats unless Showing prefill."
    >
      Prefill
    </span>
  );
}
