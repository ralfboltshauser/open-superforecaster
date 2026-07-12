import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

type ComposeDependency = {
  condition?: string;
};

type ComposePort = {
  host_ip?: string;
  published?: number | string;
  target?: number;
};

type ComposeVolume = {
  source?: string;
  target?: string;
  type?: string;
  volume?: {
    nocopy?: boolean;
  };
};

type ComposeService = {
  command?: string | string[];
  depends_on?: Record<string, ComposeDependency>;
  environment?: Record<string, string>;
  image?: string;
  ports?: ComposePort[];
  volumes?: ComposeVolume[];
};

type ComposeConfig = {
  services?: Record<string, ComposeService>;
};

const checks: Check[] = [];

const [envExample, envHostExample, compose, readme] = await Promise.all([
  readFile(".env.example", "utf8"),
  readFile(".env.host.example", "utf8"),
  readFile("docker-compose.yml", "utf8"),
  readFile("README.md", "utf8"),
]);

const composeConfig = await run(["docker", "compose", "config", "--format", "json"]);
const normalized = composeConfig.exitCode === 0 ? parseComposeConfig(composeConfig.stdout) : { value: null, error: composeConfig.stderr || composeConfig.stdout };
const normalizedCompose = normalized.value;
const lanComposeConfig = await run(
  ["docker", "compose", "config", "--format", "json"],
  { OSF_WEB_BIND_ADDRESS: "0.0.0.0" },
);
const normalizedLan = lanComposeConfig.exitCode === 0
  ? parseComposeConfig(lanComposeConfig.stdout)
  : { value: null, error: lanComposeConfig.stderr || lanComposeConfig.stdout };
const defaultWebPort = findPublishedPort(normalizedCompose?.services?.app, 3000, 3000);
const lanWebPort = findPublishedPort(normalizedLan.value?.services?.app, 3000, 3000);
const defaultWebHost = defaultWebPort?.host_ip ?? "missing";
const lanWebHost = lanWebPort?.host_ip || normalizedLan.error || "missing";
const minioInit = normalizedCompose?.services?.["minio-init"];
const minioInitCommand = normalizeCommand(minioInit?.command);
const minioInitEnv = minioInit?.environment ?? {};
const appDependsOnMinioInit = normalizedCompose?.services?.app?.depends_on?.["minio-init"]?.condition;
const smithersDependsOnMinioInit = normalizedCompose?.services?.smithers?.depends_on?.["minio-init"]?.condition;
const dependencyConsumers = ["migrate", "app", "marketing", "smithers"];
const depsService = normalizedCompose?.services?.deps;
const dependencyCommand = normalizeCommand(depsService?.command);
const dependenciesRunBeforeConsumers = dependencyConsumers.every((serviceName) =>
  normalizedCompose?.services?.[serviceName]?.depends_on?.deps?.condition === "service_completed_successfully"
);
const dependencyVolumeIsShared = ["deps", ...dependencyConsumers].every((serviceName) =>
  hasVolume(normalizedCompose?.services?.[serviceName], "app-node-modules", "/app/node_modules")
);
const installCacheIsNarrowlyMounted = ["deps", ...dependencyConsumers].every((serviceName) => {
  const service = normalizedCompose?.services?.[serviceName];
  return hasVolume(service, "bun-install-cache", "/root/.bun/install/cache") &&
    !service?.volumes?.some((volume) => volume.target === "/root/.bun");
});
const appService = normalizedCompose?.services?.app;
const appUsesContainerSafeWatcher = commandTokens(appService?.command).join(" ") ===
    "bun --cwd apps/web dev --webpack" &&
  appService?.environment?.WATCHPACK_POLLING === "true" &&
  appService?.environment?.VITE_USE_POLLING === undefined;
const containerBuildOutputsAreIsolated = hasNoCopyVolume(
  appService,
  "web-next",
  "/app/apps/web/.next",
) && hasNoCopyVolume(
  normalizedCompose?.services?.marketing,
  "marketing-astro",
  "/app/apps/marketing/.astro",
) && hasNoCopyVolume(
  normalizedCompose?.services?.marketing,
  "marketing-dist",
  "/app/apps/marketing/dist",
) && hasNoCopyVolume(
  normalizedCompose?.services?.marketing,
  "marketing-vite-cache",
  "/app/apps/marketing/node_modules/.vite",
);

