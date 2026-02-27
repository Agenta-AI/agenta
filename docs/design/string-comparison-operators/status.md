# Status

## Current State: Implemented and Validated on Deployed Instance

**Last updated:** 2026-02-26

---

## Summary

This feature is implemented across backend, frontend, and API E2E tests.

| Layer | Files | Status |
|-------|-------|--------|
| Backend | `dtos.py`, `utils.py` | Done |
| Backend tests | `test_spans_queries.py` | Done |
| Frontend | `operatorRegistry.ts`, `constants.ts`, `utils.ts`, `helpers/utils.ts` | Done |

**Estimated effort:** 2-3 hours total

---

## Progress

### Backend

- [x] Research: Identified operator enum location
- [x] Research: Identified SQL handler function
- [x] Research: Verified no validation blockers
- [x] Implementation: Allow numeric operators for string fields in parser
- [x] Implementation: Route numeric operators for string fields in DAO
- [x] Testing: Add E2E tests to `api/oss/tests/pytest/e2e/tracing/test_spans_queries.py`
- [x] Testing: Run test class against running API

### Frontend

- [x] Research: Identified operator registry
- [x] Research: Identified custom field operator mapping
- [x] Implementation: Update operator registry
- [x] Implementation: Add `STRING_COMPARISON_OPS`
- [x] Implementation: Update customOperatorIdsForType
- [x] Implementation: Add comparison ops to Custom field operator options
- [x] Linting: Run `pnpm lint-fix` in `web/`

---

## Blockers

None.

---

## Notes

- PostgreSQL lexicographic comparison works correctly for ISO8601 dates
- No changes needed to validation layer (`_parse_attributes_condition`)
- The `between` operator is intentionally deferred (can be composed with `gte` + `lte`)
- API lint/format completed with: `uvx --from ruff==0.14.0 ruff format ...` and `ruff check --fix ...`
- Validated against deployed instance at `http://144.76.237.122:8280` using:
  - `AGENTA_API_URL=http://144.76.237.122:8280/api AGENTA_AUTH_KEY=replace-me uvx --from pytest --with requests --with python-dotenv pytest -c /dev/null oss/tests/pytest/e2e/tracing/test_spans_queries.py::TestSpanStringComparisonOperators -v`
  - Result: `5 passed`
