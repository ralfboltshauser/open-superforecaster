import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const operationMode = pgEnum("operation_mode", [
  "forecast",
  "multi_agent",
  "agent_map",
  "rank",
  "classify",
  "merge",
  "dedupe",
  "benchmark_iteration",
  "fixed_evidence_eval",
  "agentic_pastcasting_eval",
]);

export const taskStatus = pgEnum("task_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "revoked",
  "cancelled",
  "partial_failure",
  "waiting_approval",
  "waiting_event",
  "waiting_timer",
  "waiting_quota",
  "needs_review",
]);

export const artifactType = pgEnum("artifact_type", [
  "table",
  "scalar",
  "file",
  "report",
  "source_bundle",
  "trace_bundle",
]);

export const forecastType = pgEnum("forecast_type", [
  "binary",
  "date",
  "numeric",
  "categorical",
  "thresholded",
  "conditional",
]);

export const promotionState = pgEnum("promotion_state", [
  "candidate",
  "promoted_for_local_default",
  "promoted_for_eval_only",
  "rejected",
  "needs_more_cases",
]);

export const forecastQuestionStatus = pgEnum("forecast_question_status", [
  "open",
  "resolved",
  "annulled",
  "archived",
]);

export const forecastUpdateKind = pgEnum("forecast_update_kind", [
  "initial",
  "scheduled",
  "event_triggered",
  "manual",
]);

export const forecastTriggerStatus = pgEnum("forecast_trigger_status", [
  "active",
  "fired",
  "snoozed",
  "retired",
]);

export const forecastMemoryScope = pgEnum("forecast_memory_scope", [
  "question_local",
  "cross_question",
]);

export const forecastMemoryStatus = pgEnum("forecast_memory_status", [
  "experimental",
  "active",
  "deprecated",
  "rejected",
]);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull().default("Local workspace"),
  ...timestamps,
});

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").references(() => sessions.id),
    smithersRunId: text("smithers_run_id"),
    operationMode: operationMode("operation_mode").notNull(),
    operationSubmode: text("operation_submode"),
    workflowVersion: text("workflow_version").notNull(),
    status: taskStatus("status").notNull().default("queued"),
    label: text("label").notNull(),
    progressTotal: integer("progress_total").notNull().default(0),
    progressPending: integer("progress_pending").notNull().default(0),
    progressRunning: integer("progress_running").notNull().default(0),
    progressCompleted: integer("progress_completed").notNull().default(0),
    progressFailed: integer("progress_failed").notNull().default(0),
    poolSize: integer("pool_size").notNull().default(1),
    activeWorkers: integer("active_workers").notNull().default(0),
    inputArtifactIds: jsonb("input_artifact_ids").$type<string[]>().notNull().default([]),
    outputArtifactId: uuid("output_artifact_id"),
    configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    benchmarkRunId: uuid("benchmark_run_id"),
    workflowVariantId: uuid("workflow_variant_id"),
    experimentLabel: text("experiment_label"),
    forecastLedgerVersion: text("forecast_ledger_version"),
    forecastLedgerCommittedAt: timestamp("forecast_ledger_committed_at", { withTimezone: true }),
    forecastLedgerManifest: jsonb("forecast_ledger_manifest").$type<Record<string, unknown>>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    smithersRunIdx: index("tasks_smithers_run_idx").on(table.smithersRunId),
    statusIdx: index("tasks_status_idx").on(table.status),
  }),
);

