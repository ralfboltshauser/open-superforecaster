ALTER TABLE "workflow_change_proposals" ADD COLUMN "validation_result_status" text;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "validation_result_summary" text;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "validation_mean_brier_delta" double precision;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "validation_completed_cases" integer;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "validation_completed_at" timestamp with time zone;