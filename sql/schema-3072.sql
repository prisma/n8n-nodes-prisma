-- An index for 3072-dimension embeddings, such as OpenAI text-embedding-3-large and
-- Google gemini-embedding-001 at its default size.
--
-- pgvector can index the vector type up to 2000 dimensions. For larger embeddings, this
-- file indexes a half-precision copy of each value instead, which pgvector supports up to
-- 4000 dimensions and which takes half the space.
--
-- Before you run this file, run schema.sql with vector(1536) changed to vector(3072) and
-- with the documents_embedding_idx statement removed.

CREATE INDEX IF NOT EXISTS documents_embedding_halfvec_idx
	ON documents USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

-- A query only uses this index when it sorts by the same expression, for example:
--   ORDER BY embedding::halfvec(3072) <=> $1::halfvec(3072)
