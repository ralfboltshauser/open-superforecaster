ALTER TABLE "workflow_change_proposals" ADD COLUMN "validation_cost_total_tokens_delta" double precision;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "validation_cost_agent_calls_delta" double precision;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "validation_cost_mean_duration_seconds_delta" double precision;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "validation_cost_summary" text;