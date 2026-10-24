import { NextRequest } from "next/server";
import { getLiveSnapshot, getLiveHistory } from "@/lib/live-tracker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-sent events. The first frame carries up to 5 minutes of throughput
 * history; every frame after that is the cached 1-second snapshot (groups by
 * game, capped at 25). Per-client detail is fetched on demand from
 * /api/live/group so frame size stays flat however many clients are active.
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const includeAll = req.nextUrl.searchParams.get("includeAll") === "1";

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let last = 0;

      const send = (withHistory: boolean) => {
        if (closed) return;
        try {
          const snapshot = getLiveSnapshot(includeAll);
          if (!withHistory && snapshot.at === last) return; // nothing new since the last frame
          last = snapshot.at;
          const frame = withHistory ? { ...snapshot, history: getLiveHistory(includeAll) } : snapshot;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        } catch {
          // ignore transient errors
        }
      };

      send(true);
      const intervalId = setInterval(() => send(false), 1000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(intervalId);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
