# Execution Plan

## Phase 1: Backend Changes

### 1.1 Reuse numeric operators for string comparisons

No new enum values are needed. `gt`/`lt`/`gte`/`lte` already exist in `NumericOperator` and can be reused for lexicographic string comparisons.

### 1.2 Allow numeric operators on string fields

**File:** `api/oss/src/core/tracing/utils.py`

Update `_parse_string_field_condition()` to accept `_N_OPS` in addition to comparison/string/list/existence ops.

### 1.3 Route numeric operators for string fields in DAO

**File:** `api/oss/src/dbs/postgres/tracing/utils.py`

Update `_handle_string_field()` to dispatch `NumericOperator` through `_handle_numeric_operator()`, which already performs lexicographic comparisons for string values.

### 1.4 Verify attribute-field compatibility

`_parse_attributes_condition()` only checks that `key` is present, and `_handle_attributes_field()` already supports `NumericOperator` values with string casts when needed.

---

## Phase 2: Frontend Changes

### 2.1 Update operator registry

**File:** `web/oss/src/components/pages/observability/assets/filters/operatorRegistry.ts`

Change `forTypes` for comparison operators:

```typescript
{id: "gt", label: ">", forTypes: ["number", "string"], valueShape: "single"},
{id: "lt", label: "<", forTypes: ["number", "string"], valueShape: "single"},
{id: "gte", label: ">=", forTypes: ["number", "string"], valueShape: "single"},
{id: "lte", label: "<=", forTypes: ["number", "string"], valueShape: "single"},
```

### 2.2 Add string comparison ops array

**File:** `web/oss/src/components/pages/observability/assets/utils.ts`

```typescript
export const STRING_COMPARISON_OPS: {value: FilterConditions; label: string}[] = [
    {value: "gt", label: ">"},
    {value: "lt", label: "<"},
    {value: "gte", label: ">="},
    {value: "lte", label: "<="},
]
```

### 2.3 Update custom field operators

**File:** `web/oss/src/components/Filters/helpers/utils.ts`

```typescript
export const customOperatorIdsForType = (t: CustomValueType): FilterConditions[] =>
    t === "number"
        ? ["eq", "neq", "gt", "lt", "gte", "lte"]
        : t === "boolean"
          ? ["is", "is_not"]
          : ["is", "is_not", "contains", "startswith", "endswith", "in", "not_in", "gt", "lt", "gte", "lte"]
```

---

## Phase 3: E2E Tests

### 3.1 API E2E Tests

**File:** `api/oss/tests/pytest/e2e/tracing/test_spans_queries.py`

Add test cases to the existing `TestSpansQueries` class. Following the existing fixture pattern:

