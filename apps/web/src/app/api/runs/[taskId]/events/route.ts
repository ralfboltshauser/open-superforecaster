import {
  backfillBinaryForecastLedgers,
  getRunEventSnapshot,
  readSmithersLiveSnapshot,
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
  let stateTicking = false;
  let liveTicking = false;
  let lastSequenceNumber = readLastEventId(request.headers.get("last-event-id"));
  let lastLiveCursor = -1;
  let smithersRunId: string | null = null;
  let stateInterval: ReturnType<typeof setInterval> | null = null;
  let liveInterval: ReturnType<typeof setInterval> | null = null;

  const clearTimers = () => {
    if (stateInterval) clearInterval(stateInterval);
    if (liveInterval) clearInterval(liveInterval);
    stateInterval = null;
    liveInterval = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = async () => {
        if (closed) {
          return;
        }
        closed = true;
        clearTimers();
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

      const liveTick = async () => {
        if (closed || liveTicking || !smithersRunId) {
          return;
        }
        liveTicking = true;
        try {
          const activity = await readSmithersLiveSnapshot(root, smithersRunId);
          if (activity && activity.cursor !== lastLiveCursor) {
            lastLiveCursor = activity.cursor;
            send("activity", activity);
          }
        } catch (error) {
          console.error("Smithers live activity read failed", {
            taskId,
            smithersRunId,
            error: error instanceof Error ? error.message : String(error),
          });
          send("activity_error", { message: "Live execution activity is temporarily unavailable." });
        } finally {
          liveTicking = false;
        }
      };

      const stateTick = async () => {
        if (closed || stateTicking) {
          return;
        }
        stateTicking = true;
        try {
          await reconcileRunningTasks(db, root);
          await backfillBinaryForecastLedgers(db, root);
          const snapshot = await getRunEventSnapshot(db, taskId, lastSequenceNumber);
          smithersRunId = snapshot.task.smithersRunId;
          await liveTick();
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
        } finally {
          stateTicking = false;
        }
      };

      const initialize = async () => {
        try {
          const snapshot = await getRunEventSnapshot(db, taskId, lastSequenceNumber);
          smithersRunId = snapshot.task.smithersRunId;
          send("status", snapshot.task, snapshot.lastSequenceNumber);
          await liveTick();
          void stateTick();
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : String(error) });
          await close();
        }
      };

      stateInterval = setInterval(() => {
        void stateTick();
      }, 2_000);
      liveInterval = setInterval(() => {
        void liveTick();
      }, 1_000);
      request.signal.addEventListener("abort", () => {
        void close();
      });
      void initialize();
    },
    cancel: async () => {
      if (!closed) {
        closed = true;
        clearTimers();
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
