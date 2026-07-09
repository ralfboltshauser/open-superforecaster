export type CategoricalForecastSnapshot = {
  topCategory: string | null;
  topProbability: number | null;
  topProbabilityBand: "low" | "moderate" | "high" | "unknown";
  categoryCount: number | null;
  categorySource: string | null;
  categoriesExhaustive: boolean | null;
  entropy: number | null;
  entropyBand: "concentrated" | "mixed" | "diffuse" | "unknown";
  attemptCount: number | null;
  componentCategoryCount: number | null;
  uniqueTopCategoryCount: number | null;
  topCategoryVoteShare: number | null;
  topCategoryAgreementBand: "strong" | "split" | "none" | "unknown";
  topCategoryProbabilitySpread: number | null;
};

export function readCategoricalForecastSnapshot(value: unknown): CategoricalForecastSnapshot | null {
  const record = asRecord(value);
  const categorical = asRecord(record?.categoricalForecast) ?? record;
  if (!categorical) {
    return null;
  }
  const probabilities = readProbabilityDistribution(categorical);
  const sortedProbabilities = [...probabilities].sort((left, right) => right.probability - left.probability);
  const top = sortedProbabilities[0] ?? null;
  const categories = readStringArray(categorical, "categories");
  const categoryCount = categories.length || probabilities.length || null;
  const entropy = normalizedEntropy(probabilities);
  const topCategory = readString(categorical, "topCategory", "top_category") ?? top?.category ?? null;
  const topProbability = top?.probability ?? null;
  const categorySource = readString(categorical, "categorySource", "category_source");
  const categoriesExhaustive = readBoolean(categorical, "categoriesExhaustive", "categories_exhaustive");
  const attemptCount = readNumber(categorical, "attemptCount", "attempt_count");
  const componentStats = readComponentCategoryStats(categorical, topCategory);
  if (
    topCategory === null &&
    topProbability === null &&
    categoryCount === null &&
    categorySource === null &&
    categoriesExhaustive === null &&
    entropy === null &&
    attemptCount === null &&
    componentStats.componentCategoryCount === null
  ) {
    return null;
  }
  return {
    topCategory,
    topProbability,
    topProbabilityBand: topProbabilityBand(topProbability),
    categoryCount,
    categorySource,
    categoriesExhaustive,
    entropy,
    entropyBand: entropyBand(entropy),
    attemptCount,
    ...componentStats,
  };
}

export function topProbabilityBand(probability: number | null): CategoricalForecastSnapshot["topProbabilityBand"] {
  if (probability === null || !Number.isFinite(probability)) {
    return "unknown";
  }
  if (probability >= 70) {
    return "high";
  }
  if (probability >= 40) {
    return "moderate";
  }
  return "low";
}

export function entropyBand(entropy: number | null): CategoricalForecastSnapshot["entropyBand"] {
  if (entropy === null || !Number.isFinite(entropy)) {
    return "unknown";
  }
  if (entropy >= 0.75) {
    return "diffuse";
  }
  if (entropy >= 0.35) {
    return "mixed";
  }
  return "concentrated";
}

function readProbabilityDistribution(value: Record<string, unknown>) {
  const raw = readRecordArray(value, "probabilities").length
    ? readRecordArray(value, "probabilities")
    : readRecordArray(value, "distribution");
  return raw.flatMap((item) => {
    const category = readString(item, "category");
    const probability = readNumber(item, "probability");
    if (!category || probability === null) {
      return [];
    }
    return [{ category, probability }];
  });
}

function readComponentCategoryStats(
  value: Record<string, unknown>,
  topCategory: string | null,
): Pick<
  CategoricalForecastSnapshot,
  | "componentCategoryCount"
  | "uniqueTopCategoryCount"
  | "topCategoryVoteShare"
  | "topCategoryAgreementBand"
  | "topCategoryProbabilitySpread"
> {
  const explicitComponentCategoryCount = readNumber(value, "componentCategoryCount", "component_category_count");
  const explicitUniqueTopCategoryCount = readNumber(value, "uniqueTopCategoryCount", "unique_top_category_count");
  const explicitTopCategoryVoteShare = readNumber(value, "topCategoryVoteShare", "top_category_vote_share");
  const explicitTopCategoryProbabilitySpread = readNumber(value, "topCategoryProbabilitySpread", "top_category_probability_spread");
  const explicitAgreementBand = readTopCategoryAgreementBand(value);
  const components = readRecordArray(value, "componentCategories", "component_categories");
  if (components.length === 0) {
    return {
      componentCategoryCount: explicitComponentCategoryCount,
      uniqueTopCategoryCount: explicitUniqueTopCategoryCount,
      topCategoryVoteShare: explicitTopCategoryVoteShare,
      topCategoryAgreementBand: explicitAgreementBand ?? topCategoryAgreementBand(explicitTopCategoryVoteShare),
      topCategoryProbabilitySpread: explicitTopCategoryProbabilitySpread,
    };
  }
  const topCategories = components.flatMap((component) => {
    const category = readString(component, "topCategory", "top_category");
    return category ? [category] : [];
  });
  const matchingTopCategories = topCategory === null ? 0 : topCategories.filter((category) => category === topCategory).length;
  const voteShare = topCategories.length === 0 ? null : roundMetric((matchingTopCategories / topCategories.length) * 100);
  const topProbabilityValues = topCategory === null
    ? []
    : components.map((component) => {
        const probabilities = readRecordArray(component, "probabilities", "distribution");
        const match = probabilities.find((item) => readString(item, "category") === topCategory);
        const probability = match ? readNumber(match, "probability") : null;
        return probability ?? 0;
      });
  return {
    componentCategoryCount: components.length,
    uniqueTopCategoryCount: new Set(topCategories).size || null,
    topCategoryVoteShare: voteShare,
    topCategoryAgreementBand: topCategoryAgreementBand(voteShare),
    topCategoryProbabilitySpread: spread(topProbabilityValues),
  };
}

export function topCategoryAgreementBand(voteShare: number | null): CategoricalForecastSnapshot["topCategoryAgreementBand"] {
  if (voteShare === null || !Number.isFinite(voteShare)) {
    return "unknown";
  }
  if (voteShare >= 67) {
    return "strong";
  }
  if (voteShare > 0) {
    return "split";
  }
  return "none";
}

function spread(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return roundMetric(Math.max(...values) - Math.min(...values));
}

function normalizedEntropy(probabilities: Array<{ probability: number }>) {
  if (probabilities.length <= 1) {
    return probabilities.length === 1 ? 0 : null;
  }
  const positive = probabilities.map((item) => item.probability).filter((probability) => probability > 0);
  const total = positive.reduce((sum, probability) => sum + probability, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  const entropy = positive.reduce((sum, probability) => {
    const share = probability / total;
    return sum - share * Math.log(share);
  }, 0);
  return roundMetric(entropy / Math.log(probabilities.length));
}

function readStringArray(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function readRecordArray(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (Array.isArray(raw)) {
      return raw.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
    }
  }
  return [];
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

function readBoolean(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "boolean") {
      return raw;
    }
  }
  return null;
}

function readTopCategoryAgreementBand(value: unknown): CategoricalForecastSnapshot["topCategoryAgreementBand"] | null {
  const raw = readString(value, "topCategoryAgreementBand", "top_category_agreement_band");
  return raw === "strong" || raw === "split" || raw === "none" || raw === "unknown" ? raw : null;
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
