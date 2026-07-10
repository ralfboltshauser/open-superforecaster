import {
  backfillBinaryForecastLedgers,
  getRunEventSnapshot,
  reconcileRunningTasks,
} from "@open-superforecaster/backend";
import { getServerContext } from "@/lib/server-db";

const terminalStatuses = new Set(["completed", "failed", "cancelled", "revoked", "partial_failure"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const { db, root, sql } = getServerContext();
  const encoder = new TextEncoder();
  let closed = false;
  let lastSequenceNumber = readLastEventId(request.headers.get("last-event-id"));

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = async () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(interval);
        await sql.end().catch(() => {});
        try {
          controller.close();
        } catch {
          // The browser/runtime may close the stream concurrently.
        }
      };

      const send = (event: string, data: unknown, id?: number) => {
        if (closed) {
          return;
        }
        const lines = [
          id !== undefined ? `id: ${id}` : null,
          `event: ${event}`,
          `data: ${JSON.stringify(data)}`,
          "",
          "",
        ].filter((line): line is string => line !== null);
        try {
          controller.enqueue(encoder.encode(lines.join("\n")));
        } catch {
          void close();
        }
      };

      const tick = async () => {
        try {
          await reconcileRunningTasks(db, root);
          await backfillBinaryForecastLedgers(db, root);
          const snapshot = await getRunEventSnapshot(db, taskId, lastSequenceNumber);
          send("status", snapshot.task, snapshot.lastSequenceNumber);
          for (const event of snapshot.events) {
            lastSequenceNumber = event.sequenceNumber;
            send("trace", event, event.sequenceNumber);
          }
          if (terminalStatuses.has(snapshot.task.status)) {
            send("done", { status: snapshot.task.status, lastSequenceNumber });
            await close();
          }
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : String(error) });
          await close();
        }
      };

      const interval = setInterval(() => {
        void tick();
      }, 2_000);
      request.signal.addEventListener("abort", () => {
        void close();
      });
      void tick();
    },
    cancel: async () => {
      if (!closed) {
        closed = true;
        await sql.end().catch(() => {});
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

function readLastEventId(value: string | null) {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
