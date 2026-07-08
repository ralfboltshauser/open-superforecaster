CREATE TYPE "public"."artifact_type" AS ENUM('table', 'scalar', 'file', 'report', 'source_bundle', 'trace_bundle');--> statement-breakpoint
CREATE TYPE "public"."forecast_type" AS ENUM('binary', 'date', 'numeric', 'categorical', 'thresholded', 'conditional');--> statement-breakpoint
CREATE TYPE "public"."operation_mode" AS ENUM('forecast', 'multi_agent', 'agent_map', 'rank', 'classify', 'merge', 'dedupe', 'benchmark_iteration', 'fixed_evidence_eval', 'agentic_pastcasting_eval');--> statement-breakpoint
CREATE TYPE "public"."promotion_state" AS ENUM('candidate', 'promoted_for_local_default', 'promoted_for_eval_only', 'rejected', 'needs_more_cases');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('queued', 'running', 'completed', 'failed', 'revoked', 'cancelled', 'partial_failure', 'waiting_approval', 'waiting_event', 'waiting_timer', 'waiting_quota', 'needs_review');--> statement-breakpoint
CREATE TABLE "artifact_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"source_row_id" text,
	"expand_index" integer,
	"row_json" jsonb NOT NULL,
	"row_hash" text,
	"status" "task_status" DEFAULT 'completed' NOT NULL,
	"error" text,
	"source_bank_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"task_id" uuid,
	"artifact_type" "artifact_type" NOT NULL,
	"schema_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"storage_uri" text,
	"created_by" text NOT NULL,
	"parent_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmark_run_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"strongest_cases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"worst_cases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_clusters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metric_deltas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trace_quality_findings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_quality_findings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_latency_findings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"holdout_risk_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_case_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmark_run_id" uuid NOT NULL,
	"benchmark_case_id" uuid NOT NULL,
	"task_id" uuid,
	"smithers_run_id" text,
	"workflow_variant_id" uuid NOT NULL,
	"status" "task_status" NOT NULL,
	"forecast_output_artifact_id" uuid,
	"score_rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trace_bundle_uri" text,
	"source_bundle_uri" text,
	"leakage_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"analyst_notes_artifact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"input_json" jsonb NOT NULL,
	"hidden_resolution_json" jsonb,
	"cutoff_metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lineage_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"suite_id" uuid NOT NULL,
	"eval_mode" text NOT NULL,
	"workflow_variant_id" uuid NOT NULL,
	"baseline_benchmark_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"case_count" integer DEFAULT 0 NOT NULL,
	"score_report_artifact_id" uuid,
	"analysis_report_artifact_id" uuid,
	"comparison_report_artifact_id" uuid,
	"promotion_decision_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_suites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"revision" text NOT NULL,
	"allowed_eval_modes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"case_selection_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"forecast_type" "forecast_type" NOT NULL,
	"method" text NOT NULL,
	"training_window" text NOT NULL,
	"domain_filter" text,
	"parameters_json" jsonb NOT NULL,
	"validation_scores" jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"artifact_id" uuid,
	"row_id" uuid,
	"field_name" text NOT NULL,
	"claim_text" text NOT NULL,
	"claim_span" text,
	"confidence" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_row_id" uuid,
	"forecast_type" "forecast_type" NOT NULL,
	"method" text NOT NULL,
	"component_attempt_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_aggregate" jsonb NOT NULL,
	"calibrated_aggregate" jsonb,
	"calibration_model_id" uuid,
	"rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_row_id" uuid,
	"forecaster_label" text NOT NULL,
	"forecast_type" "forecast_type" NOT NULL,
	"research_pass_id" text,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"evidence_digest_artifact_id" uuid,
	"raw_prediction" jsonb NOT NULL,
	"parsed_prediction" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"premortem" text,
	"wildcards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "task_status" DEFAULT 'completed' NOT NULL,
	"cost_proxy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_row_id" uuid,
	"resolved_value" jsonb NOT NULL,
	"resolution_source" text NOT NULL,
	"resolver_trace_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"annulled" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"forecast_aggregate_id" uuid,
	"forecast_attempt_id" uuid,
	"resolution_id" uuid,
	"score_type" text NOT NULL,
	"score_value" double precision NOT NULL,
	"score_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text DEFAULT 'Local workspace' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_bank_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"task_row_id" uuid,
	"trace_id" uuid,
	"url" text,
	"domain" text,
	"title" text,
	"content_summary" text NOT NULL,
	"source_type" text NOT NULL,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"query" text,
	"rank" integer,
	"used_in_final" boolean DEFAULT false NOT NULL,
	"quality_score" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"source_row_id" text,
	"row_hash" text,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"lineage_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"smithers_run_id" text,
	"operation_mode" "operation_mode" NOT NULL,
	"operation_submode" text,
	"workflow_version" text NOT NULL,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"label" text NOT NULL,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"progress_pending" integer DEFAULT 0 NOT NULL,
	"progress_running" integer DEFAULT 0 NOT NULL,
	"progress_completed" integer DEFAULT 0 NOT NULL,
	"progress_failed" integer DEFAULT 0 NOT NULL,
	"pool_size" integer DEFAULT 1 NOT NULL,
	"active_workers" integer DEFAULT 0 NOT NULL,
	"input_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_artifact_id" uuid,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"benchmark_run_id" uuid,
	"workflow_variant_id" uuid,
	"experiment_label" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"task_row_id" uuid,
	"trace_id" uuid,
	"parent_trace_id" uuid,
	"event_type" text NOT NULL,
	"phase" text NOT NULL,
	"agent_label" text,
	"iteration_number" integer,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sequence_number" integer NOT NULL,
	"stream_version" integer DEFAULT 1 NOT NULL,
	"benchmark_run_id" uuid,
	"benchmark_case_id" uuid,
	"workflow_variant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trace_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"task_row_id" uuid,
	"parent_trace_id" uuid,
	"agent_label" text NOT NULL,
	"phase" text NOT NULL,
	"status" "task_status" DEFAULT 'running' NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_change_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_benchmark_run_id" uuid,
	"target_workflow_id" text NOT NULL,
	"problem_statement" text NOT NULL,
	"evidence_case_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_change" text NOT NULL,
	"expected_metric_effect" text NOT NULL,
	"expected_cost_latency_effect" text NOT NULL,
	"overfit_risk" text NOT NULL,
	"validation_plan" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_promotion_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_variant_id" uuid NOT NULL,
	"benchmark_run_id" uuid,
	"state" "promotion_state" NOT NULL,
	"decision_note" text NOT NULL,
	"decided_by" text DEFAULT 'local-user' NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_source_hash" text NOT NULL,
	"prompt_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schema_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"codex_cli_version" text,
	"smithers_version" text,
	"promotion_state" "promotion_state" DEFAULT 'candidate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_rows" ADD CONSTRAINT "artifact_rows_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_analyses" ADD CONSTRAINT "benchmark_analyses_benchmark_run_id_benchmark_runs_id_fk" FOREIGN KEY ("benchmark_run_id") REFERENCES "public"."benchmark_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_case_results" ADD CONSTRAINT "benchmark_case_results_benchmark_run_id_benchmark_runs_id_fk" FOREIGN KEY ("benchmark_run_id") REFERENCES "public"."benchmark_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_case_results" ADD CONSTRAINT "benchmark_case_results_benchmark_case_id_benchmark_cases_id_fk" FOREIGN KEY ("benchmark_case_id") REFERENCES "public"."benchmark_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_case_results" ADD CONSTRAINT "benchmark_case_results_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_case_results" ADD CONSTRAINT "benchmark_case_results_workflow_variant_id_workflow_variants_id_fk" FOREIGN KEY ("workflow_variant_id") REFERENCES "public"."workflow_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_cases" ADD CONSTRAINT "benchmark_cases_suite_id_benchmark_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."benchmark_suites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_suite_id_benchmark_suites_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."benchmark_suites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_workflow_variant_id_workflow_variants_id_fk" FOREIGN KEY ("workflow_variant_id") REFERENCES "public"."workflow_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_source_id_source_bank_entries_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_bank_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_row_id_artifact_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."artifact_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_aggregates" ADD CONSTRAINT "forecast_aggregates_task_row_id_task_rows_id_fk" FOREIGN KEY ("task_row_id") REFERENCES "public"."task_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_attempts" ADD CONSTRAINT "forecast_attempts_task_row_id_task_rows_id_fk" FOREIGN KEY ("task_row_id") REFERENCES "public"."task_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_resolutions" ADD CONSTRAINT "forecast_resolutions_task_row_id_task_rows_id_fk" FOREIGN KEY ("task_row_id") REFERENCES "public"."task_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_scores" ADD CONSTRAINT "forecast_scores_forecast_aggregate_id_forecast_aggregates_id_fk" FOREIGN KEY ("forecast_aggregate_id") REFERENCES "public"."forecast_aggregates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_scores" ADD CONSTRAINT "forecast_scores_forecast_attempt_id_forecast_attempts_id_fk" FOREIGN KEY ("forecast_attempt_id") REFERENCES "public"."forecast_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_scores" ADD CONSTRAINT "forecast_scores_resolution_id_forecast_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."forecast_resolutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_bank_entries" ADD CONSTRAINT "source_bank_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_bank_entries" ADD CONSTRAINT "source_bank_entries_task_row_id_task_rows_id_fk" FOREIGN KEY ("task_row_id") REFERENCES "public"."task_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_bank_entries" ADD CONSTRAINT "source_bank_entries_trace_id_trace_groups_id_fk" FOREIGN KEY ("trace_id") REFERENCES "public"."trace_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_rows" ADD CONSTRAINT "task_rows_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_task_row_id_task_rows_id_fk" FOREIGN KEY ("task_row_id") REFERENCES "public"."task_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_events" ADD CONSTRAINT "trace_events_trace_id_trace_groups_id_fk" FOREIGN KEY ("trace_id") REFERENCES "public"."trace_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_groups" ADD CONSTRAINT "trace_groups_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trace_groups" ADD CONSTRAINT "trace_groups_task_row_id_task_rows_id_fk" FOREIGN KEY ("task_row_id") REFERENCES "public"."task_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD CONSTRAINT "workflow_change_proposals_source_benchmark_run_id_benchmark_runs_id_fk" FOREIGN KEY ("source_benchmark_run_id") REFERENCES "public"."benchmark_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_promotion_decisions" ADD CONSTRAINT "workflow_promotion_decisions_workflow_variant_id_workflow_variants_id_fk" FOREIGN KEY ("workflow_variant_id") REFERENCES "public"."workflow_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_promotion_decisions" ADD CONSTRAINT "workflow_promotion_decisions_benchmark_run_id_benchmark_runs_id_fk" FOREIGN KEY ("benchmark_run_id") REFERENCES "public"."benchmark_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_rows_artifact_row_idx" ON "artifact_rows" USING btree ("artifact_id","row_index");--> statement-breakpoint
CREATE INDEX "artifacts_task_idx" ON "artifacts" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "source_bank_task_idx" ON "source_bank_entries" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_rows_task_status_idx" ON "task_rows" USING btree ("task_id","status");--> statement-breakpoint
CREATE INDEX "tasks_smithers_run_idx" ON "tasks" USING btree ("smithers_run_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "trace_events_task_sequence_idx" ON "trace_events" USING btree ("task_id","sequence_number");--> statement-breakpoint
CREATE INDEX "trace_events_benchmark_idx" ON "trace_events" USING btree ("benchmark_run_id","benchmark_case_id");