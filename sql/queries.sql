-- Example queries for n8n's Postgres node with the Execute Query operation.
--
-- The placeholders $1, $2 and so on are filled from the Query Parameters option of the
-- node. Enter an expression that returns a list there, and pass an embedding as a JSON
-- array string, for example {{ [JSON.stringify($json.embedding), 5] }}.

-- 1. Insert one piece of text together with its metadata and embedding.
--    Query Parameters: content, metadata (JSON string), embedding (JSON array string)
INSERT INTO documents (content, metadata, embedding)
VALUES ($1, $2::jsonb, $3::vector)
RETURNING id, document_id, source, created_at;

-- 2. Remove every row of one source document, which you do before inserting its new version.
--    Query Parameters: document_id
DELETE FROM documents WHERE document_id = $1;

-- 3. Find the rows closest in meaning to a question. The <=> operator returns the cosine
--    distance, so the similarity is 1 minus that distance.
--    Query Parameters: query embedding (JSON array string), limit
SELECT id, document_id, source, content, metadata,
       1 - (embedding <=> $1::vector) AS similarity
FROM documents
ORDER BY embedding <=> $1::vector
LIMIT $2;

-- 4. Search as in query 3, limited to rows that match a metadata filter and reach a
--    minimum similarity.
--    Query Parameters: query embedding, metadata filter (JSON string), minimum similarity, limit
SELECT id, document_id, source, content, metadata,
       1 - (embedding <=> $1::vector) AS similarity
FROM documents
WHERE metadata @> $2::jsonb
  AND 1 - (embedding <=> $1::vector) >= $3
ORDER BY embedding <=> $1::vector
LIMIT $4;

-- 5. Update the text and embedding of one row, which also moves updated_at forward.
--    Query Parameters: id, content, embedding
UPDATE documents
SET content = $2, embedding = $3::vector
WHERE id = $1::uuid
RETURNING id, updated_at;
