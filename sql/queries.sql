-- Example queries for n8n's Postgres node (operation: Execute Query).
-- $1, $2, ... are filled from the node's Query Parameters field.
-- Pass an embedding as a JSON array string, for example {{ JSON.stringify($json.embedding) }}.

-- 1. Insert one chunk.
--    Query Parameters: content, metadata (JSON string), embedding (JSON array string)
INSERT INTO documents (content, metadata, embedding)
VALUES ($1, $2::jsonb, $3::vector)
RETURNING id, document_id, source, created_at;

-- 2. Replace every chunk of one source document before inserting its new chunks.
--    Query Parameters: document_id
DELETE FROM documents WHERE document_id = $1;

-- 3. Similarity search. Cosine distance is <=>, so similarity is 1 - distance.
--    Query Parameters: query embedding (JSON array string), limit
SELECT id, document_id, source, content, metadata,
       1 - (embedding <=> $1::vector) AS similarity
FROM documents
ORDER BY embedding <=> $1::vector
LIMIT $2;

-- 4. Similarity search with a metadata filter and a minimum similarity.
--    Query Parameters: query embedding, metadata filter (JSON string), minimum similarity, limit
SELECT id, document_id, source, content, metadata,
       1 - (embedding <=> $1::vector) AS similarity
FROM documents
WHERE metadata @> $2::jsonb
  AND 1 - (embedding <=> $1::vector) >= $3
ORDER BY embedding <=> $1::vector
LIMIT $4;

-- 5. Update the text and embedding of one chunk. updated_at changes automatically.
--    Query Parameters: id, content, embedding
UPDATE documents
SET content = $2, embedding = $3::vector
WHERE id = $1::uuid
RETURNING id, updated_at;
