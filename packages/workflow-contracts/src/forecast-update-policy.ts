export type ForecastReviewPlan = {
  version: "forecast-review-cadence-v1";
  status: "scheduled" | "boundary_passed";
  nextReviewAt: string | null;
  cadenceDays: number | null;
  boundary: string | null;
};

/**
 * Operational review cadence only; this policy never changes a probability.
 * Reviews become more frequent near the resolution boundary.
 */
export function planNextForecastReview(input: {
  asOf: string | Date;
  resolutionDate?: string | null;
  /** @deprecated Evidence cutoffs do not control review cadence. */
  cutoffDate?: string | null;
}): ForecastReviewPlan {
  const asOf = input.asOf instanceof Date ? input.asOf : new Date(input.asOf);
  if (!Number.isFinite(asOf.getTime())) {
    throw new Error("Forecast review asOf must be a valid ISO date or timestamp.");
  }
  // An evidence cutoff bounds admissible information; it is not the event's
  // resolution boundary and must never stop future review scheduling.
  const rawBoundary = input.resolutionDate ?? null;
  const boundary = parseBoundary(rawBoundary);
  if (boundary && boundary.getTime() <= asOf.getTime()) {
    return {
      version: "forecast-review-cadence-v1",
      status: "boundary_passed",
      nextReviewAt: null,
      cadenceDays: null,
      boundary: rawBoundary,
    };
  }
  const horizonDays = boundary
    ? Math.max(0, (boundary.getTime() - asOf.getTime()) / 86_400_000)
    : null;
  const cadenceDays = horizonDays === null
    ? 30
    : horizonDays <= 14
      ? 1
      : horizonDays <= 60
        ? 7
        : horizonDays <= 365
          ? 30
          : 90;
  const regularNext = new Date(asOf.getTime() + cadenceDays * 86_400_000);
  const next = boundary && regularNext.getTime() >= boundary.getTime()
    ? new Date(boundary.getTime() - Math.min(86_400_000, (horizonDays as number) * 86_400_000 / 2))
    : regularNext;
  return {
    version: "forecast-review-cadence-v1",
    status: next.getTime() > asOf.getTime() ? "scheduled" : "boundary_passed",
    nextReviewAt: next.getTime() > asOf.getTime() ? next.toISOString() : null,
    cadenceDays: next.getTime() > asOf.getTime() ? cadenceDays : null,
    boundary: rawBoundary,
  };
}

function parseBoundary(value?: string | null) {
  if (!value) {
    return null;
  }
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T23:59:59.999Z` : value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
