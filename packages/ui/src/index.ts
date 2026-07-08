export type StatusTone = "neutral" | "good" | "warn" | "bad";

export function statusTone(ok: boolean): StatusTone {
  return ok ? "good" : "bad";
}
