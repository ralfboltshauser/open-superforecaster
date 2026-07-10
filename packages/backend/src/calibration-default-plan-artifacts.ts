import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

export type CalibrationDefaultPlanArtifact = {
  reportPath: string;
  generatedAt: string | null;
  summary: {
    validationRows: number | null;
    defaultCandidates: number | null;
    skippedNonHoldout: number | null;
    skippedNotPromoted: number | null;
    issues: number | null;
  };
  defaultCandidates: CalibrationDefaultPlanCandidate[];
  skippedRows: CalibrationDefaultPlanSkippedRow[];
  issues: CalibrationDefaultPlanIssue[];
  paths: {
    validationReport: string | null;
    validationReportDir: string | null;
  };
};

export type CalibrationDefaultPlanCandidate = {
  proposalId: string | null;
  sourceCandidateGuardId: string | null;
  bucketLabel: string | null;
  suggestedAdjustment: number | null;
  matchedRows: number | null;
  brierDelta: number | null;
  calibrationErrorDelta: number | null;
  targetWorkflowId: string | null;
  targetFile: string | null;
  implementationStatus: string | null;
  recommendedAction: string | null;
  acceptanceCriteria: string[];
};

export type CalibrationDefaultPlanSkippedRow = {
  proposalId: string | null;
  bucketLabel: string | null;
  recommendation: string | null;
  validationMode: string | null;
  reason: string | null;
};

export type CalibrationDefaultPlanIssue = {
  severity: string | null;
  kind: string | null;
  message: string | null;
  validationReport: string | null;
  latestValidationReport: string | null;
};

export type LatestCalibrationDefaultPlanSnapshot = {
  exists: boolean;
  path: string;
  generatedAt: string | null;
  summary: CalibrationDefaultPlanArtifact["summary"];
  issues: CalibrationDefaultPlanIssue[];
  paths: CalibrationDefaultPlanArtifact["paths"];
};

const defaultPlanReportPath = "data/reports/forecast-calibration-guard-default-plan/calibration-guard-default-plan.json";

export async function readCalibrationDefaultPlanArtifacts(root: string, input: { reportRoot?: string } = {}): Promise<CalibrationDefaultPlanArtifact[]> {
  const reportRoot = input.reportRoot ?? resolve(root, "data/reports/forecast-calibration-guard-default-plan");
  const reportPaths = await listFilesNamed(reportRoot, "calibration-guard-default-plan.json");
  const artifacts: CalibrationDefaultPlanArtifact[] = [];
  for (const reportPath of reportPaths) {
    const payload = await readJsonRecord(reportPath);
    if (!payload) {
      continue;
    }
    artifacts.push(readCalibrationDefaultPlanArtifact(reportPath, payload));
  }
  return artifacts.sort((left, right) =>
    timestampValue(left.generatedAt) - timestampValue(right.generatedAt)
    || left.reportPath.localeCompare(right.reportPath)
  );
}

export async function readLatestCalibrationDefaultPlan(root: string): Promise<LatestCalibrationDefaultPlanSnapshot> {
  const artifacts = await readCalibrationDefaultPlanArtifacts(root);
  const latest = artifacts[artifacts.length - 1] ?? null;
  if (!latest) {
    return {
      exists: false,
      path: resolve(root, defaultPlanReportPath),
      generatedAt: null,
      summary: {
        validationRows: null,
        defaultCandidates: null,
        skippedNonHoldout: null,
        skippedNotPromoted: null,
        issues: null,
      },
      issues: [],
      paths: {
        validationReport: null,
        validationReportDir: null,
      },
    };
  }
  return {
    exists: true,
    path: latest.reportPath,
    generatedAt: latest.generatedAt,
    summary: latest.summary,
    issues: latest.issues,
    paths: latest.paths,
  };
}

function readCalibrationDefaultPlanArtifact(reportPath: string, payload: JsonRecord): CalibrationDefaultPlanArtifact {
  const summary = readRecord(payload, "summary");
  const paths = readRecord(payload, "paths");
  return {
    reportPath,
    generatedAt: readString(payload, "generatedAt"),
    summary: {
      validationRows: readNumber(summary, "validationRows"),
      defaultCandidates: readNumber(summary, "defaultCandidates"),
      skippedNonHoldout: readNumber(summary, "skippedNonHoldout"),
      skippedNotPromoted: readNumber(summary, "skippedNotPromoted"),
      issues: readNumber(summary, "issues"),
    },
    defaultCandidates: readRecordArray(payload, "defaultCandidates").map((candidate) => ({
      proposalId: readString(candidate, "proposalId"),
      sourceCandidateGuardId: readString(candidate, "sourceCandidateGuardId"),
      bucketLabel: readString(candidate, "bucketLabel"),
      suggestedAdjustment: readNumber(candidate, "suggestedAdjustment"),
      matchedRows: readNumber(candidate, "matchedRows"),
      brierDelta: readNumber(candidate, "brierDelta"),
      calibrationErrorDelta: readNumber(candidate, "calibrationErrorDelta"),
      targetWorkflowId: readString(candidate, "targetWorkflowId"),
      targetFile: readString(candidate, "targetFile"),
      implementationStatus: readString(candidate, "implementationStatus"),
      recommendedAction: readString(candidate, "recommendedAction"),
      acceptanceCriteria: readStringArray(candidate, "acceptanceCriteria"),
    })),
    skippedRows: readRecordArray(payload, "skippedRows").map((skipped) => ({
      proposalId: readString(skipped, "proposalId"),
      bucketLabel: readString(skipped, "bucketLabel"),
      recommendation: readString(skipped, "recommendation"),
      validationMode: readString(skipped, "validationMode"),
      reason: readString(skipped, "reason"),
    })),
    issues: readRecordArray(payload, "issues").map((issue) => ({
      severity: readString(issue, "severity"),
      kind: readString(issue, "kind"),
      message: readString(issue, "message"),
      validationReport: readString(issue, "validationReport"),
      latestValidationReport: readString(issue, "latestValidationReport"),
    })),
    paths: {
      validationReport: readString(paths, "validationReport"),
      validationReportDir: readString(paths, "validationReportDir"),
    },
  };
}

async function readJsonRecord(path: string) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonRecord : null;
  } catch {
    return null;
  }
}

async function listFilesNamed(path: string, name: string): Promise<string[]> {
  try {
    const info = await stat(path);
    if (info.isFile()) {
      return path.endsWith(name) ? [path] : [];
    }
    if (!info.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }
  const children = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(children.map((child) => {
    const childPath = resolve(path, child.name);
    return child.isDirectory()
      ? listFilesNamed(childPath, name)
      : child.name === name
        ? Promise.resolve([childPath])
        : Promise.resolve([]);
  }));
  return nested.flat();
}

function readRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = (value as JsonRecord)[key];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as JsonRecord : null;
}

function readRecordArray(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const raw = (value as JsonRecord)[key];
  return Array.isArray(raw)
    ? raw.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function readString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = (value as JsonRecord)[key];
  return typeof raw === "string" ? raw : null;
}

function readStringArray(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const raw = (value as JsonRecord)[key];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

function readNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = (value as JsonRecord)[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function timestampValue(value: string | null) {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
