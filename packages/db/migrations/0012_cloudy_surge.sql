CREATE TABLE "forecast_trajectory_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"resolution_id" uuid NOT NULL,
	"forecast_track" text DEFAULT 'autonomous' NOT NULL,
	"probability_source" text NOT NULL,
	"score_type" text NOT NULL,
	"score_value" double precision NOT NULL,
	"probability" double precision NOT NULL,
	"raw_probability" double precision NOT NULL,
	"resolved" boolean NOT NULL,
	"state_id" text NOT NULL,
	"state_version" text NOT NULL,
	"previous_snapshot_id" uuid,
	"forecast_as_of" text,
	"update_kind" "forecast_update_kind" NOT NULL,
	"probability_delta" double precision,
	"lead_time_seconds" double precision,
	"lead_time_status" text NOT NULL,
	"eligible_for_update_policy_evaluation" boolean DEFAULT false NOT NULL,
	"temporal_trust_state" text NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forecast_trajectory_scores" ADD CONSTRAINT "forecast_trajectory_scores_snapshot_id_forecast_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."forecast_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_trajectory_scores" ADD CONSTRAINT "forecast_trajectory_scores_question_id_forecast_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."forecast_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_trajectory_scores" ADD CONSTRAINT "forecast_trajectory_scores_resolution_id_forecast_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."forecast_resolutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_trajectory_scores_snapshot_resolution_track_type_idx" ON "forecast_trajectory_scores" USING btree ("snapshot_id","resolution_id","forecast_track","score_type");--> statement-breakpoint
CREATE INDEX "forecast_trajectory_scores_question_as_of_idx" ON "forecast_trajectory_scores" USING btree ("question_id","forecast_as_of");--> statement-breakpoint
CREATE INDEX "forecast_trajectory_scores_resolution_idx" ON "forecast_trajectory_scores" USING btree ("resolution_id");--> statement-breakpoint
CREATE INDEX "forecast_trajectory_scores_lead_time_idx" ON "forecast_trajectory_scores" USING btree ("lead_time_status","lead_time_seconds");