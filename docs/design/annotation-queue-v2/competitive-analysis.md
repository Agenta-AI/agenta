# Competitive Analysis: Annotation Architecture

**Status**: Research  
**Date**: 2026-02-12

This document analyzes a competitor's approach to human annotation and review queues, anonymized as "Platform X".

---

## Executive Summary

Platform X takes a radically simple approach: **annotations are just fields on items**. There are no separate annotation entities, no queue tables, and no predefined schemas. Everything is a merge operation on existing data.

This simplicity enables rapid implementation but trades off structured workflows and enforcement.

---

## Architecture Overview

### Core Principle: Everything is Metadata

Platform X stores all data (traces, dataset rows, experiment results) as items with flexible schemas. Annotations, review status, and assignments are just metadata fields on these items.

```
┌─────────────────────────────────────────────────────────────────┐
│                           ITEM                                   │
│  (Span, Dataset Row, Experiment Row - all same pattern)         │
├─────────────────────────────────────────────────────────────────┤
│  id: "item-123"                                                  │
│  input: {...}                     ← Original input               │
│  output: {...}                    ← Original output              │
│  expected: "thumbs up"            ← Ground truth (annotation)    │
│  scores: {                        ← Evaluation scores            │
│    quality: 0.9,                                                 │
│    relevance: "high"                                             │
│  }                                                               │
│  metadata: {                                                     │
│    model: "gpt-4",                ← User metadata                │
│    ~__review_lists: {             ← System: queue membership     │
│      default: {status: "PENDING"}                                │
│    },                                                            │
│    ~__assignments: ["user-1"]     ← System: assignees            │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Approach |
|----------|----------|
| Annotation storage | Inline fields on items (`expected`, `scores.*`, `metadata.*`) |
| Queue membership | Metadata field: `metadata.~__review_lists.{queue}.status` |
| Assignments | Metadata field: `metadata.~__assignments` (array of user IDs) |
| Annotation schema | **None enforced** - freeform fields |
| Write mechanism | Merge/patch with explicit `_merge_paths` |
| Audit trail | `_audit_source` and `_audit_metadata` on each write |

---

## How Annotations Work

### No Predefined Schema

Platform X does **not** predefine what annotations are allowed. The UI presents common fields:

1. **`expected`** - Ground truth / expected output (first-class field)
2. **`scores.*`** - Numeric or categorical scores (first-class object)
3. **`metadata.*`** - Arbitrary user-defined fields

The UI likely:
- Shows these common fields by default
- Auto-discovers additional fields from existing data
- Allows users to add arbitrary fields on-the-fly

### Write Pattern (Merge Semantics)

All writes use a merge/patch pattern:

```json
POST /logs
{
  "rows": [{
    "_is_merge": true,
    "id": "item-123",
    "_merge_paths": [["expected"]],
    "expected": "👍",
    "_audit_source": "app",
    "_audit_metadata": {"user_id": "user-456"}
  }]
}
```

Key properties:
- `_is_merge: true` - Patch, not replace
- `_merge_paths` - Explicit paths being updated (CRDT-like)
- `_audit_*` - Who made the change

This allows concurrent updates to different fields without conflicts.

### Score Types Observed

From API analysis, scores appear to support:
- **String/Emoji**: `expected: "👍"`
- **Text**: `metadata.expect: "this should include..."`
- **Numeric**: `scores.quality: 0.9` (inferred from schema)
- **Categorical**: Likely supported via string enums

---

## How Review Queues Work

### No Queue Entity

There is no `Queue` table. A "queue" is just:
1. A name (e.g., `"default"`, `"my_custom_queue"`)
2. A filter on items with that queue name in metadata

### Adding Items to Queue

```json
POST /logs
{
  "rows": [{
    "_is_merge": true,
    "id": "item-123",
    "_merge_paths": [["metadata", "~__review_lists"]],
    "metadata": {
      "~__review_lists": {
        "default": {"status": "PENDING"}
      }
    }
  }]
}
```

### Querying the Queue (Inbox)

```sql
SELECT * FROM items
WHERE metadata.~__review_lists.default.status IS NOT NULL
   OR metadata.~__assignments IS NOT NULL
