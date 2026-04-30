CREATE TABLE "linear_poller_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"poller_id" text NOT NULL,
	"pickup_state" text NOT NULL,
	"in_progress_state" text NOT NULL,
	"agent_config_id" text NOT NULL,
	"label_override" text,
	"workflow_template" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linear_pollers" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"team_id" text,
	"name" text NOT NULL,
	"api_key" text NOT NULL,
	"team_key" text,
	"default_label" text DEFAULT 'agent' NOT NULL,
	"poll_interval_ms" integer DEFAULT 120000 NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "linear_poller_rules" ADD CONSTRAINT "linear_poller_rules_poller_id_linear_pollers_id_fk" FOREIGN KEY ("poller_id") REFERENCES "public"."linear_pollers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_poller_rules" ADD CONSTRAINT "linear_poller_rules_agent_config_id_agent_configs_id_fk" FOREIGN KEY ("agent_config_id") REFERENCES "public"."agent_configs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_pollers" ADD CONSTRAINT "linear_pollers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_pollers" ADD CONSTRAINT "linear_pollers_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "linear_poller_rules_poller_idx" ON "linear_poller_rules" USING btree ("poller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linear_poller_rules_dedupe_idx" ON "linear_poller_rules" USING btree ("poller_id","pickup_state","agent_config_id");--> statement-breakpoint
CREATE INDEX "linear_pollers_owner_idx" ON "linear_pollers" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "agent_configs" DROP COLUMN "linear_pickup";