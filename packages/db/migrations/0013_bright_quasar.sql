ALTER TABLE "forecast_questions" ADD COLUMN "update_lease_owner" text;--> statement-breakpoint
ALTER TABLE "forecast_questions" ADD COLUMN "update_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "forecast_questions" ADD COLUMN "update_lease_trigger_id" uuid;--> statement-breakpoint
CREATE INDEX "forecast_questions_update_lease_idx" ON "forecast_questions" USING btree ("status","update_lease_expires_at");