export const taskRows = pgTable(
  "task_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull().references(() => tasks.id),
    sourceRowId: text("source_row_id"),
    rowHash: text("row_hash"),
    status: taskStatus("status").notNull().default("queued"),
    retryCount: integer("retry_count").notNull().default(0),
    lineageJson: jsonb("lineage_json").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    taskStatusIdx: index("task_rows_task_status_idx").on(table.taskId, table.status),
  }),
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").references(() => sessions.id),
    taskId: uuid("task_id").references(() => tasks.id),
    artifactType: artifactType("artifact_type").notNull(),
    schemaJson: jsonb("schema_json").$type<Record<string, unknown>>().notNull().default({}),
    rowCount: integer("row_count").notNull().default(0),
    storageUri: text("storage_uri"),
    createdBy: text("created_by").notNull(),
    parentArtifactIds: jsonb("parent_artifact_ids").$type<string[]>().notNull().default([]),
    visibility: text("visibility").notNull().default("private"),
    ...timestamps,
  },
  (table) => ({
    taskIdx: index("artifacts_task_idx").on(table.taskId),
  }),
);

export const artifactRows = pgTable(
  "artifact_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id").notNull().references(() => artifacts.id),
    rowIndex: integer("row_index").notNull(),
    sourceRowId: text("source_row_id"),
    expandIndex: integer("expand_index"),
    rowJson: jsonb("row_json").$type<Record<string, unknown>>().notNull(),
    rowHash: text("row_hash"),
    status: taskStatus("status").notNull().default("completed"),
    error: text("error"),
    sourceBankIds: jsonb("source_bank_ids").$type<string[]>().notNull().default([]),
    citationIds: jsonb("citation_ids").$type<string[]>().notNull().default([]),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    artifactRowIdx: uniqueIndex("artifact_rows_artifact_row_idx").on(table.artifactId, table.rowIndex),
  }),
);

export const traceGroups = pgTable("trace_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id),
  taskRowId: uuid("task_row_id").references(() => taskRows.id),
  parentTraceId: uuid("parent_trace_id"),
  agentLabel: text("agent_label").notNull(),
  phase: text("phase").notNull(),
  status: taskStatus("status").notNull().default("running"),
  summary: text("summary"),
  ...timestamps,
});

export const traceEvents = pgTable(
  "trace_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull().references(() => tasks.id),
    taskRowId: uuid("task_row_id").references(() => taskRows.id),
    traceId: uuid("trace_id").references(() => traceGroups.id),
    parentTraceId: uuid("parent_trace_id"),
    eventType: text("event_type").notNull(),
    phase: text("phase").notNull(),
    agentLabel: text("agent_label"),
    iterationNumber: integer("iteration_number"),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
    sequenceNumber: integer("sequence_number").notNull(),
    streamVersion: integer("stream_version").notNull().default(1),
    benchmarkRunId: uuid("benchmark_run_id"),
    benchmarkCaseId: uuid("benchmark_case_id"),
    workflowVariantId: uuid("workflow_variant_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    taskSequenceIdx: uniqueIndex("trace_events_task_sequence_idx").on(table.taskId, table.sequenceNumber),
    benchmarkIdx: index("trace_events_benchmark_idx").on(table.benchmarkRunId, table.benchmarkCaseId),
  }),
);

export const sourceBankEntries = pgTable(
  "source_bank_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull().references(() => tasks.id),
    taskRowId: uuid("task_row_id").references(() => taskRows.id),
    traceId: uuid("trace_id").references(() => traceGroups.id),
    url: text("url"),
    domain: text("domain"),
    title: text("title"),
    contentSummary: text("content_summary").notNull(),
    sourceType: text("source_type").notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archiveUri: text("archive_uri"),
    provenanceMode: text("provenance_mode").notNull().default("agent_reported"),
    cutoffStatus: text("cutoff_status").notNull().default("unknown"),
    dependenceGroup: text("dependence_group"),
    query: text("query"),
    rank: integer("rank"),
    usedInFinal: boolean("used_in_final").notNull().default(false),
    qualityScore: doublePrecision("quality_score"),
    ...timestamps,
  },
  (table) => ({
    taskIdx: index("source_bank_task_idx").on(table.taskId),
  }),
);

