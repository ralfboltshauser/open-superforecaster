export type BinaryMarketAnchorAudit = {
  status: "missing_market_price" | "near_market" | "moderate_delta" | "large_delta";
  marketPrice: number | null;
  finalProbability: number;
  marketDelta: number | null;
  marketPriceAsOf: string | null;
  marketCreationDate: string | null;
  marketPlatform: string | null;
  marketUrl: string | null;
  note: string;
};

export function buildBinaryMarketAnchorAudit(input: {
  finalProbability: number;
  market: {
    marketPrice?: number;
    marketPriceAsOf?: string;
    marketCreationDate?: string;
    marketPlatform?: string;
    marketUrl?: string;
  };
}): BinaryMarketAnchorAudit {
  const marketPrice = typeof input.market.marketPrice === "number" && Number.isFinite(input.market.marketPrice)
    ? roundProbability(input.market.marketPrice)
    : null;
  const finalProbability = roundProbability(input.finalProbability);
  if (marketPrice === null) {
    return {
      status: "missing_market_price",
      marketPrice: null,
      finalProbability,
      marketDelta: null,
      marketPriceAsOf: normalizeOptionalString(input.market.marketPriceAsOf),
      marketCreationDate: normalizeOptionalString(input.market.marketCreationDate),
      marketPlatform: normalizeOptionalString(input.market.marketPlatform),
      marketUrl: normalizeOptionalString(input.market.marketUrl),
      note: "No structured market price was provided for this binary forecast.",
    };
  }

  const marketDelta = roundProbability(finalProbability - marketPrice);
  const absoluteDelta = Math.abs(marketDelta);
  const status: BinaryMarketAnchorAudit["status"] = absoluteDelta >= 25
    ? "large_delta"
    : absoluteDelta >= 10
      ? "moderate_delta"
      : "near_market";
  return {
    status,
    marketPrice,
    finalProbability,
    marketDelta,
    marketPriceAsOf: normalizeOptionalString(input.market.marketPriceAsOf),
    marketCreationDate: normalizeOptionalString(input.market.marketCreationDate),
    marketPlatform: normalizeOptionalString(input.market.marketPlatform),
    marketUrl: normalizeOptionalString(input.market.marketUrl),
    note: status === "near_market"
      ? "Final probability is close to the structured market-price anchor."
      : `Final probability differs from the structured market-price anchor by ${marketDelta >= 0 ? "+" : ""}${marketDelta} percentage points.`,
  };
}

function roundProbability(value: number) {
  return Math.round(value * 10) / 10;
}

function normalizeOptionalString(value: string | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
