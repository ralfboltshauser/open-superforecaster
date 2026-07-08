import type { JsonRecord } from "@/lib/records"

export function domainLabels(runs: JsonRecord[]) {
  const labels = runs.map(domainFromRun).filter(Boolean)
  return labels.length > 0
    ? labels
    : ["benchlm.ai", "llm-stats.com", "morphllm.com", "swebench.com", "openrouter.ai", "vals.ai"]
}

function domainFromRun(run: JsonRecord) {
  const preview = String(run.outputPreview ?? run.title ?? "")
  const match = preview.match(/\b([a-z0-9-]+\.(?:ai|com|org|net|dev|gov|fr|in))\b/i)
  return match?.[1] ?? ""
}
