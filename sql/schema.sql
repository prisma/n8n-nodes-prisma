-- A table for AI context on Prisma Postgres, with pgvector for similarity search.
--
-- Run this file once per database, either in n8n's Postgres node with the Execute Query
-- operation or with psql. It is safe to run again, because every statement checks whether
-- its object already exists.
--
-- The size of the embedding column has to match the embedding model you use. The file
-- uses 1536, which fits OpenAI text-embedding-3-small. Change vector(1536) below if your
-- model produces a different size:
--
--   768    Google text-embedding-004
--   1536   OpenAI text-embedding-3-small
--   3072   OpenAI text-embedding-3-large and Google gemini-embedding-001
--
-- For 3072, also remove the documents_embedding_idx statement, because pgvector can only
-- build that index for sizes up to 2000. The file schema-3072.sql shows an alternative.
--
-- The table works with n8n's Postgres PGVector Store node, which writes the id, content,
-- metadata and embedding columns, and equally well with plain SQL in the Postgres node.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
	id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	content     text NOT NULL,
	metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
	embedding   vector(1536) NOT NULL,
	-- These two columns are read from metadata, so that rows written by the PGVector Store
	-- node fill them as well.
	document_id text GENERATED ALWAYS AS (metadata ->> 'document_id') STORED,
	source      text GENERATED ALWAYS AS (metadata ->> 'source') STORED,
	created_at  timestamptz NOT NULL DEFAULT now(),
	updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Keeps similarity search fast as the table grows, using cosine distance.
CREATE INDEX IF NOT EXISTS documents_embedding_idx
	ON documents USING hnsw (embedding vector_cosine_ops);

-- Make it quick to replace or delete every row that belongs to one source document.
CREATE INDEX IF NOT EXISTS documents_document_id_idx ON documents (document_id);
CREATE INDEX IF NOT EXISTS documents_source_idx ON documents (source);
-- Supports filters on metadata, such as metadata @> '{"vendor": "Acme"}'.
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