export const citations = pgTable("citations", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id").notNull().references(() => sourceBankEntries.id),
  artifactId: uuid("artifact_id").references(() => artifacts.id),
  rowId: uuid("row_id").references(() => artifactRows.id),
  fieldName: text("field_name").notNull(),
  claimText: text("claim_text").notNull(),
  claimSpan: text("claim_span"),
  confidence: doublePrecision("confidence"),
  ...timestamps,
});

export const forecastAttempts = pgTable("forecast_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskRowId: uuid("task_row_id").references(() => taskRows.id),
  forecasterLabel: text("forecaster_label").notNull(),
  forecastType: forecastType("forecast_type").notNull(),
  researchPassId: text("research_pass_id"),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  evidenceDigestArtifactId: uuid("evidence_digest_artifact_id"),
  rawPrediction: jsonb("raw_prediction").$type<Record<string, unknown>>().notNull(),
  parsedPrediction: jsonb("parsed_prediction").$type<Record<string, unknown>>().notNull(),
  rationale: text("rationale").notNull(),
  premortem: text("premortem"),
  wildcards: jsonb("wildcards").$type<string[]>().notNull().default([]),
  status: taskStatus("status").notNull().default("completed"),
  costProxy: jsonb("cost_proxy").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const forecastAggregates = pgTable("forecast_aggregates", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskRowId: uuid("task_row_id").references(() => taskRows.id),
  forecastType: forecastType("forecast_type").notNull(),
  method: text("method").notNull(),
  componentAttemptIds: jsonb("component_attempt_ids").$type<string[]>().notNull().default([]),
  rawAggregate: jsonb("raw_aggregate").$type<Record<string, unknown>>().notNull(),
  calibratedAggregate: jsonb("calibrated_aggregate").$type<Record<string, unknown>>(),
  calibrationModelId: uuid("calibration_model_id"),
  rationale: text("rationale").notNull(),
  ...timestamps,
});

export const calibrationModels = pgTable("calibration_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  forecastType: forecastType("forecast_type").notNull(),
  method: text("method").notNull(),
  trainingWindow: text("training_window").notNull(),
  domainFilter: text("domain_filter"),
  parametersJson: jsonb("parameters_json").$type<Record<string, unknown>>().notNull(),
  validationScores: jsonb("validation_scores").$type<Record<string, unknown>>().notNull(),
  active: boolean("active").notNull().default(false),
  ...timestamps,
});

/**
 * A canonical forecasting question survives across task runs and snapshots.
 * Task rows remain execution records; this entity is the unresolved object being
 * tracked through time.
 */
export const forecastQuestions = pgTable(
  "forecast_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").references(() => sessions.id),
    canonicalKey: text("canonical_key").notNull(),
    forecastType: forecastType("forecast_type").notNull(),
    question: text("question").notNull(),
    resolutionCriteria: text("resolution_criteria").notNull(),
    resolutionDate: text("resolution_date"),
    condition: text("condition"),
    background: text("background"),
    status: forecastQuestionStatus("status").notNull().default("open"),
    latestSnapshotId: uuid("latest_snapshot_id"),
    updateLeaseOwner: text("update_lease_owner"),
    updateLeaseExpiresAt: timestamp("update_lease_expires_at", { withTimezone: true }),
    updateLeaseTriggerId: uuid("update_lease_trigger_id"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    canonicalKeyIdx: uniqueIndex("forecast_questions_canonical_key_idx").on(table.canonicalKey),
    statusIdx: index("forecast_questions_status_idx").on(table.status),
    updateLeaseIdx: index("forecast_questions_update_lease_idx").on(
      table.status,
      table.updateLeaseExpiresAt,
    ),
  }),
);

/**
 * An immutable stateful forecast at one information boundary. The full typed
 * ForecastState is retained alongside queryable headline fields.
 */
