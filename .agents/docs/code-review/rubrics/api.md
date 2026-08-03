# rubrics/api.md – API Review

**Domain:** Contract design, versioning, error codes, backward compatibility.
**Applies to:** REST, GraphQL, gRPC, WebSocket, or async message APIs.

---

## Goals

- Confirm that API changes are backward-compatible or are versioned correctly.
- Verify that error handling is consistent and informative.
- Ensure the API contract is documented and matches its implementation.

---

## Checklist

### Contract and design

| # | Criterion | Severity if violated |
|---|---|---|
| A‑1 | Endpoints follow a consistent naming convention (resource nouns, plural) | low |
| A‑2 | HTTP verbs are used semantically (GET read-only, POST create, PUT/PATCH update, DELETE remove) | medium |
| A‑3 | Request and response shapes are fully specified (schema, required fields, types) | medium |
| A‑4 | Pagination is implemented for list endpoints; unbounded responses are not possible | high |
| A‑5 | Filtering, sorting, and field selection parameters follow a consistent pattern | low |

### Backward compatibility

| # | Criterion | Severity if violated |
|---|---|---|
| A‑6 | No existing fields or endpoints are removed without a versioning strategy | high |
| A‑7 | Response field types are not changed in a breaking way (e.g., `int` → `string`) | high |
| A‑8 | New required request fields are not added to existing endpoints without a default | high |
| A‑9 | Enum values are not removed or reordered | medium |
| A‑10 | Deprecated endpoints have a sunset date and a migration path documented | medium |

### Versioning

| # | Criterion | Severity if violated |
|---|---|---|
| A‑11 | Breaking changes are introduced under a new version (URL path, header, or schema version) | high |
| A‑12 | Old versions continue to work for the documented deprecation period | high |
| A‑13 | Version is communicated consistently (URL prefix, `Accept` header, etc.) | medium |

### Error handling

| # | Criterion | Severity if violated |
|---|---|---|
| A‑14 | HTTP status codes are used correctly (4xx client errors, 5xx server errors) | medium |
| A‑15 | Error responses follow a consistent schema with a code, message, and optional details | medium |
| A‑16 | Internal error details (stack traces, DB messages) are not exposed to callers | high |
| A‑17 | Validation errors identify the offending field(s) | medium |

### Security and rate limiting

| # | Criterion | Severity if violated |
|---|---|---|
| A‑18 | Authentication is required on all non-public endpoints | critical |
| A‑19 | Rate limiting headers (`Retry-After`, `X-RateLimit-*`) are returned | medium |
| A‑20 | Input size limits are enforced (body size, field length, array count) | high |

### Documentation and testing

| # | Criterion | Severity if violated |
|---|---|---|
| A‑21 | OpenAPI / Protobuf / GraphQL schema is updated to reflect the change | medium |
| A‑22 | Contract tests or consumer-driven tests exist for changed endpoints | medium |
| A‑23 | Example requests and responses are provided in documentation | low |

---

## Scoring guidance

Breaking changes without versioning are **high** by default.  Removed or renamed fields without notice are **high**.  Undocumented changes to production APIs should be flagged as at minimum **medium** regardless of other criteria.
