import { existsSync } from "node:fs";
import { desc } from "drizzle-orm";
import {
  artifacts,
  benchmarkCases,
  benchmarkRuns,
  benchmarkSuites,
  cleanupJobs,
  forecastScores,
  sourceBankEntries,
  tasks,
  type createDb,
} from "@open-superforecaster/db";
import type { AppConfig } from "@open-superforecaster/config";
import { buildHealthSnapshot } from "./health";
import { listMaintenanceActions, listMaintenanceJobs } from "./maintenance-service";
import { createObjectStorageTargets, tryHeadBucket } from "./object-storage";

type Db = ReturnType<typeof createDb>["db"];

export async function buildDiagnosticsSnapshot(db: Db, config: AppConfig, input: { root: string }) {
  const [health, suites, cases, taskRows, artifactRows, benchmarkRunRows, sourceRows, scoreRows, cleanupJobRows, recentMaintenanceJobs] = await Promise.all([
    buildHealthSnapshot(config),
    db.select().from(benchmarkSuites).orderBy(desc(benchmarkSuites.createdAt)),
    db.select().from(benchmarkCases),
    db.select().from(tasks),
    db.select().from(artifacts),
    db.select().from(benchmarkRuns).orderBy(desc(benchmarkRuns.createdAt)),
    db.select().from(sourceBankEntries),
    db.select().from(forecastScores),
    db.select().from(cleanupJobs),
    listMaintenanceJobs(db, 5),
  ]);

  const objectStorage = createObjectStorageTargets(config);
  const [artifactsBucket, evalsBucket, exportsBucket] = await Promise.all([
    tryHeadBucket(objectStorage.artifacts),
    tryHeadBucket(objectStorage.evals),
    tryHeadBucket(objectStorage.exports),
  ]);

  const caseCountBySuiteId = cases.reduce((counts, row) => {
    counts.set(row.suiteId, (counts.get(row.suiteId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const suitesWithCounts = suites.map((suite) => ({
    id: suite.id,
    name: suite.name,
    revision: suite.revision,
    caseCount: caseCountBySuiteId.get(suite.id) ?? 0,
    allowedEvalModes: suite.allowedEvalModes,
    rawSnapshotUri: readString(suite.caseSelectionPolicy, "rawSnapshotUri"),
    createdAt: suite.createdAt?.toISOString?.() ?? String(suite.createdAt),
  }));

  const btf2Suites = suitesWithCounts.filter((suite) =>
    `${suite.name} ${suite.revision}`.toLowerCase().includes("btf-2"),
  );

  return {
    ok: health.ok && [artifactsBucket, evalsBucket, exportsBucket].every((bucket) => bucket.ok),
    checkedAt: new Date().toISOString(),
    service: "open-superforecaster",
    settings: {
      codexModel: config.CODEX_MODEL,
      codexAuthMode: config.CODEX_AUTH_MODE,
      codexHome: config.CODEX_HOME,
      smithersStateDir: config.SMITHERS_STATE_DIR,
      duckdbPath: config.DUCKDB_PATH,
      artifactsDir: config.ARTIFACTS_DIR,
      evalsDir: config.EVALS_DIR,
      exportsDir: config.EXPORTS_DIR,
      minioEndpoint: config.MINIO_ENDPOINT,
      buckets: {
        artifacts: config.MINIO_BUCKET_ARTIFACTS,
        evals: config.MINIO_BUCKET_EVALS,
        exports: config.MINIO_BUCKET_EXPORTS,
      },
    },
    health,
    objectStorage: {
      artifacts: artifactsBucket,
      evals: evalsBucket,
      exports: exportsBucket,
    },
    evalDatasets: {
      suiteCount: suites.length,
      caseCount: cases.length,
      btf2SuiteCount: btf2Suites.length,
      latestSuite: suitesWithCounts[0] ?? null,
      suites: suitesWithCounts.slice(0, 10),
    },
    localState: {
      taskCount: taskRows.length,
      artifactCount: artifactRows.length,
      benchmarkRunCount: benchmarkRunRows.length,
      sourceBankEntryCount: sourceRows.length,
      forecastScoreCount: scoreRows.length,
      cleanupJobCount: cleanupJobRows.length,
      runningTaskCount: taskRows.filter((task) => task.status === "running").length,
      failedTaskCount: taskRows.filter((task) => task.status === "failed").length,
    },
    paths: {
      root: input.root,
      data: directoryStatus(`${input.root}/data`),
      smithers: directoryStatus(config.SMITHERS_STATE_DIR),
      artifacts: directoryStatus(config.ARTIFACTS_DIR),
      evals: directoryStatus(config.EVALS_DIR),
      exports: directoryStatus(config.EXPORTS_DIR),
    },
    commands: [
      ...listMaintenanceActions(),
      {
        label: "Preview cleanup",
        command: "bun run cleanup-local -- --task <task-id> --dry-run",
        destructive: false,
        description: "Plan dependency-aware cleanup of app projection rows without deleting anything.",
      },
    ],
    recentMaintenanceJobs,
    links: {
      app: "http://localhost:3000",
      grafana: "http://localhost:3001",
      prometheus: "http://localhost:9090",
      minio: "http://localhost:9001",
      metrics: "http://localhost:3000/metrics",
    },
  };
}

function directoryStatus(path: string) {
  return {
    path,
    exists: existsSync(path),
  };
}

function readString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : null;
}
