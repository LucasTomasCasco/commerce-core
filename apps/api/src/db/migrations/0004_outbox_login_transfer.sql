CREATE TABLE "auth_failures" (
	"email_key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbox_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "replaces_member_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "replacement_role_id" uuid;--> statement-breakpoint
CREATE INDEX "outbox_emails_due_idx" ON "outbox_emails" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_replacement_role_fk" FOREIGN KEY ("store_id","replacement_role_id") REFERENCES "public"."store_roles"("store_id","id") ON DELETE no action ON UPDATE no action;