/**
 * Prediction-market / crowd-forecast signals as first-class dated evidence.
 *
 * Injecting what a liquid crowd already believes is one of the cheapest,
 * best-evidenced accuracy boosts for LLM forecasting — but only when a matching
 * market exists, so coverage is partial and thin markets are down-weighted.
 *
 * v1 ships the fully-open, no-auth Manifold provider. The shape is provider-
 * agnostic so Metaculus / Polymarket / Kalshi (which need API tokens) can be
 * added behind env keys later without touching callers.
 */

export type MarketSignal = {
  provider: string;
  question: string;
  url: string;
  probability: number | null;
  volume: number | null;
  liquidity: number | null;
  resolved: boolean;
  closeDate: string | null;
  updatedAt: string | null;
};

export type MarketSignalOptions = {
  limit?: number;
  timeoutMs?: number;
  /** Drop markets whose volume is below this to avoid thin-liquidity noise. */
  minVolume?: number;
};

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`${url} -> ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function epochToIso(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

/** Manifold Markets: open, no-auth, strong full-text search, live probabilities. */
async function fetchManifoldSignals(query: string, options: MarketSignalOptions): Promise<MarketSignal[]> {
  const limit = Math.min(Math.max(options.limit ?? 4, 1), 10);
  const url = `https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(query)}&limit=${limit}`;
  const payload = await fetchJson(url, options.timeoutMs ?? 20_000);
  if (!Array.isArray(payload)) {
    return [];
  }
  const signals: MarketSignal[] = [];
  for (const raw of payload) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const market = raw as Record<string, unknown>;
    // Only binary markets carry a directly usable probability.
    if (market.outcomeType !== "BINARY") {
      continue;
    }
    const marketUrl = typeof market.url === "string" ? market.url : null;
    const question = typeof market.question === "string" ? market.question : null;
    if (!marketUrl || !question) {
      continue;
    }
    signals.push({
      provider: "manifold",
      question,
      url: marketUrl,
      probability: typeof market.probability === "number" ? market.probability : null,
      volume: typeof market.volume === "number" ? market.volume : null,
      liquidity: typeof market.totalLiquidity === "number" ? market.totalLiquidity : null,
      resolved: market.isResolved === true,
      closeDate: epochToIso(market.closeTime),
      updatedAt: epochToIso(market.lastUpdatedTime) ?? epochToIso(market.createdTime),
    });
  }
  return signals;
}

/**
 * Query the enabled market providers for a topic and return normalized signals,
 * best (highest volume, open) first. Fails soft to an empty list.
 */
export async function fetchMarketSignals(query: string, options: MarketSignalOptions = {}): Promise<MarketSignal[]> {
  const minVolume = options.minVolume ?? 0;
  const settled = await Promise.allSettled([fetchManifoldSignals(query, options)]);
  const signals = settled.flatMap((outcome) => (outcome.status === "fulfilled" ? outcome.value : []));
  const seen = new Set<string>();
  return signals
    .filter((signal) => (signal.volume ?? 0) >= minVolume)
    .filter((signal) => {
      if (seen.has(signal.url)) {
        return false;
      }
      seen.add(signal.url);
      return true;
    })
    .sort((left, right) => {
      // Prefer open markets, then higher volume.
      if (left.resolved !== right.resolved) {
        return left.resolved ? 1 : -1;
      }
      return (right.volume ?? 0) - (left.volume ?? 0);
    });
}

export function describeMarketSignal(signal: MarketSignal): string {
  const probText =
    signal.probability === null ? "probability n/a" : `crowd probability ${Math.round(signal.probability * 100)}%`;
  const parts = [
    `${probText} (${signal.provider})`,
    signal.volume === null ? null : `volume ${Math.round(signal.volume)}`,
    signal.resolved ? "resolved" : "open",
    signal.closeDate ? `closes ${signal.closeDate.slice(0, 10)}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
