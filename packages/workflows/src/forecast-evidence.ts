import { canonicalCitedSourceKey } from "@open-superforecaster/workflow-contracts";

export type ForecastCitedSource = {
  title?: string;
  url?: string;
  publishedAt?: string;
  claim: string;
};

export function collectKeyUncertainties<T extends { keyUncertainties?: string[] }>(items: T[]) {
  return uniqueStrings(items.flatMap((item) => item.keyUncertainties ?? []));
}

export function collectCitedSources<T extends { citedSources?: ForecastCitedSource[] }>(items: T[]) {
  const seen = new Set<string>();
  const sources: ForecastCitedSource[] = [];
  for (const source of items.flatMap((item) => item.citedSources ?? [])) {
    const claim = source.claim?.trim();
    if (!claim) {
      continue;
    }
    const normalized: ForecastCitedSource = {
      ...(source.title?.trim() ? { title: source.title.trim() } : {}),
      ...(source.url?.trim() ? { url: source.url.trim() } : {}),
      ...(source.publishedAt?.trim() ? { publishedAt: source.publishedAt.trim() } : {}),
      claim,
    };
    const key = canonicalCitedSourceKey(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    sources.push(normalized);
  }
  return sources;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
