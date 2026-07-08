import { spawn } from "node:child_process";
import { desc, eq } from "drizzle-orm";
import { cleanupJobs, type createDb } from "@open-superforecaster/db";

type Db = ReturnType<typeof createDb>["db"];

export type MaintenanceActionId = keyof typeof maintenanceActions;

const maintenanceActions = {
  export_local: {
    label: "Export local bundle",
    command: ["bun", "run", "export-local"],
    destructive: false,
    description: "Create a local tarball and mirror it to the configured exports bucket when reachable.",
  },
  object_storage_smoke: {
    label: "Verify object storage",
    command: ["bun", "run", "object-storage:smoke"],
    destructive: false,
    description: "Write small diagnostic objects to all configured MinIO buckets.",
  },
  duckdb_sync: {
    label: "Refresh DuckDB",
    command: ["bun", "run", "duckdb:sync"],
    destructive: false,
    description: "Rebuild the local analytics mart from Postgres.",
  },
  reset_preview: {
    label: "Preview reset",
    command: ["bun", "run", "reset-local", "--", "--dry-run"],
    destructive: false,
    description: "List local data directories that would be removed by a confirmed reset.",
  },
} as const;

export function listMaintenanceActions() {
  return Object.entries(maintenanceActions).map(([action, spec]) => ({
    action,
    label: spec.label,
    command: formatCommand(spec.command),
    destructive: spec.destructive,
    description: spec.description,
  }));
}

export async function listMaintenanceJobs(db: Db, limit = 10) {
  const rows = await db.select().from(cleanupJobs).orderBy(desc(cleanupJobs.createdAt)).limit(limit);
  return rows.map(serializeCleanupJob);
}

export async function runMaintenanceJob(db: Db, input: { root: string; action: string }) {
  const action = readMaintenanceAction(input.action);
  const spec = maintenanceActions[action];
  const now = new Date();
  const [created] = await db
    .insert(cleanupJobs)
    .values({
      jobType: action,
      status: "running",
      command: formatCommand(spec.command),
      argsJson: {
        action,
        destructive: spec.destructive,
      },
      startedAt: now,
      updatedAt: now,
    })
    .returning();

  try {
    const result = await runAllowlistedCommand(spec.command, input.root);
    const completedAt = new Date();
    const [updated] = await db
      .update(cleanupJobs)
      .set({
        status: result.exitCode === 0 ? "completed" : "failed",
        outputText: result.output,
        error: result.exitCode === 0 ? null : `Command exited with code ${result.exitCode}`,
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(cleanupJobs.id, created.id))
      .returning();
    return serializeCleanupJob(updated);
  } catch (error) {
    const completedAt = new Date();
    const [updated] = await db
      .update(cleanupJobs)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(cleanupJobs.id, created.id))
      .returning();
    return serializeCleanupJob(updated);
  }
}

function readMaintenanceAction(action: string): MaintenanceActionId {
  if (action in maintenanceActions) {
    return action as MaintenanceActionId;
  }
  throw new Error(`Unsupported maintenance action: ${action}`);
}

async function runAllowlistedCommand(command: readonly string[], root: string) {
  const [bin, ...args] = command;
  if (!bin) {
    throw new Error("Maintenance command is empty");
  }
  const result = await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: root,
      env: {
        ...process.env,
        OPEN_SUPERFORECASTER_ROOT: root,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
  const output = trimOutput([result.stdout, result.stderr].filter(Boolean).join("\n"));
  return {
    exitCode: result.exitCode,
    output,
  };
}

function trimOutput(value: string) {
  const normalized = value.trim();
  if (normalized.length <= 20_000) {
    return normalized;
  }
  return `${normalized.slice(0, 10_000)}\n\n[output truncated]\n\n${normalized.slice(-10_000)}`;
}

function formatCommand(command: readonly string[]) {
  return command.join(" ");
}

function serializeCleanupJob(row: typeof cleanupJobs.$inferSelect) {
  return {
    id: row.id,
    jobType: row.jobType,
    status: row.status,
    command: row.command,
    args: row.argsJson,
    outputText: row.outputText,
    error: row.error,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