```python
@pytest.fixture(scope="class")
def string_comparison_data(authed_api):
    """Create spans with datetime string attributes for comparison tests."""
    trace_id = uuid4().hex
    
    spans = [
        {
            "trace_id": trace_id,
            "span_id": uuid4().hex[:16],
            "span_name": "span_jan_15",
            "span_kind": "SPAN_KIND_SERVER",
            "start_time": 1705312200,  # 2024-01-15
            "end_time": 1705315800,
            "status_code": "STATUS_CODE_OK",
            "attributes": {
                "tags": {"created_at": "2024-01-15T10:30:00Z"},
            },
        },
        {
            "trace_id": trace_id,
            "span_id": uuid4().hex[:16],
            "span_name": "span_jan_20",
            "span_kind": "SPAN_KIND_SERVER",
            "start_time": 1705744200,  # 2024-01-20
            "end_time": 1705747800,
            "status_code": "STATUS_CODE_OK",
            "attributes": {
                "tags": {"created_at": "2024-01-20T10:30:00Z"},
            },
        },
        {
            "trace_id": trace_id,
            "span_id": uuid4().hex[:16],
            "span_name": "span_jan_25",
            "span_kind": "SPAN_KIND_SERVER",
            "start_time": 1706176200,  # 2024-01-25
            "end_time": 1706179800,
            "status_code": "STATUS_CODE_OK",
            "attributes": {
                "tags": {"created_at": "2024-01-25T10:30:00Z"},
            },
        },
    ]
    
    response = authed_api(
        "POST",
        "/preview/tracing/spans/ingest",
        json={"spans": spans},
    )
    assert response.status_code == 202
    
    # Wait for ingestion
    wait_for_response(
        authed_api,
        "POST",
        "/preview/tracing/spans/query",
        json={
            "focus": "span",
            "filter": {"conditions": [{"field": "trace_id", "operator": "is", "value": trace_id}]},
        },
        condition_fn=lambda r: r.json().get("count", 0) >= 3,
    )
    
    return {"trace_id": trace_id, "spans": spans}


class TestStringComparisonOperators:
    """Tests for string comparison operators (gt, lt, gte, lte)."""

    @pytest.mark.coverage_smoke
    @pytest.mark.path_happy
    def test_string_gt_operator(self, authed_api, string_comparison_data):
        """Test 'gt' (greater than) operator on string attributes."""
        trace_id = string_comparison_data["trace_id"]
        
        response = authed_api(
            "POST",
            "/preview/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "conditions": [
                        {"field": "trace_id", "operator": "is", "value": trace_id},
                        {"field": "attributes", "key": "tags.created_at", "operator": "gt", "value": "2024-01-15"},
                    ]
                },
            },
        )
        
        assert response.status_code == 200
        data = response.json()
        # Should return jan_20 and jan_25 (not jan_15)
        assert data["count"] == 2

    @pytest.mark.coverage_smoke
    @pytest.mark.path_happy
    def test_string_gte_operator(self, authed_api, string_comparison_data):
        """Test 'gte' (greater than or equal) operator on string attributes."""
        trace_id = string_comparison_data["trace_id"]
        
        response = authed_api(
            "POST",
            "/preview/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "conditions": [
                        {"field": "trace_id", "operator": "is", "value": trace_id},
                        {"field": "attributes", "key": "tags.created_at", "operator": "gte", "value": "2024-01-20"},
                    ]
                },
            },
        )
        
        assert response.status_code == 200
        data = response.json()
        # Should return jan_20 and jan_25
        assert data["count"] == 2

    @pytest.mark.coverage_smoke
    @pytest.mark.path_happy
    def test_string_lt_operator(self, authed_api, string_comparison_data):
        """Test 'lt' (less than) operator on string attributes."""
        trace_id = string_comparison_data["trace_id"]
        
        response = authed_api(
            "POST",
            "/preview/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "conditions": [
                        {"field": "trace_id", "operator": "is", "value": trace_id},
                        {"field": "attributes", "key": "tags.created_at", "operator": "lt", "value": "2024-01-25"},
                    ]
                },
            },
        )
        
        assert response.status_code == 200
        data = response.json()
        # Should return jan_15 and jan_20 (not jan_25)
        assert data["count"] == 2

    @pytest.mark.coverage_smoke
    @pytest.mark.path_happy
    def test_string_lte_operator(self, authed_api, string_comparison_data):
        """Test 'lte' (less than or equal) operator on string attributes."""
        trace_id = string_comparison_data["trace_id"]
        
        response = authed_api(
            "POST",
            "/preview/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "conditions": [
                        {"field": "trace_id", "operator": "is", "value": trace_id},
                        {"field": "attributes", "key": "tags.created_at", "operator": "lte", "value": "2024-01-15"},
                    ]
                },
            },
        )
        
        assert response.status_code == 200
        data = response.json()
        # Should return only jan_15
        assert data["count"] == 1

    @pytest.mark.coverage_smoke
    @pytest.mark.path_happy
    def test_string_range_query(self, authed_api, string_comparison_data):
        """Test combining gte + lt for range query on string attributes."""
        trace_id = string_comparison_data["trace_id"]
        
        response = authed_api(
            "POST",
            "/preview/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "operator": "and",
                    "conditions": [
                        {"field": "trace_id", "operator": "is", "value": trace_id},
                        {"field": "attributes", "key": "tags.created_at", "operator": "gte", "value": "2024-01-15"},
                        {"field": "attributes", "key": "tags.created_at", "operator": "lt", "value": "2024-01-25"},
                    ]
                },
            },
        )
        
        assert response.status_code == 200
        data = response.json()
        # Should return jan_15 and jan_20 (not jan_25)
        assert data["count"] == 2
```

### 3.2 Run Tests

```bash
# Run only the new string comparison tests
cd api
AGENTA_API_URL=http://localhost:10180/api AGENTA_AUTH_KEY=change-me-auth \
  python -m pytest oss/tests/pytest/e2e/tracing/test_spans_queries.py::TestStringComparisonOperators -v

# Run all tracing tests
python -m pytest oss/tests/pytest/e2e/tracing/ -v -m coverage_smoke
```

---

## Checklist

- [x] Backend: Allow numeric operators in `_parse_string_field_condition()`
- [x] Backend: Route numeric operators in `_handle_string_field()`
- [x] Tests: Add API E2E tests for string comparison operators
- [ ] Tests: Run `python -m pytest oss/tests/pytest/e2e/tracing/ -v` (blocked locally: API server not running)
- [x] Frontend: Update `operatorRegistry.ts` - add `"string"` to `forTypes`
- [x] Frontend: Add `STRING_COMPARISON_OPS` array in `utils.ts`
- [x] Frontend: Update `customOperatorIdsForType()` in `helpers/utils.ts`
- [x] Linting: Run `ruff format && ruff check --fix` in `api/`
- [x] Linting: Run `pnpm lint-fix` in `web/`
