import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createS3CompatibleObjectStore } from "../packages/artifact-store/src/index";
import { loadAppConfig, type AppConfig } from "../packages/config/src/index";

const root = resolve(import.meta.dir, "..");
const args = new Set(process.argv.slice(2));
const skipObjectStorage = args.has("--skip-object-storage");
const config = loadAppConfig({ ...process.env, OPEN_SUPERFORECASTER_ROOT: root });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const exportsDir = config.EXPORTS_DIR;
const fileName = `open-superforecaster-export-${timestamp}.tar.gz`;
const outputPath = resolve(exportsDir, fileName);

const rootPaths = [
  "README.md",
  "package.json",
  "bun.lock",
  "docker-compose.yml",
  ".env.example",
  "data/artifacts",
  "data/evals",
  "data/smithers",
  "data/duckdb",
].filter((path) => existsSync(resolve(root, path)));

await mkdir(exportsDir, { recursive: true });
const stagingDir = await mkdtemp(resolve(tmpdir(), "open-superforecaster-export-"));
const postgresDump = await maybeDumpPostgres(stagingDir);
const manifest = {
  exportedAt: new Date().toISOString(),
  project: "open-superforecaster",
  root,
  includedRootPaths: rootPaths,
  postgresDump,
  notes: [
    "This archive is a local development/export bundle, not a backup format with transactional guarantees.",
    "Trace bundles and imported eval snapshots live under data/artifacts and data/evals.",
    "When MinIO is reachable, this script mirrors the archive into the configured exports bucket.",
    "Smithers state is included when data/smithers exists.",
  ],
};
await writeFile(resolve(stagingDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const stagingFiles = ["manifest.json", ...(postgresDump.included ? [postgresDump.fileName] : ["POSTGRES_DUMP_SKIPPED.txt"])];
const tarArgs = [
  "-czf",
  outputPath,
  "-C",
  root,
  ...rootPaths,
  "-C",
  stagingDir,
  ...stagingFiles,
];
const tar = spawnSync("tar", tarArgs, { stdio: "inherit" });
if (tar.status !== 0) {
  process.exit(tar.status ?? 1);
}

const objectStorage = skipObjectStorage
  ? {
      ok: false,
      skipped: true,
      reason: "skip_object_storage_flag",
    }
  : await maybeUploadExportArchive(config, outputPath, basename(outputPath));

console.log(JSON.stringify({
  ok: true,
  outputPath,
  includedRootPaths: rootPaths,
  postgresDump,
  objectStorage,
}, null, 2));

async function maybeDumpPostgres(stagingDir: string) {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://open_superforecaster:open_superforecaster@localhost:5432/open_superforecaster";
  const fileName = "postgres-dump.sql";
  const skippedPath = resolve(stagingDir, "POSTGRES_DUMP_SKIPPED.txt");
  if (!commandExists("pg_dump")) {
    await writeFile(skippedPath, "pg_dump was not available on PATH; Postgres dump was skipped.\n", "utf8");
    return {
      included: false,
      reason: "pg_dump_not_found",
      fileName,
    };
  }

  const dumpPath = resolve(stagingDir, fileName);
  const dump = spawnSync("pg_dump", [databaseUrl, "--no-owner", "--no-privileges", "--file", dumpPath], {
    stdio: "pipe",
    encoding: "utf8",
  });
  if (dump.status !== 0) {
    await writeFile(
      skippedPath,
      `pg_dump failed and was skipped.\n\nstdout:\n${dump.stdout}\n\nstderr:\n${dump.stderr}\n`,
      "utf8",
    );
    return {
      included: false,
      reason: "pg_dump_failed",
      fileName,
    };
  }

  return {
    included: true,
    fileName,
    databaseUrl: redactUrl(databaseUrl),
  };
}

function commandExists(command: string) {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
}

function redactUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = "redacted";
    }
    return url.toString();
  } catch {
    return "[invalid]";
  }
}

async function maybeUploadExportArchive(config: AppConfig, archivePath: string, archiveFileName: string) {
  try {
    const store = createS3CompatibleObjectStore({
      endpoint: config.MINIO_ENDPOINT,
      accessKey: config.MINIO_ACCESS_KEY,
      secretKey: config.MINIO_SECRET_KEY,
      region: config.MINIO_REGION,
    });
    const result = await store.putObject({
      bucket: config.MINIO_BUCKET_EXPORTS,
      key: `exports/${archiveFileName}`,
      body: await readFile(archivePath),
      contentType: "application/gzip",
    });
    return {
      ok: true,
      skipped: false,
      storageUri: result.storageUri,
      etag: result.etag,
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
