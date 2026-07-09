import type { CalibrationGuardSnapshot } from "./calibration-guard-metadata";

export type CalibrationGuardImpactInput = {
  score: number;
  taskId: string | null;
  calibrationGuard: CalibrationGuardSnapshot | null;
};

export type CalibrationGuardImpact = {
  guardedRows: number;
  unguardedRows: number;
  guardedResolvedTasks: number;
  unguardedResolvedTasks: number;
  guardedMeanBrier: number | null;
  unguardedMeanBrier: number | null;
  brierDelta: number | null;
  status: "no_guarded_rows" | "needs_unguarded_baseline" | "improved" | "worse" | "flat";
};

export function buildCalibrationGuardImpact(rows: CalibrationGuardImpactInput[]): CalibrationGuardImpact {
  const guardedRows = rows.filter((row) => row.calibrationGuard && row.calibrationGuard.appliedRules.length > 0);
  const unguardedRows = rows.filter((row) => !row.calibrationGuard || row.calibrationGuard.appliedRules.length === 0);
  const guardedMeanBrier = meanScore(guardedRows);
  const unguardedMeanBrier = meanScore(unguardedRows);
  const brierDelta = guardedMeanBrier === null || unguardedMeanBrier === null
    ? null
    : roundMetric(guardedMeanBrier - unguardedMeanBrier);
  return {
    guardedRows: guardedRows.length,
    unguardedRows: unguardedRows.length,
    guardedResolvedTasks: uniqueResolvedTaskCount(guardedRows),
    unguardedResolvedTasks: uniqueResolvedTaskCount(unguardedRows),
    guardedMeanBrier,
    unguardedMeanBrier,
    brierDelta,
    status: calibrationGuardImpactStatus(guardedRows.length, unguardedRows.length, brierDelta),
  };
}

function calibrationGuardImpactStatus(
  guardedRows: number,
  unguardedRows: number,
  brierDelta: number | null,
): CalibrationGuardImpact["status"] {
  if (guardedRows === 0) {
    return "no_guarded_rows";
  }
  if (unguardedRows === 0 || brierDelta === null) {
    return "needs_unguarded_baseline";
  }
  if (brierDelta < 0) {
    return "improved";
  }
  if (brierDelta > 0) {
    return "worse";
  }
  return "flat";
}

function uniqueResolvedTaskCount(rows: CalibrationGuardImpactInput[]) {
  return new Set(rows.map((row) => row.taskId).filter(Boolean)).size;
}

function meanScore(rows: CalibrationGuardImpactInput[]) {
  if (rows.length === 0) {
    return null;
  }
  return rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
}

function roundMetric(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
