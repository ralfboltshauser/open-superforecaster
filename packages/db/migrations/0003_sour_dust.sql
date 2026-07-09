ALTER TABLE "workflow_change_proposals" ADD COLUMN "implementation_task_title" text;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "implementation_status" text DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "implementation_experiment_label" text;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "implementation_note" text;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "implementation_updated_by" text;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "implementation_updated_at" timestamp with time zone;