-- pgvector must exist before the vector column / hnsw index below. Idempotent.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."knowledge_entry_type" AS ENUM('canonical', 'example', 'policy');--> statement-breakpoint
CREATE TABLE "knowledge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "knowledge_entry_type" NOT NULL,
	"category_id" uuid,
	"question" text,
	"answer" text NOT NULL,
	"source_thread_id" text,
	"embedding" vector(1536),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tone_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_source_thread_id_threads_id_fk" FOREIGN KEY ("source_thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_entries_type_idx" ON "knowledge_entries" USING btree ("type");--> statement-breakpoint
CREATE INDEX "knowledge_entries_category_id_idx" ON "knowledge_entries" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_entries_source_thread_unique" ON "knowledge_entries" USING btree ("source_thread_id") WHERE source_thread_id IS NOT NULL AND type = 'example';--> statement-breakpoint
CREATE INDEX "knowledge_entries_embedding_idx" ON "knowledge_entries" USING hnsw ("embedding" vector_cosine_ops);