CREATE TYPE "public"."forecast_memory_scope" AS ENUM('question_local', 'cross_question');--> statement-breakpoint
CREATE TYPE "public"."forecast_memory_status" AS ENUM('experimental', 'active', 'deprecated', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."forecast_question_status" AS ENUM('open', 'resolved', 'annulled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."forecast_trigger_status" AS ENUM('active', 'fired', 'snoozed', 'retired');--> statement-breakpoint
CREATE TYPE "public"."forecast_update_kind" AS ENUM('initial', 'scheduled', 'event_triggered', 'manual');--> statement-breakpoint
CREATE TABLE "forecast_memory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "forecast_memory_scope" NOT NULL,
	"question_id" uuid,
	"source_snapshot_id" uuid,
	"revision_of_id" uuid,
	"entry_type" text NOT NULL,
	"content" text NOT NULL,
	"status" "forecast_memory_status" DEFAULT 'experimental' NOT NULL,
	"source_question_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_resolution_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applicable_taxonomy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counterexamples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"activated_at" timestamp with time zone,
	"deprecated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"canonical_key" text NOT NULL,
	"forecast_type" "forecast_type" NOT NULL,
	"question" text NOT NULL,
	"resolution_criteria" text NOT NULL,
	"resolution_date" text,
	"condition" text,
	"status" "forecast_question_status" DEFAULT 'open' NOT NULL,
	"latest_snapshot_id" uuid,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"state_id" text NOT NULL,
	"state_version" text NOT NULL,
	"state_json" jsonb NOT NULL,
	"task_id" uuid,
	"task_row_id" uuid,
	"forecast_aggregate_id" uuid,
	"previous_snapshot_id" uuid,
	"forecast_as_of" text,
	"evidence_as_of" text,
	"cutoff_date" text,
	"temporal_trust_state" text NOT NULL,
	"raw_autonomous_probability" double precision NOT NULL,
	"selected_autonomous_probability" double precision NOT NULL,
	"crowd_assisted_probability" double precision,
	"market_probability" double precision,
	"calibration_model_id" uuid,
	"update_kind" "forecast_update_kind" DEFAULT 'initial' NOT NULL,
	"update_reason" text NOT NULL,
	"probability_delta" double precision,
	"new_evidence_claim_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invalidated_evidence_claim_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_scheduled_update" timestamp with time zone,
	"trigger_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"component_attempt_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"workflow_version" text NOT NULL,
	"aggregator_version" text NOT NULL,
	"calibrator_version" text,
	"dossier_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_update_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"source_snapshot_id" uuid,
	"trigger_type" text NOT NULL,
	"description" text NOT NULL,
	"status" "forecast_trigger_status" DEFAULT 'active' NOT NULL,
	"next_check_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"fired_at" timestamp with time zone,
	"config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forecast_memory_entries" ADD CONSTRAINT "forecast_memory_entries_question_id_forecast_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."forecast_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_memory_entries" ADD CONSTRAINT "forecast_memory_entries_source_snapshot_id_forecast_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."forecast_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_questions" ADD CONSTRAINT "forecast_questions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_question_id_forecast_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."forecast_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_task_row_id_task_rows_id_fk" FOREIGN KEY ("task_row_id") REFERENCES "public"."task_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_forecast_aggregate_id_forecast_aggregates_id_fk" FOREIGN KEY ("forecast_aggregate_id") REFERENCES "public"."forecast_aggregates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_calibration_model_id_calibration_models_id_fk" FOREIGN KEY ("calibration_model_id") REFERENCES "public"."calibration_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_update_triggers" ADD CONSTRAINT "forecast_update_triggers_question_id_forecast_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."forecast_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_update_triggers" ADD CONSTRAINT "forecast_update_triggers_source_snapshot_id_forecast_snapshots_id_fk" FOREIGN KEY ("source_snapshot_id") REFERENCES "public"."forecast_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forecast_memory_entries_scope_status_idx" ON "forecast_memory_entries" USING btree ("scope","status");--> statement-breakpoint
CREATE INDEX "forecast_memory_entries_question_idx" ON "forecast_memory_entries" USING btree ("question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_questions_canonical_key_idx" ON "forecast_questions" USING btree ("canonical_key");--> statement-breakpoint
CREATE INDEX "forecast_questions_status_idx" ON "forecast_questions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_snapshots_state_id_idx" ON "forecast_snapshots" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "forecast_snapshots_question_as_of_idx" ON "forecast_snapshots" USING btree ("question_id","forecast_as_of");--> statement-breakpoint
CREATE INDEX "forecast_snapshots_next_update_idx" ON "forecast_snapshots" USING btree ("next_scheduled_update");--> statement-breakpoint
CREATE INDEX "forecast_update_triggers_active_check_idx" ON "forecast_update_triggers" USING btree ("status","next_check_at");--> statement-breakpoint
CREATE INDEX "forecast_update_triggers_question_idx" ON "forecast_update_triggers" USING btree ("question_id");