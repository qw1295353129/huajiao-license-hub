CREATE TABLE "authorized_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_license_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"domain_raw" text,
	"status" text DEFAULT 'active' NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"source" text DEFAULT 'admin' NOT NULL,
	"last_ip" text,
	"user_agent" text,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verify_count" integer DEFAULT 0 NOT NULL,
	"unbind_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_license_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" uuid,
	"actor_label" text,
	"domain" text,
	"message" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"customer_id" uuid,
	"customer_email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"max_domains" integer DEFAULT 1 NOT NULL,
	"allow_subdomains" boolean DEFAULT true NOT NULL,
	"domain_count" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"feature_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_verified_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "authorized_domains" ADD CONSTRAINT "authorized_domains_domain_license_id_domain_licenses_id_fk" FOREIGN KEY ("domain_license_id") REFERENCES "public"."domain_licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_domain_license_id_domain_licenses_id_fk" FOREIGN KEY ("domain_license_id") REFERENCES "public"."domain_licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_licenses" ADD CONSTRAINT "domain_licenses_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_licenses" ADD CONSTRAINT "domain_licenses_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_licenses" ADD CONSTRAINT "domain_licenses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_licenses" ADD CONSTRAINT "domain_licenses_issued_by_admins_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authorized_domains_active_key" ON "authorized_domains" USING btree ("domain") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "authorized_domains_license_idx" ON "authorized_domains" USING btree ("domain_license_id","status");--> statement-breakpoint
CREATE INDEX "domain_events_license_idx" ON "domain_events" USING btree ("domain_license_id","created_at");--> statement-breakpoint
CREATE INDEX "domain_licenses_status_idx" ON "domain_licenses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "domain_licenses_product_idx" ON "domain_licenses" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "domain_licenses_customer_idx" ON "domain_licenses" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "domain_licenses_email_idx" ON "domain_licenses" USING btree ("customer_email");