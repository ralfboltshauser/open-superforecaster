ALTER TABLE "source_bank_entries" ADD COLUMN "archive_uri" text;--> statement-breakpoint
ALTER TABLE "source_bank_entries" ADD COLUMN "provenance_mode" text DEFAULT 'agent_reported' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_bank_entries" ADD COLUMN "cutoff_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_bank_entries" ADD COLUMN "dependence_group" text;