export const forecastSnapshots = pgTable(
  "forecast_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id").notNull().references(() => forecastQuestions.id),
    stateId: text("state_id").notNull(),
    stateVersion: text("state_version").notNull(),
    stateJson: jsonb("state_json").$type<Record<string, unknown>>().notNull(),
    taskId: uuid("task_id").references(() => tasks.id),
    taskRowId: uuid("task_row_id").references(() => taskRows.id),
    forecastAggregateId: uuid("forecast_aggregate_id").references(() => forecastAggregates.id),
    previousSnapshotId: uuid("previous_snapshot_id"),
    forecastAsOf: text("forecast_as_of"),
    evidenceAsOf: text("evidence_as_of"),
    cutoffDate: text("cutoff_date"),
    temporalTrustState: text("temporal_trust_state").notNull(),
    rawAutonomousProbability: doublePrecision("raw_autonomous_probability").notNull(),
    selectedAutonomousProbability: doublePrecision("selected_autonomous_probability").notNull(),
    crowdAssistedProbability: doublePrecision("crowd_assisted_probability"),
    marketProbability: doublePrecision("market_probability"),
    calibrationModelId: uuid("calibration_model_id").references(() => calibrationModels.id),
    updateKind: forecastUpdateKind("update_kind").notNull().default("initial"),
    updateReason: text("update_reason").notNull(),
    probabilityDelta: doublePrecision("probability_delta"),
    newEvidenceClaimIds: jsonb("new_evidence_claim_ids").$type<string[]>().notNull().default([]),
    invalidatedEvidenceClaimIds: jsonb("invalidated_evidence_claim_ids").$type<string[]>().notNull().default([]),
    nextScheduledUpdate: timestamp("next_scheduled_update", { withTimezone: true }),
    triggerConditions: jsonb("trigger_conditions").$type<string[]>().notNull().default([]),
    componentAttemptIds: jsonb("component_attempt_ids").$type<string[]>().notNull().default([]),
    workflowVersion: text("workflow_version").notNull(),
    aggregatorVersion: text("aggregator_version").notNull(),
    calibratorVersion: text("calibrator_version"),
    dossierVersion: text("dossier_version").notNull(),
    schedulerVersion: text("scheduler_version"),
    ...timestamps,
  },
  (table) => ({
    stateIdIdx: uniqueIndex("forecast_snapshots_state_id_idx").on(table.stateId),
    questionAsOfIdx: index("forecast_snapshots_question_as_of_idx").on(table.questionId, table.forecastAsOf),
    nextUpdateIdx: index("forecast_snapshots_next_update_idx").on(table.nextScheduledUpdate),
  }),
);

/** Scheduled or signpost-based reasons to reopen an unresolved question. */
export const forecastUpdateTriggers = pgTable(
  "forecast_update_triggers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id").notNull().references(() => forecastQuestions.id),
    sourceSnapshotId: uuid("source_snapshot_id").references(() => forecastSnapshots.id),
    triggerType: text("trigger_type").notNull(),
    description: text("description").notNull(),
    status: forecastTriggerStatus("status").notNull().default("active"),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    firedAt: timestamp("fired_at", { withTimezone: true }),
    configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    activeCheckIdx: index("forecast_update_triggers_active_check_idx").on(table.status, table.nextCheckAt),
    questionIdx: index("forecast_update_triggers_question_idx").on(table.questionId),
  }),
);

/**
 * Typed, bounded memory. Cross-question entries start experimental and require
 * validation metadata before a service may activate them.
 */
