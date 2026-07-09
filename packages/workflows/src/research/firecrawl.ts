/**
 * Minimal, dependency-free Firecrawl v2 client.
 *
 * Used by the research pre-stage of the forecasting workflows to turn a
 * question into live, dated, source-backed evidence. Everything is bounded
 * (timeouts + result caps) and fails soft: callers use `isFirecrawlEnabled`
 * to skip research entirely when no API key is configured, and individual
 * search/scrape calls throw so the caller can `Promise.allSettled` around
 * partial failures without aborting the whole forecast.
 */

const DEFAULT_BASE_URL = "https://api.firecrawl.dev";

export type FirecrawlSearchSource = "web" | "news";

export type FirecrawlSearchResult = {
  title: string | null;
  url: string;
  snippet: string | null;
  publishedAt: string | null;
  position: number | null;
  category: FirecrawlSearchSource;
};

export type FirecrawlScrapeResult = {
  url: string;
  markdown: string;
  title: string | null;
  publishedAt: string | null;
};

export type FirecrawlSearchOptions = {
  limit?: number;
  sources?: FirecrawlSearchSource[];
  /** Time-based search filter, Firecrawl `tbs` (e.g. "qdr:w" = past week). */
  tbs?: string;
  location?: string;
  timeoutMs?: number;
};

export type FirecrawlScrapeOptions = {
  onlyMainContent?: boolean;
  /** Accept cached content up to this age (ms) to cut cost/latency. */
  maxAgeMs?: number;
  timeoutMs?: number;
};

export function firecrawlApiKey(): string | undefined {
  const key = process.env.FIRECRAWL_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

export function isFirecrawlEnabled(): boolean {
  return Boolean(firecrawlApiKey());
}

/**
 * Max concurrent Firecrawl requests. Firecrawl caps concurrent browsers by plan
 * (Free 2 / Hobby 5 / Standard 50); set FIRECRAWL_CONCURRENCY to match your plan
 * to avoid 429s from the scrape fan-out. Defaults to a Hobby-safe 5.
 */
export function firecrawlConcurrency(): number {
  const raw = Number(process.env.FIRECRAWL_CONCURRENCY);
  if (Number.isFinite(raw) && raw >= 1) {
    return Math.min(Math.trunc(raw), 50);
  }
  return 5;
}

function firecrawlBaseUrl(): string {
  const raw = process.env.FIRECRAWL_BASE_URL?.trim();
  return raw && raw.length > 0 ? raw.replace(/\/$/, "") : DEFAULT_BASE_URL;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function firecrawlPostOnce<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const key = firecrawlApiKey();
  if (!key) {
    throw new Error("FIRECRAWL_API_KEY is not set");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${firecrawlBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`Firecrawl ${path} failed (${response.status}): ${text.slice(0, 300)}`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }
    return (text ? JSON.parse(text) : {}) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST with bounded exponential backoff on rate limits (429) and transient 5xx.
 * Concurrent-browser caps, not RPM, are Firecrawl's real bottleneck, so retries
 * are cheap insurance against bursts from the scrape fan-out.
 */
async function firecrawlPost<T>(path: string, body: unknown, timeoutMs: number, maxRetries = 2): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await firecrawlPostOnce<T>(path, body, timeoutMs);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (attempt >= maxRetries || !status || !RETRYABLE_STATUS.has(status)) {
        throw error;
      }
      await sleep(500 * 2 ** attempt);
      attempt += 1;
    }
  }
}

type RawSearchItem = {
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
  description?: unknown;
  content?: unknown;
  date?: unknown;
  publishedDate?: unknown;
  published_date?: unknown;
  position?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeSearchItem(item: RawSearchItem, category: FirecrawlSearchSource): FirecrawlSearchResult | null {
  const url = asString(item.url);
  if (!url) {
    return null;
  }
  return {
    title: asString(item.title),
    url,
    snippet: asString(item.snippet) ?? asString(item.description) ?? asString(item.content),
    publishedAt: asString(item.date) ?? asString(item.publishedDate) ?? asString(item.published_date),
    position: typeof item.position === "number" ? item.position : null,
    category,
  };
}

export async function firecrawlSearch(
  query: string,
  options: FirecrawlSearchOptions = {},
): Promise<FirecrawlSearchResult[]> {
  const sources = options.sources ?? ["web"];
  const body: Record<string, unknown> = {
    query,
    limit: Math.min(Math.max(options.limit ?? 5, 1), 20),
    sources,
  };
  if (options.tbs) {
    body.tbs = options.tbs;
  }
  if (options.location) {
    body.location = options.location;
  }

  const payload = await firecrawlPost<{ data?: unknown }>("/v2/search", body, options.timeoutMs ?? 45_000);
  const data = payload.data;
  const results: FirecrawlSearchResult[] = [];

  const collect = (items: unknown, category: FirecrawlSearchSource) => {
    if (!Array.isArray(items)) {
      return;
    }
    for (const item of items) {
      const normalized = normalizeSearchItem(item as RawSearchItem, category);
      if (normalized) {
        results.push(normalized);
      }
    }
  };

  if (Array.isArray(data)) {
    collect(data, "web");
  } else if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    collect(record.web, "web");
    collect(record.news, "news");
  }
  return results;
}

export async function firecrawlScrape(
  url: string,
  options: FirecrawlScrapeOptions = {},
): Promise<FirecrawlScrapeResult> {
  const body: Record<string, unknown> = {
    url,
    formats: ["markdown"],
    onlyMainContent: options.onlyMainContent ?? true,
  };
  if (typeof options.maxAgeMs === "number") {
    body.maxAge = options.maxAgeMs;
  }
  const payload = await firecrawlPost<{ data?: Record<string, unknown> }>(
    "/v2/scrape",
    body,
    options.timeoutMs ?? 60_000,
  );
  const data = payload.data ?? {};
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  return {
    url,
    markdown: asString(data.markdown) ?? "",
    title: asString(metadata.title) ?? asString(metadata.ogTitle),
    publishedAt:
      asString(metadata.publishedTime) ??
      asString((metadata as Record<string, unknown>)["article:published_time"]) ??
      asString(metadata.date),
  };
}

/** Run an async mapper over items with bounded concurrency, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