ORDER BY created_at DESC
```

The UI builds this filter dynamically based on:
- Queue name
- Status filter (PENDING, COMPLETED, etc.)
- Assignment filter (my items vs. all)

### Queue Status Values

Observed statuses:
- `PENDING` - Needs review
- (Likely: `COMPLETED`, `SKIPPED`, etc.)

### Assignment Pattern

```json
{
  "_merge_paths": [["metadata", "~__assignments"]],
  "metadata": {
    "~__assignments": ["user-id-1", "user-id-2"]
  }
}
```

- Empty array `[]` = Anyone can work on it
- User IDs array = Only assigned users see it in their inbox

### Notifications

Separate endpoint for sending assignment emails:

```json
POST /actions/sendAssignmentNotification
{
  "function_args": {
    "orgName": "acme",
    "assignerName": "John Doe",
    "link": "/app/acme/p/my-project/datasets/ds-123",
    "emails": ["jane@example.com"],
    "entityType": "dataset",
    "entityName": "my-dataset"
  }
}
```

Notifications are fire-and-forget side effects, not part of the data model.

---

## How Metrics/Evaluators Work

### Freeform Scores

There's no "create evaluator" step. Users just write to `scores.*`:

```json
{
  "_merge_paths": [["scores", "quality"]],
  "scores": {"quality": 0.85}
}
```

The UI then:
1. Queries items to discover what score keys exist
2. Shows aggregations/distributions per key
3. Allows filtering by score values

### Schema Inference

The API has an `infer` capability:

```json
POST /btql
{
  "query": {
    "from": {"op": "function", "name": ["project_logs"], "args": [...]},
    "infer": [{"op": "ident", "name": ["input"]}],
    "limit": 500
  }
}
```

This likely:
- Samples data to discover field structure
- Returns inferred schema for UI rendering
- Used for auto-generating column definitions

---

## Unified API Pattern

Everything goes through one endpoint (`/logs`) with the same merge pattern:

| Operation | Implementation |
|-----------|----------------|
| Log a trace | `POST /logs` with full item |
| Add annotation | `POST /logs` with `_is_merge: true` |
| Add to queue | `POST /logs` with `_is_merge: true` + review_lists |
| Assign users | `POST /logs` with `_is_merge: true` + assignments |
| Update status | `POST /logs` with `_is_merge: true` + status change |

This unified pattern simplifies the API surface dramatically.

---

## Query Language

Platform X uses a custom query language (AST-based) that supports:

```json
{
  "query": {
    "filter": {"btql": "metadata.~__review_lists.default.status IS NOT NULL"},
    "from": {"op": "function", "name": ["project_logs"], "args": [...]},
    "select": [{"op": "star"}],
    "sort": [{"expr": {"btql": "_pagination_key"}, "dir": "desc"}],
    "limit": 50,
    "custom_columns": [
      {"expr": {"btql": "metadata.~__review_lists.default.status"}, "alias": "review_status"}
    ]
  }
}
```

Features:
- SQL-like expressions in AST form
- Custom column aliases for extracting nested fields
- Pagination via cursor keys
- Cross-entity queries (multiple datasets in one call)

---

## Strengths

| Strength | Details |
|----------|---------|
| **Simplicity** | No new entities to manage |
| **Flexibility** | Any field can be an annotation |
| **Unified API** | One endpoint for everything |
| **No migrations** | Schema changes are just new fields |
| **Fast iteration** | Add new annotation types instantly |
| **Self-describing** | Data carries its own structure |

---

## Weaknesses

| Weakness | Details |
|----------|---------|
| **No schema enforcement** | Can't enforce required fields or types |
| **No queue-level metadata** | Can't have queue description, instructions, deadlines |
| **Limited assignment logic** | No round-robin, load balancing built-in |
| **No claim/lock** | Two users could annotate same item simultaneously |
| **Progress tracking** | Requires aggregation queries, not pre-computed |
| **Data sprawl** | Arbitrary fields can proliferate without governance |
| **Audit limitations** | Only last modifier tracked, not full history |

---

## Applicability to Our System

### What We Could Adopt

1. **Metadata-based queue membership** - Add review status to span/testcase meta
2. **Freeform annotations** - Allow any field as annotation without predefined schema
3. **Merge semantics** - PATCH-style updates with explicit paths
4. **Filter-based inbox** - Query items by metadata instead of separate task table

### What We Should Enhance

1. **Optional schema validation** - Allow defining expected annotation types per "queue"
2. **Queue entity for metadata** - Store queue name, description, instructions, deadline
3. **Assignment algorithms** - Round-robin, load-balanced distribution
4. **Claim mechanism** - Prevent concurrent annotation of same item
5. **Progress denormalization** - Pre-compute completion counts for dashboards

### Hybrid Approach

Combine the simplicity of metadata-based queues with optional structure:

```
┌─────────────────────────────────────────────────────────────────┐
│                    REVIEW QUEUE (Optional Entity)                │
│  id: "queue-123"                                                 │
│  name: "Quality Review Q1"                                       │
│  description: "Review responses for quality"                     │
│  annotation_schema: {...}         ← Optional JSON Schema         │
│  instructions: "Rate quality 1-5" ← Guidelines for annotators    │
│  deadline: "2024-04-01"           ← Optional deadline            │
│  assignees: ["user-1", "user-2"]  ← Default assignees            │
│  status: "active"                                                │
│  progress: {pending: 45, completed: 123}  ← Denormalized         │
└─────────────────────────────────────────────────────────────────┘
                           │
                           │ Items reference queue via metadata
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                           ITEM                                   │
│  meta: {                                                         │
│    agenta.review: {                                              │
│      queue_id: "queue-123",       ← Links to queue entity        │
│      status: "pending",                                          │
│      assigned_to: "user-1",                                      │
│      claimed_at: null                                            │
│    }                                                             │
│  }                                                               │
│  annotations: {                   ← Stored inline                │
│    quality: 4,                                                   │
│    notes: "Good response"                                        │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

This gives us:
- Simplicity of metadata-based tracking (no task table)
- Optional structure when needed (queue entity)
- Schema validation when desired
- Denormalized progress for dashboards
- Claim mechanism for concurrent access

---

## Recommendation

Start with the simple metadata approach for v1:
1. Add review metadata to spans/testcases
2. Build inbox as filtered query
3. Store annotations inline

Add queue entity in v2 if/when needed:
1. Queue-level metadata and instructions
2. Schema validation
3. Progress tracking
4. Advanced assignment

This matches their evolutionary path while leaving room for our more structured requirements.
