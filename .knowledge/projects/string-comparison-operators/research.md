# Research

## Backend Architecture

### Operator Flow

```
API Request (JSON filter)
    ↓
api/oss/src/apis/fastapi/tracing/utils.py
    → _parse_filtering() constructs Filtering DTO
    ↓
api/oss/src/core/tracing/utils.py
    → parse_condition() validates operators per field
    → _parse_attributes_condition() - minimal validation, just requires key
    ↓
api/oss/src/dbs/postgres/tracing/utils.py
    → _handle_string_operator() generates SQL clauses
```

### Key Files

#### 1. String Condition Validation

**File:** `api/oss/src/core/tracing/utils.py` (`_parse_string_field_condition`)

```python
def _parse_string_field_condition(condition: Condition) -> None:
    if condition.operator not in _C_OPS + _N_OPS + _S_OPS + _L_OPS + _E_OPS:
        raise FilteringException(...)

    if condition.operator in _N_OPS + _S_OPS + _L_OPS and condition.value is None:
        raise FilteringException(...)
```

**Change:** Permit numeric operators (`gt`, `lt`, `gte`, `lte`) for string fields.

#### 2. SQL Handler Routing for String Fields

**File:** `api/oss/src/dbs/postgres/tracing/utils.py` (`_handle_string_field`)

```python
elif isinstance(operator, NumericOperator):
    clauses.extend(
        _handle_numeric_operator(
            attribute=attribute,
            operator=operator,
            value=value,
        )
    )
```

**Change:** Route numeric operators to `_handle_numeric_operator()` for plain string columns.

#### 3. Existing String Handler

**File:** `api/oss/src/dbs/postgres/tracing/utils.py` (lines 177-239)

```python
def _handle_string_operator(
    *,
    attribute: ColumnElement,
    operator: StringOperator,
    value: str,
    options: Optional[TextOptions] = None,
    key: Optional[str] = None,
) -> List[ColumnElement]:
    # ... handles JSONB path extraction if key is provided
    # ... then applies operator-specific SQL
```

**No change needed** inside `_handle_string_operator()` itself.

#### 4. Attributes Validation

**File:** `api/oss/src/core/tracing/utils.py` (lines 913-918)

```python
def _parse_attributes_condition(condition: Condition) -> None:
    if condition.key is None:
        raise FilteringException(
            "'attributes' key is required and thus never null.",
        )
```

**No change needed** - attributes field already allows numeric operators and only validates that `key` is present.

### SQL Generation for JSONB String Comparison

When filtering on `attributes.tags.created_at > "2024-01-15"`:

```python
# Existing flow in _handle_numeric_operator() for attributes with key:
if key is not None:
    container, leaf = _to_jsonb_path(attribute, key, leaf_as_text=False)
    clauses.append(container.op("?")(leaf))  # Ensure key exists

    attribute, _ = _to_jsonb_path(attribute, key)  # Extract as TEXT via ->>
    attribute = cast(attribute, String)

if operator == NumericOperator.GT:
    clauses.append(attribute > value)
elif operator == NumericOperator.LT:
    clauses.append(attribute < value)
```

**Generated SQL:**

```sql
-- For: attributes.tags.created_at > "2024-01-15"
WHERE attributes->'tags' ? 'created_at'
  AND CAST(attributes->'tags'->>'created_at' AS VARCHAR) > '2024-01-15'
```

PostgreSQL's `>` on `VARCHAR` performs lexicographic comparison, so ISO8601 dates sort correctly.

---

## Frontend Architecture

### Operator Definition Flow

```
operatorRegistry.ts
    → Defines which operators apply to which types
    ↓
utils.ts (STRING_EQU_OPS, NUM_OPS, etc.)
    → Groups operators for easy reference
    ↓
constants.ts (FILTER_COLUMNS)
    → Each field specifies its operatorOptions
    ↓
Filters.tsx
    → Renders operator dropdown based on field config
```

### Key Files

#### 1. Operator Registry

**File:** `web/oss/src/components/pages/observability/assets/filters/operatorRegistry.ts` (lines 39-44)

```typescript
// Currently only for "number" type:
{id: "gt", label: ">", forTypes: ["number"], valueShape: "single"},
{id: "lt", label: "<", forTypes: ["number"], valueShape: "single"},
{id: "gte", label: ">=", forTypes: ["number"], valueShape: "single"},
{id: "lte", label: "<=", forTypes: ["number"], valueShape: "single"},
```

**Change:** Add `"string"` to `forTypes`.

#### 2. Operator Arrays

**File:** `web/oss/src/components/pages/observability/assets/utils.ts` (lines 21-56)

```typescript
export const STRING_EQU_OPS: {value: FilterConditions; label: string}[] = [...]
export const STRING_SEARCH_OPS: {value: FilterConditions; label: string}[] = [...]
export const NUM_OPS: {value: FilterConditions; label: string}[] = [...]
```

**Change:** Add `STRING_COMPARISON_OPS` array.

#### 3. Custom Field Operators

**File:** `web/oss/src/components/Filters/helpers/utils.ts` (lines 159-164)

```typescript
export const customOperatorIdsForType = (t: CustomValueType): FilterConditions[] =>
    t === "number"
        ? ["eq", "neq", "gt", "lt", "gte", "lte"]
        : t === "boolean"
          ? ["is", "is_not"]
          : ["is", "is_not", "contains", "startswith", "endswith", "in", "not_in"]
```

**Change:** Add `"gt", "lt", "gte", "lte"` to the string case.

#### 4. Field Configuration

**File:** `web/oss/src/components/pages/observability/assets/constants.ts`

Each field's `operatorOptions` array controls what operators appear in the dropdown. For custom/dynamic attributes, this is derived from `customOperatorIdsForType`.

---

## Testing Considerations

### Backend

1. Unit test `_handle_string_operator()` with new operators
2. Integration test: query spans with `attributes.tags.created_at > "2024-01-15"`
3. Edge cases:
   - Empty string comparison
   - Unicode strings
   - Very long strings

### Frontend

1. Verify operator dropdown shows `>`, `<`, `>=`, `<=` for string fields
2. Verify filter payload includes correct operator
3. Test with custom attributes added via "Add Filter" flow

---

## Alternatives Considered

### 1. Add a `DatetimeOperator` family

**Rejected** because:
- Requires knowing which attributes contain dates
- Adds parsing/timezone complexity
- Lexicographic string comparison works for ISO8601

### 2. Allow `NumericOperator` on strings (skip cast)

**Rejected** because:
- Confusing semantics (same operator, different behavior based on value type)
- Would need to detect "is this value numeric?" logic

### 3. Add `btwn` (between) for strings

**Deferred** - can be composed with `gte` + `lte` via `AND`. Add later if users request it.
