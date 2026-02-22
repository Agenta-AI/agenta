# RFC: Tags System (Draft, Legacy Branch)

## Status

- Draft
- Intended for iteration

## 1. Context

This branch contains older entities and APIs. The solution should favor simple abstractions and low migration cost.

## 2. Proposed Design

- Introduce a canonical `tags` resource.
- Model many-to-many associations between tags and supported entities.
- Expose tag CRUD and tag-assignment endpoints.
- Add tag filter parameters to list endpoints.

## 3. Data Model (Proposed)

### `tags`

- `id` (UUID or existing id strategy)
- `workspace_id`
- `name`
- `normalized_name` (lowercase/trimmed)
- `color` (optional)
- `created_at`, `updated_at`
- Unique constraint: (`workspace_id`, `normalized_name`)

### `entity_tags`

- `id` (or composite key)
- `workspace_id`
- `entity_type`
- `entity_id`
- `tag_id`
- `created_at`, `created_by`
- Unique constraint: (`workspace_id`, `entity_type`, `entity_id`, `tag_id`)

## 4. API Design (Proposed)

### Tag CRUD

- `GET /v1/tags?workspace_id=...`
- `POST /v1/tags`
- `PATCH /v1/tags/{tag_id}`
- `DELETE /v1/tags/{tag_id}`

### Tag Assignment

- `POST /v1/{entity_type}/{entity_id}/tags` (assign)
- `DELETE /v1/{entity_type}/{entity_id}/tags/{tag_id}` (unassign)
- `GET /v1/{entity_type}/{entity_id}/tags`

### Entity List Filtering

- Add query params:
  - `tag_ids=...` or `tags=...`
  - optional `tag_match=and|or` (default TBD)

## 5. Backend Behavior

- Normalize names on create/rename.
- Reject duplicate names in same workspace.
- Enforce workspace isolation on all joins.
- Add indexes for `entity_type + entity_id`, `tag_id`, and `workspace_id`.

## 6. Frontend Behavior

- Tag chip renderer shared across modules.
- Typeahead tag picker with create-on-enter.
- List filter component with persistent query params.
- Minimal optimistic updates with rollback on failure.

## 7. Migration and Compatibility

- Backfill not required for v1 (empty state acceptable).
- Keep API additive to avoid breaking older clients.
- Feature-flag all UI entry points.

## 8. Security and Auditing

- Authorization follows existing entity-level permissions.
- Audit events for create/rename/delete and assign/unassign.
- Validate input length/characters to prevent abuse.

## 9. Alternatives Considered

- JSON array of tags on each entity: simpler writes, harder querying.
- Separate per-entity tag tables: explicit, but duplicated logic and maintenance.
- Global tags across workspaces: simpler discovery, weaker isolation.

## 10. Open Questions

1. Should tag names be mutable after creation?
2. Is `entity_type` enum stable enough on this branch?
3. Do we need color/custom metadata in v1?
4. Should assignment endpoints be batch-capable from day one?
