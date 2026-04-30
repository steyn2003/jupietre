DROP INDEX "linear_poller_rules_dedupe_idx";--> statement-breakpoint
ALTER TABLE "linear_poller_rules" ALTER COLUMN "in_progress_state" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "linear_poller_rules" ADD COLUMN "mode" text DEFAULT 'pickup' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "linear_poller_rules_dedupe_idx" ON "linear_poller_rules" USING btree ("poller_id","mode","pickup_state","agent_config_id");