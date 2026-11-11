-- Variant of schema.sql for 3072-dimension embeddings
-- (OpenAI text-embedding-3-large, Google gemini-embedding-001 at its default size).
--
-- pgvector indexes the vector type up to 2000 dimensions. Above that, index a
-- half-precision cast (halfvec, up to 4000 dimensions) and query through the same cast.
-- Apply schema.sql first with vector(1536) replaced by vector(3072) and without
-- documents_embedding_idx, then run this file.

CREATE INDEX IF NOT EXISTS documents_embedding_halfvec_idx
	ON documents USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

-- Queries must use the same expression to hit the index:
--   ORDER BY embedding::halfvec(3072) <=> $1::halfvec(3072)
