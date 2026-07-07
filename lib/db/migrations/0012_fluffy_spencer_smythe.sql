CREATE TABLE "skill_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"team_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"skill_ids" text[] NOT NULL,
	"instruction" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_bundles" ADD CONSTRAINT "skill_bundles_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_bundles" ADD CONSTRAINT "skill_bundles_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_bundles_owner_slug_idx" ON "skill_bundles" USING btree ("owner_id","slug");