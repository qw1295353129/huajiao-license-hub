ALTER TABLE "customers" ADD COLUMN "failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "license_activations_pending_key" ON "license_activations" USING btree ("license_id","device_id") WHERE status = 'pending';