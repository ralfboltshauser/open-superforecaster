ALTER TABLE "tasks" ADD COLUMN "forecast_ledger_version" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "forecast_ledger_committed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "forecast_ledger_manifest" jsonb;