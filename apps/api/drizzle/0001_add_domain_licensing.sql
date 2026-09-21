CREATE TABLE "license_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"license_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"domain_raw" text,
	"status" text DEFAULT 'active' NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"last_ip" text,
	"user_agent" text,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unbind_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "licenses" ADD COLUMN "max_domains" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "licenses" ADD COLUMN "allow_subdomains" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "licenses" ADD COLUMN "domain_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_domains" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "allow_subdomains" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "license_domains" ADD CONSTRAINT "license_domains_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "license_domains_active_key" ON "license_domains" USING btree ("license_id","domain") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "license_domains_license_idx" ON "license_domains" USING btree ("license_id","status");--> statement-breakpoint
CREATE INDEX "license_domains_domain_idx" ON "license_domains" USING btree ("domain");