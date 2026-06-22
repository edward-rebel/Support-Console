ALTER TABLE "messages" ADD COLUMN "attachments" jsonb;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "sentiment" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "sentiment_score" integer;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "summary" text;