record(
  "docker env uses service hostnames",
  envExample.includes("@postgres:5432") &&
    envExample.includes("redis://redis:6379") &&
    envExample.includes("MINIO_ENDPOINT=http://minio:9000") &&
    envExample.includes("MINIO_BUCKET_ARTIFACTS=open-superforecaster-artifacts") &&
    envExample.includes("DUCKDB_PATH=/data/duckdb/open-superforecaster.duckdb"),
  ".env.example should be the Compose-oriented env file.",
);

record(
  "host env uses localhost and repo-relative data",
  envHostExample.includes("@localhost:5432") &&
    envHostExample.includes("redis://localhost:6379") &&
    envHostExample.includes("MINIO_ENDPOINT=http://localhost:9000") &&
    envHostExample.includes("MINIO_BUCKET_ARTIFACTS=open-superforecaster-artifacts") &&
    envHostExample.includes("DUCKDB_PATH=./data/duckdb/open-superforecaster.duckdb"),
  ".env.host.example should work for direct Bun development on the host.",
);

record(
  "compose web port can opt into LAN exposure",
  compose.includes("${OSF_WEB_BIND_ADDRESS:-127.0.0.1}:3000:3000") &&
    envExample.includes("OSF_WEB_BIND_ADDRESS=127.0.0.1") &&
    readme.includes("OSF_WEB_BIND_ADDRESS=0.0.0.0"),
  "web port should default to localhost while allowing explicit LAN binding.",
);

record(
  "normalized compose honors web bind address",
  defaultWebPort?.host_ip === "127.0.0.1" &&
    lanComposeConfig.exitCode === 0 &&
    normalizedLan.value !== null &&
    lanWebPort?.host_ip === "0.0.0.0",
  defaultWebPort?.host_ip === "127.0.0.1" && lanWebPort?.host_ip === "0.0.0.0"
    ? "Effective web binding is localhost by default and 0.0.0.0 when explicitly requested."
    : `Expected effective host bindings 127.0.0.1 -> 0.0.0.0; received ${defaultWebHost} -> ${lanWebHost}.`,
);

record(
  "compose non-web ports bind locally",
  [
    "127.0.0.1:3010:3010",
    "127.0.0.1:5432:5432",
    "127.0.0.1:6379:6379",
    "127.0.0.1:9000:9000",
    "127.0.0.1:4318:4318",
    "127.0.0.1:9090:9090",
    "127.0.0.1:3001:3000",
  ].every((binding) => compose.includes(binding)),
  "v1 has no auth, so non-web published service ports must stay on localhost.",
);

record(
  "compose runs migrations before app services",
  compose.includes("migrate:") &&
    compose.includes("command: bun run db:migrate") &&
    countOccurrences(compose, "condition: service_completed_successfully") >= 2,
  "Docker first-run should apply Postgres migrations before app and worker start.",
);

record(
  "compose refreshes workspace dependencies before consumers",
  dependencyCommand.includes("bun install --frozen-lockfile") &&
    dependencyCommand.includes("stat -c %u /app") &&
    dependencyCommand.includes("stat -c %g /app") &&
    dependencyCommand.includes("chown -hR") &&
    dependencyVolumeIsShared &&
    dependenciesRunBeforeConsumers,
  "A serialized frozen-lockfile install must refresh the shared node_modules volume before migrations, app, marketing, or worker startup.",
);

record(
  "compose cache preserves image-installed agent CLIs",
  installCacheIsNarrowlyMounted,
  "Only Bun's download cache should be mounted; mounting all of /root/.bun can hide the Codex and Claude versions installed in the image.",
);

record(
  "compose uses a container-safe Next.js watcher",
  appUsesContainerSafeWatcher,
  "The bind-mounted web app should use webpack polling so host inotify limits cannot crash the container with EMFILE.",
);

record(
  "compose isolates generated framework output",
  containerBuildOutputsAreIsolated,
  "Container-owned Next.js and Astro output must stay in no-copy volumes so host builds never inherit root-owned generated files.",
);

