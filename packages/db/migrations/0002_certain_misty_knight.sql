ALTER TABLE "workflow_change_proposals" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "workflow_change_proposals" ADD COLUMN "reviewed_at" timestamp with time zone;