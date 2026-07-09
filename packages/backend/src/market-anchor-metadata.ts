export type MarketAnchorSnapshot = {
  status: "missing_market_price" | "near_market" | "moderate_delta" | "large_delta";
  marketPrice: number | null;
  finalProbability: number | null;
  marketDelta: number | null;
  marketPriceAsOf: string | null;
  marketCreationDate: string | null;
  marketPlatform: string | null;
  marketUrl: string | null;
  note: string;
};

const marketAnchorStatuses = new Set([
  "missing_market_price",
  "near_market",
  "moderate_delta",
  "large_delta",
]);

export function readMarketAnchorSnapshot(value: unknown): MarketAnchorSnapshot | null {
  const marketAnchor = asRecord(asRecord(value)?.marketAnchor);
  if (!marketAnchor) {
    return null;
  }
  const status = readStatus(marketAnchor);
  if (!status) {
    return null;
  }
  return {
    status,
    marketPrice: readNumber(marketAnchor, "marketPrice", "market_price"),
    finalProbability: readNumber(marketAnchor, "finalProbability", "final_probability"),
    marketDelta: readNumber(marketAnchor, "marketDelta", "market_delta"),
    marketPriceAsOf: readString(marketAnchor, "marketPriceAsOf", "market_price_as_of"),
    marketCreationDate: readString(marketAnchor, "marketCreationDate", "market_creation_date"),
    marketPlatform: readString(marketAnchor, "marketPlatform", "market_platform"),
    marketUrl: readString(marketAnchor, "marketUrl", "market_url"),
    note: readString(marketAnchor, "note") ?? "",
  };
}

function readStatus(value: unknown): MarketAnchorSnapshot["status"] | null {
  const status = readString(value, "status");
  return status && marketAnchorStatuses.has(status)
    ? status as MarketAnchorSnapshot["status"]
    : null;
}

function readString(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return null;
}

function readNumber(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
