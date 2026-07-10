import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

export type JsonRecord = Record<string, unknown>;

export async function readJsonRecord(path: string) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonRecord : null;
  } catch {
    return null;
  }
}

export async function listFilesNamed(path: string, name: string): Promise<string[]> {
  try {
    const info = await stat(path);
    if (info.isFile()) {
      return path.endsWith(name) ? [path] : [];
    }
    if (!info.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }
  const children = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(children.map((child) => {
    const childPath = resolve(path, child.name);
    return child.isDirectory()
      ? listFilesNamed(childPath, name)
      : child.name === name
        ? Promise.resolve([childPath])
        : Promise.resolve([]);
  }));
  return nested.flat();
}

export function readRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = (value as JsonRecord)[key];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as JsonRecord : null;
}

export function readRecordArray(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const raw = (value as JsonRecord)[key];
  return Array.isArray(raw)
    ? raw.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

export function readString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = (value as JsonRecord)[key];
  return typeof raw === "string" ? raw : null;
}

export function readStringArray(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const raw = (value as JsonRecord)[key];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

export function readNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = (value as JsonRecord)[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

export function readBoolean(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = (value as JsonRecord)[key];
  return typeof raw === "boolean" ? raw : null;
}

export function timestampValue(value: string | null) {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
