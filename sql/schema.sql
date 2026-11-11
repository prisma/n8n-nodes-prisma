-- Reference schema for AI context on Prisma Postgres with pgvector.
-- Run once per database with n8n's Postgres node (Execute Query) or psql.
--
-- The embedding column size must match your embedding model:
--   1536  OpenAI text-embedding-3-small (default size)
--   1536  Google gemini-embedding-001 with output dimensionality set to 1536
--   768   Google text-embedding-004, or gemini-embedding-001 reduced to 768
--   3072  OpenAI text-embedding-3-large, or gemini-embedding-001 at its default size.
--         See schema-3072.sql: a plain vector index stops at 2000 dimensions.
--
-- The table works with n8n's Postgres PGVector Store node (columns id, content,
-- metadata, embedding) and with plain SQL through the Postgres node.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
	id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	content     text NOT NULL,
	metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
	embedding   vector(1536) NOT NULL,
	-- Read from metadata, so rows written by the PGVector Store node fill them too.
	document_id text GENERATED ALWAYS AS (metadata ->> 'document_id') STORED,
	source      text GENERATED ALWAYS AS (metadata ->> 'source') STORED,
	created_at  timestamptz NOT NULL DEFAULT now(),
	updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Approximate nearest neighbour search by cosine distance.
CREATE INDEX IF NOT EXISTS documents_embedding_idx
	ON documents USING hnsw (embedding vector_cosine_ops);

-- Replace or delete all chunks of one source document.
CREATE INDEX IF NOT EXISTS documents_document_id_idx ON documents (document_id);
CREATE INDEX IF NOT EXISTS documents_source_idx ON documents (source);
-- Metadata filters such as metadata @> '{"vendor": "Acme"}'.
CREATE INDEX IF NOT EXISTS documents_metadata_idx ON documents USING gin (metadata jsonb_path_ops);

CREATE OR REPLACE FUNCTION documents_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_set_updated_at ON documents;
CREATE TRIGGER documents_set_updated_at
	BEFORE UPDATE ON documents
	FOR EACH ROW EXECUTE FUNCTION documents_set_updated_at();
