CREATE TABLE "workflow_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_run_id" text NOT NULL,
	"from_node" text,
	"to_node" text NOT NULL,
	"kind" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"session_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"repo_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"team_id" text,
	"linear_issue_id" text,
	"current_node" text NOT NULL,
	"context_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"team_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "workflow_run_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "workflow_node_slug" text;--> statement-breakpoint
ALTER TABLE "workflow_messages" ADD CONSTRAINT "workflow_messages_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_messages_run_idx" ON "workflow_messages" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "workflow_messages_status_idx" ON "workflow_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "workflow_messages_session_idx" ON "workflow_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_idx" ON "workflow_runs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_owner_idx" ON "workflow_runs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_owner_slug_idx" ON "workflows" USING btree ("owner_id","slug");--> statement-breakpoint
CREATE INDEX "sessions_workflow_run_idx" ON "sessions" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "sessions_workflow_run_node_idx" ON "sessions" USING btree ("workflow_run_id","workflow_node_slug");