BEGIN;

CREATE TEMP TABLE _canonical_workflow_schemas (
  uri text PRIMARY KEY,
  schemas jsonb NOT NULL
) ON COMMIT DROP;

INSERT INTO _canonical_workflow_schemas (uri, schemas)
VALUES
  (
    'agenta:builtin:chat:v0',
    $${"inputs":{"$schema":"https://json-schema.org/draft/2020-12/schema","additionalProperties":true,"properties":{"messages":{"description":"Ordered list of normalized chat messages.","type":"array","x-ag-type-ref":"messages"}},"type":"object"},"outputs":{"$schema":"https://json-schema.org/draft/2020-12/schema","description":"Final chat message returned by the workflow.","type":"object","x-ag-type-ref":"message"},"parameters":{"$schema":"https://json-schema.org/draft/2020-12/schema","additionalProperties":true,"properties":{"prompt":{"description":"A template for generating prompts with formatting capabilities","type":"object","x-ag-type-ref":"prompt-template"}},"type":"object"}}$$::jsonb
  ),
  (
    'agenta:builtin:completion:v0',
    $${"inputs":{"$schema":"https://json-schema.org/draft/2020-12/schema","additionalProperties":true,"properties":{},"type":"object"},"outputs":{"$schema":"https://json-schema.org/draft/2020-12/schema","description":"Generated response, which may be text or structured data.","type":["string","object","array"]},"parameters":{"$schema":"https://json-schema.org/draft/2020-12/schema","additionalProperties":true,"properties":{"prompt":{"description":"A template for generating prompts with formatting capabilities","type":"object","x-ag-type-ref":"prompt-template"}},"type":"object"}}$$::jsonb
  );

-- Preview before update.
SELECT
  c.uri,
  count(*) AS total,
  count(*) FILTER (
    WHERE wr.data::jsonb -> 'schemas' = c.schemas
  ) AS canonical,
  count(*) FILTER (
    WHERE wr.data::jsonb -> 'schemas' IS DISTINCT FROM c.schemas
  ) AS non_canonical
FROM workflow_revisions wr
JOIN _canonical_workflow_schemas c
  ON wr.data::jsonb ->> 'uri' = c.uri
WHERE wr.data IS NOT NULL
GROUP BY c.uri
ORDER BY c.uri;

-- Migration: non-canonical -> canonical.
WITH updated AS (
  UPDATE workflow_revisions wr
  SET data = jsonb_set(
    wr.data::jsonb,
    '{schemas}',
    c.schemas,
    true
  )::json
  FROM _canonical_workflow_schemas c
  WHERE wr.data IS NOT NULL
    AND wr.data::jsonb ->> 'uri' = c.uri
    AND wr.data::jsonb -> 'schemas' IS DISTINCT FROM c.schemas
  RETURNING wr.id, c.uri
)
SELECT uri, count(*) AS updated_count
FROM updated
GROUP BY uri
ORDER BY uri;

-- Verify after update, before commit.
SELECT
  c.uri,
  count(*) AS total,
  count(*) FILTER (
    WHERE wr.data::jsonb -> 'schemas' = c.schemas
  ) AS canonical,
  count(*) FILTER (
    WHERE wr.data::jsonb -> 'schemas' IS DISTINCT FROM c.schemas
  ) AS non_canonical
FROM workflow_revisions wr
JOIN _canonical_workflow_schemas c
  ON wr.data::jsonb ->> 'uri' = c.uri
WHERE wr.data IS NOT NULL
GROUP BY c.uri
ORDER BY c.uri;

-- Choose one after inspection:
-- COMMIT;
-- ROLLBACK;
