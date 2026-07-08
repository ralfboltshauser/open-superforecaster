import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const CONFIRMATION = "open-superforecaster-reset-local";
const root = resolve(import.meta.dir, "..");
const args = new Set(process.argv.slice(2));
const confirmed = process.argv.includes("--confirm") && process.argv[process.argv.indexOf("--confirm") + 1] === CONFIRMATION;
const dryRun = args.has("--dry-run") || !confirmed;
const includeSmithers = args.has("--include-smithers");
const includePostgres = args.has("--include-postgres");

const ordinaryDirs = [
  "data/artifacts",
  "data/evals",
  "data/exports",
  "data/duckdb",
  "data/minio",
];
const protectedDirs = [
  ...(includeSmithers ? ["data/smithers"] : []),
  ...(includePostgres ? ["data/postgres"] : []),
];
const skippedProtectedDirs = [
  ...(!includeSmithers ? ["data/smithers"] : []),
  ...(!includePostgres ? ["data/postgres"] : []),
].filter((path) => existsSync(resolve(root, path)));
const targetDirs = [...ordinaryDirs, ...protectedDirs].filter((path) => existsSync(resolve(root, path)));

if (!confirmed) {
  printPlan({
    dryRun: true,
    targetDirs,
    skippedProtectedDirs,
    message: `Dry run only. To delete target dirs, rerun with --confirm ${CONFIRMATION}. Add --include-smithers and/or --include-postgres to delete protected state.`,
  });
  process.exit(0);
}

printPlan({
  dryRun,
  targetDirs,
  skippedProtectedDirs,
  message: dryRun ? "Dry run only." : "Deleting local data directories.",
});

if (dryRun) {
  process.exit(0);
}

for (const dir of targetDirs) {
  await rm(resolve(root, dir), { recursive: true, force: true });
}
for (const dir of ["data", "data/artifacts", "data/evals", "data/exports", "data/duckdb", "data/minio"]) {
  await mkdir(resolve(root, dir), { recursive: true });
}
if (includeSmithers) {
  await mkdir(resolve(root, "data/smithers"), { recursive: true });
}
if (includePostgres) {
  await mkdir(resolve(root, "data/postgres"), { recursive: true });
}

console.log(JSON.stringify({
  ok: true,
  deleted: targetDirs,
  skippedProtectedDirs,
}, null, 2));

function printPlan(input: {
  dryRun: boolean;
  targetDirs: string[];
  skippedProtectedDirs: string[];
  message: string;
}) {
  console.log(JSON.stringify({
    ok: true,
    project: "open-superforecaster",
    root,
    dryRun: input.dryRun,
    message: input.message,
    wouldDelete: input.targetDirs,
    skippedProtectedDirs: input.skippedProtectedDirs,
  }, null, 2));
}
