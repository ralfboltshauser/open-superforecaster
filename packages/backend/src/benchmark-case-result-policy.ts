export const benchmarkCaseResultStatusQueued = "queued" as const;
export const benchmarkCaseResultStatusRunning = "running" as const;
export const benchmarkCaseResultStatusCompleted = "completed" as const;
export const benchmarkCaseResultStatusFailed = "failed" as const;
export const benchmarkCaseResultStatusNeedsReview = "needs_review" as const;

export const benchmarkCaseResultStatuses = [
  benchmarkCaseResultStatusQueued,
  benchmarkCaseResultStatusRunning,
  benchmarkCaseResultStatusCompleted,
  benchmarkCaseResultStatusFailed,
  benchmarkCaseResultStatusNeedsReview,
] as const;

export type BenchmarkCaseResultStatus = typeof benchmarkCaseResultStatuses[number];

export type BenchmarkCaseResultStatusCounts = {
  totalCases: number;
  completedCases: number;
  failedCases: number;
  reviewCases: number;
  runningCases: number;
  queuedCases: number;
  reviewOrFailedCases: number;
};

export function isBenchmarkCaseResultStatus(value: string | null | undefined): value is BenchmarkCaseResultStatus {
  return benchmarkCaseResultStatuses.includes(value as BenchmarkCaseResultStatus);
}

export function isBenchmarkCaseResultPendingStatus(value: string | null | undefined) {
  return value === benchmarkCaseResultStatusRunning || value === benchmarkCaseResultStatusQueued;
}

export function isBenchmarkCaseResultReviewOrFailedStatus(value: string | null | undefined) {
  return value === benchmarkCaseResultStatusFailed || value === benchmarkCaseResultStatusNeedsReview;
}

export function summarizeBenchmarkCaseResultStatuses<T extends { status: string | null | undefined }>(
  results: T[],
): BenchmarkCaseResultStatusCounts {
  const completedCases = results.filter((result) => result.status === benchmarkCaseResultStatusCompleted).length;
  const failedCases = results.filter((result) => result.status === benchmarkCaseResultStatusFailed).length;
  const reviewCases = results.filter((result) => result.status === benchmarkCaseResultStatusNeedsReview).length;
  const runningCases = results.filter((result) => result.status === benchmarkCaseResultStatusRunning).length;
  const queuedCases = results.filter((result) => result.status === benchmarkCaseResultStatusQueued).length;
  return {
    totalCases: results.length,
    completedCases,
    failedCases,
    reviewCases,
    runningCases,
    queuedCases,
    reviewOrFailedCases: failedCases + reviewCases,
  };
}