export const forecastMemoryEntries = pgTable(
  "forecast_memory_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: forecastMemoryScope("scope").notNull(),
    questionId: uuid("question_id").references(() => forecastQuestions.id),
    sourceSnapshotId: uuid("source_snapshot_id").references(() => forecastSnapshots.id),
    revisionOfId: uuid("revision_of_id"),
    entryType: text("entry_type").notNull(),
    content: text("content").notNull(),
    status: forecastMemoryStatus("status").notNull().default("experimental"),
    sourceQuestionIds: jsonb("source_question_ids").$type<string[]>().notNull().default([]),
    sourceResolutionIds: jsonb("source_resolution_ids").$type<string[]>().notNull().default([]),
    applicableTaxonomy: jsonb("applicable_taxonomy").$type<Record<string, unknown>>().notNull().default({}),
    counterexamples: jsonb("counterexamples").$type<string[]>().notNull().default([]),
    validationJson: jsonb("validation_json").$type<Record<string, unknown>>().notNull().default({}),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    scopeStatusIdx: index("forecast_memory_entries_scope_status_idx").on(table.scope, table.status),
    questionIdx: index("forecast_memory_entries_question_idx").on(table.questionId),
  }),
);

export const forecastResolutions = pgTable("forecast_resolutions", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskRowId: uuid("task_row_id").references(() => taskRows.id),
  resolvedValue: jsonb("resolved_value").$type<Record<string, unknown>>().notNull(),
  resolutionSource: text("resolution_source").notNull(),
  resolverTraceIds: jsonb("resolver_trace_ids").$type<string[]>().notNull().default([]),
  annulled: boolean("annulled").notNull().default(false),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

/**
 * Proper scores for the complete immutable ForecastState trajectory. These are
 * deliberately separate from attempt/aggregate scores so snapshot histories
 * can be evaluated without changing legacy score semantics.
 */
export const forecastTrajectoryScores = pgTable(
  "forecast_trajectory_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotId: uuid("snapshot_id").notNull().references(() => forecastSnapshots.id),
    questionId: uuid("question_id").notNull().references(() => forecastQuestions.id),
    resolutionId: uuid("resolution_id").notNull().references(() => forecastResolutions.id),
    forecastTrack: text("forecast_track").notNull().default("autonomous"),
    probabilitySource: text("probability_source").notNull(),
    scoreType: text("score_type").notNull(),
    scoreValue: doublePrecision("score_value").notNull(),
    probability: doublePrecision("probability").notNull(),
    rawProbability: doublePrecision("raw_probability").notNull(),
    resolved: boolean("resolved").notNull(),
    stateId: text("state_id").notNull(),
    stateVersion: text("state_version").notNull(),
    previousSnapshotId: uuid("previous_snapshot_id"),
    forecastAsOf: text("forecast_as_of"),
    updateKind: forecastUpdateKind("update_kind").notNull(),
    probabilityDelta: doublePrecision("probability_delta"),
    leadTimeSeconds: doublePrecision("lead_time_seconds"),
    leadTimeStatus: text("lead_time_status").notNull(),
    eligibleForUpdatePolicyEvaluation: boolean("eligible_for_update_policy_evaluation").notNull().default(false),
    temporalTrustState: text("temporal_trust_state").notNull(),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => ({
    snapshotResolutionTrackTypeIdx: uniqueIndex("forecast_trajectory_scores_snapshot_resolution_track_type_idx").on(
      table.snapshotId,
      table.resolutionId,
      table.forecastTrack,
      table.scoreType,
    ),
    questionAsOfIdx: index("forecast_trajectory_scores_question_as_of_idx").on(table.questionId, table.forecastAsOf),
    resolutionIdx: index("forecast_trajectory_scores_resolution_idx").on(table.resolutionId),
    leadTimeIdx: index("forecast_trajectory_scores_lead_time_idx").on(table.leadTimeStatus, table.leadTimeSeconds),
  }),
);

export const forecastScores = pgTable("forecast_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  forecastAggregateId: uuid("forecast_aggregate_id").references(() => forecastAggregates.id),
  forecastAttemptId: uuid("forecast_attempt_id").references(() => forecastAttempts.id),
  resolutionId: uuid("resolution_id").references(() => forecastResolutions.id),
  scoreType: text("score_type").notNull(),
  scoreValue: doublePrecision("score_value").notNull(),
  scoreConfig: jsonb("score_config").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const workflowVariants = pgTable("workflow_variants", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: text("workflow_id").notNull(),
  workflowSourceHash: text("workflow_source_hash").notNull(),
  promptVersions: jsonb("prompt_versions").$type<Record<string, string>>().notNull().default({}),
  schemaVersions: jsonb("schema_versions").$type<Record<string, string>>().notNull().default({}),
  configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull().default({}),
  codexCliVersion: text("codex_cli_version"),
  smithersVersion: text("smithers_version"),
  promotionState: promotionState("promotion_state").notNull().default("candidate"),
  ...timestamps,
});

export const benchmarkSuites = pgTable("benchmark_suites", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  revision: text("revision").notNull(),
  allowedEvalModes: jsonb("allowed_eval_modes").$type<string[]>().notNull().default([]),
  caseSelectionPolicy: jsonb("case_selection_policy").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const benchmarkCases = pgTable("benchmark_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  suiteId: uuid("suite_id").notNull().references(() => benchmarkSuites.id),
  externalId: text("external_id").notNull(),
  inputJson: jsonb("input_json").$type<Record<string, unknown>>().notNull(),
  hiddenResolutionJson: jsonb("hidden_resolution_json").$type<Record<string, unknown>>(),
  cutoffMetadataJson: jsonb("cutoff_metadata_json").$type<Record<string, unknown>>().notNull().default({}),
  lineageJson: jsonb("lineage_json").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const benchmarkRuns = pgTable("benchmark_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  suiteId: uuid("suite_id").notNull().references(() => benchmarkSuites.id),
  evalMode: text("eval_mode").notNull(),
  workflowVariantId: uuid("workflow_variant_id").notNull().references(() => workflowVariants.id),
  baselineBenchmarkRunIds: jsonb("baseline_benchmark_run_ids").$type<string[]>().notNull().default([]),
  status: taskStatus("status").notNull().default("queued"),
  caseCount: integer("case_count").notNull().default(0),
  scoreReportArtifactId: uuid("score_report_artifact_id"),
  analysisReportArtifactId: uuid("analysis_report_artifact_id"),
  comparisonReportArtifactId: uuid("comparison_report_artifact_id"),
  promotionDecisionId: uuid("promotion_decision_id"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
});

export const benchmarkCaseResults = pgTable("benchmark_case_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  benchmarkRunId: uuid("benchmark_run_id").notNull().references(() => benchmarkRuns.id),
  benchmarkCaseId: uuid("benchmark_case_id").notNull().references(() => benchmarkCases.id),
  taskId: uuid("task_id").references(() => tasks.id),
  smithersRunId: text("smithers_run_id"),
  workflowVariantId: uuid("workflow_variant_id").notNull().references(() => workflowVariants.id),
  status: taskStatus("status").notNull(),
  forecastOutputArtifactId: uuid("forecast_output_artifact_id"),
  scoreRows: jsonb("score_rows").$type<Array<Record<string, unknown>>>().notNull().default([]),
  traceBundleUri: text("trace_bundle_uri"),
  sourceBundleUri: text("source_bundle_uri"),
  leakageFlags: jsonb("leakage_flags").$type<string[]>().notNull().default([]),
  failureLabels: jsonb("failure_labels").$type<string[]>().notNull().default([]),
  analystNotesArtifactId: uuid("analyst_notes_artifact_id"),
  ...timestamps,
});

export const benchmarkAnalyses = pgTable("benchmark_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  benchmarkRunId: uuid("benchmark_run_id").notNull().references(() => benchmarkRuns.id),
  summary: text("summary").notNull(),
  strongestCases: jsonb("strongest_cases").$type<string[]>().notNull().default([]),
  worstCases: jsonb("worst_cases").$type<string[]>().notNull().default([]),
  failureClusters: jsonb("failure_clusters").$type<Array<Record<string, unknown>>>().notNull().default([]),
  metricDeltas: jsonb("metric_deltas").$type<Record<string, unknown>>().notNull().default({}),
  traceQualityFindings: jsonb("trace_quality_findings").$type<Record<string, unknown>>().notNull().default({}),
  sourceQualityFindings: jsonb("source_quality_findings").$type<Record<string, unknown>>().notNull().default({}),
  costLatencyFindings: jsonb("cost_latency_findings").$type<Record<string, unknown>>().notNull().default({}),
  holdoutRiskNotes: text("holdout_risk_notes"),
  ...timestamps,
});

export const workflowChangeProposals = pgTable("workflow_change_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceBenchmarkRunId: uuid("source_benchmark_run_id").references(() => benchmarkRuns.id),
  targetWorkflowId: text("target_workflow_id").notNull(),
  problemStatement: text("problem_statement").notNull(),
  evidenceCaseIds: jsonb("evidence_case_ids").$type<string[]>().notNull().default([]),
  proposedChange: text("proposed_change").notNull(),
  expectedMetricEffect: text("expected_metric_effect").notNull(),
  expectedCostLatencyEffect: text("expected_cost_latency_effect").notNull(),
  overfitRisk: text("overfit_risk").notNull(),
  validationPlan: text("validation_plan").notNull(),
  status: text("status").notNull().default("candidate"),
  reviewNote: text("review_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  implementationTaskTitle: text("implementation_task_title"),
  implementationStatus: text("implementation_status").notNull().default("not_started"),
  implementationExperimentLabel: text("implementation_experiment_label"),
  implementationNote: text("implementation_note"),
  implementationUpdatedBy: text("implementation_updated_by"),
  implementationUpdatedAt: timestamp("implementation_updated_at", { withTimezone: true }),
  validationBenchmarkRunId: uuid("validation_benchmark_run_id").references(() => benchmarkRuns.id),
  validationLaunchedBy: text("validation_launched_by"),
  validationLaunchedAt: timestamp("validation_launched_at", { withTimezone: true }),
  validationResultStatus: text("validation_result_status"),
  validationResultSummary: text("validation_result_summary"),
  validationMeanBrierDelta: doublePrecision("validation_mean_brier_delta"),
  validationCompletedCases: integer("validation_completed_cases"),
  validationCostTotalTokensDelta: doublePrecision("validation_cost_total_tokens_delta"),
  validationCostAgentCallsDelta: doublePrecision("validation_cost_agent_calls_delta"),
  validationCostMeanDurationSecondsDelta: doublePrecision("validation_cost_mean_duration_seconds_delta"),
  validationCostSummary: text("validation_cost_summary"),
  validationGateStatus: text("validation_gate_status"),
  validationGateBlockers: jsonb("validation_gate_blockers").$type<string[]>().notNull().default([]),
  validationCompletedAt: timestamp("validation_completed_at", { withTimezone: true }),
  ...timestamps,
});

export const workflowPromotionDecisions = pgTable("workflow_promotion_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowVariantId: uuid("workflow_variant_id").notNull().references(() => workflowVariants.id),
  benchmarkRunId: uuid("benchmark_run_id").references(() => benchmarkRuns.id),
  state: promotionState("state").notNull(),
  decisionNote: text("decision_note").notNull(),
  decidedBy: text("decided_by").notNull().default("local-user"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
});

export const localSettings = pgTable("local_settings", {
  key: text("key").primaryKey(),
  valueJson: jsonb("value_json").$type<Record<string, unknown>>().notNull(),
  ...timestamps,
});

export const cleanupJobs = pgTable(
  "cleanup_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobType: text("job_type").notNull(),
    status: taskStatus("status").notNull().default("queued"),
    command: text("command").notNull(),
    argsJson: jsonb("args_json").$type<Record<string, unknown>>().notNull().default({}),
    outputText: text("output_text"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    statusIdx: index("cleanup_jobs_status_idx").on(table.status),
    jobTypeIdx: index("cleanup_jobs_job_type_idx").on(table.jobType),
  }),
);
