DROP TABLE "license_domains" CASCADE;--> statement-breakpoint
ALTER TABLE "licenses" DROP COLUMN "max_domains";--> statement-breakpoint
ALTER TABLE "licenses" DROP COLUMN "allow_subdomains";--> statement-breakpoint
ALTER TABLE "licenses" DROP COLUMN "domain_count";