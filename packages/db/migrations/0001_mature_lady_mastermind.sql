CREATE TABLE "cleanup_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" text NOT NULL,
	"status" "task_status" DEFAULT 'queued' NOT NULL,
	"command" text NOT NULL,
	"args_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_text" text,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "cleanup_jobs_status_idx" ON "cleanup_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cleanup_jobs_job_type_idx" ON "cleanup_jobs" USING btree ("job_type");