record(
  "compose initializes object storage buckets",
  minioInit?.image === "minio/mc:latest" &&
    minioInitEnv.MINIO_BUCKET_ARTIFACTS === "open-superforecaster-artifacts" &&
    minioInitEnv.MINIO_BUCKET_EVALS === "open-superforecaster-evals" &&
    minioInitEnv.MINIO_BUCKET_EXPORTS === "open-superforecaster-exports" &&
    minioInitCommand.includes("mc alias set local http://minio:9000") &&
    countOccurrences(minioInitCommand, "mc mb --ignore-existing") === 3 &&
    minioInitCommand.includes("MINIO_BUCKET_ARTIFACTS") &&
    minioInitCommand.includes("MINIO_BUCKET_EVALS") &&
    minioInitCommand.includes("MINIO_BUCKET_EXPORTS") &&
    appDependsOnMinioInit === "service_completed_successfully" &&
    smithersDependsOnMinioInit === "service_completed_successfully",
  "Normalized Compose config should create deterministic MinIO buckets before app and worker start.",
);

record(
  "agent auth root has portable default",
  compose.includes("${AGENT_AUTH_HOST_ROOT:-./data/agent-auth}:${AGENT_AUTH_CONTAINER_ROOT:-/agent-auth}") &&
    envExample.includes("AGENT_AUTH_ROOT=/agent-auth") &&
    envHostExample.includes("AGENT_AUTH_ROOT=./data/agent-auth") &&
    !compose.includes("/home/ralf/.codex") &&
    !envExample.includes("/home/ralf/.codex"),
  "Agent auth should mount one provider-profile root, not a machine-specific user path.",
);

record(
  "readme documents docker and host dev paths",
  readme.includes("cp .env.example .env") &&
    readme.includes("docker compose up --build") &&
    readme.includes("cp .env.host.example .env") &&
    readme.includes("The app binds to `127.0.0.1` by default") &&
    readme.includes("docs/agent-providers.md") &&
    readme.includes("AGENT_AUTH_ROOT=/agent-auth"),
  "README should make Docker first-run and host development distinct.",
);

record(
  "docker compose config parses",
  composeConfig.exitCode === 0 && normalizedCompose !== null,
  composeConfig.exitCode === 0 && normalizedCompose !== null ? "docker compose config --format json passed." : normalized.error,
);

for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
}

const failed = checks.filter((check) => !check.ok);
console.log(`\nOnboarding checks: ${checks.length - failed.length} passed, ${failed.length} failed`);
if (failed.length > 0) {
  process.exitCode = 1;
}

function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

async function run(args: string[], env: Readonly<Record<string, string>> = {}) {
  const proc = spawn(args[0]!, args.slice(1), {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    new Promise<number | null>((resolve) => proc.once("exit", resolve)),
  ]);
  return {
    stdout,
    stderr,
    exitCode: exitCode ?? 1,
  };
}

async function readStream(stream: NodeJS.ReadableStream) {
  let output = "";
  for await (const chunk of stream) {
    output += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  }
  return output;
}

function countOccurrences(value: string, needle: string) {
  return value.split(needle).length - 1;
}

function normalizeCommand(command: string | string[] | undefined) {
  if (Array.isArray(command)) {
    return command.join("\n");
  }
  return command ?? "";
}

function commandTokens(command: string | string[] | undefined) {
  return Array.isArray(command) ? command : command?.trim().split(/\s+/).filter(Boolean) ?? [];
}

function hasVolume(service: ComposeService | undefined, source: string, target: string) {
  return service?.volumes?.some((volume) =>
    volume.type === "volume" && volume.source === source && volume.target === target
  ) ?? false;
}

function hasNoCopyVolume(service: ComposeService | undefined, source: string, target: string) {
  return service?.volumes?.some((volume) =>
    volume.type === "volume" &&
    volume.source === source &&
    volume.target === target &&
    volume.volume?.nocopy === true
  ) ?? false;
}

function findPublishedPort(service: ComposeService | undefined, target: number, published: number) {
  return service?.ports?.find((port) => port.target === target && Number(port.published) === published);
}

function parseComposeConfig(output: string): { value: ComposeConfig | null; error: string } {
  try {
    return { value: JSON.parse(output) as ComposeConfig, error: "" };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}
