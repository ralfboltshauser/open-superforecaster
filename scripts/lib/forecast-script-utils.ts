import { readFile, writeFile } from "node:fs/promises";

export type JsonRecord = Record<string, unknown>;

export function readArgValue(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function readArgValues(args: string[], name: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

export function hasArg(args: string[], name: string) {
  return args.includes(name);
}

export function readNumberArg(args: string[], name: string, fallback: number) {
  const raw = readArgValue(args, name);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readRecord(record: unknown, key?: string): JsonRecord | null {
  const value = key && isRecord(record) ? record[key] : record;
  return isRecord(value) ? value : null;
}

export function readString(record: unknown, key: string) {
  if (!isRecord(record)) {
    return null;
  }
  const value = record[key];
  return typeof value === "string" ? value : null;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export function safeSegment(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "case";
}

export function timestampLabel() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}
