# Embeds Implementation Status

## Overview

The **embeds** feature enables workflow-in-workflow composition using `@ag.embed` references. Any workflow or environment can reference any other entity without special flags - the reference type determines what gets resolved.

## ✅ Completed Implementation

### Core Resolution Engine (100% Complete)

**Files:**
- `api/oss/src/core/embeds/service.py` - EmbedsService with universal resolver
- `api/oss/src/core/embeds/utils.py` - Resolution logic, path extraction, token parsing
- `api/oss/src/core/embeds/dtos.py` - Data transfer objects
- `api/oss/src/core/embeds/exceptions.py` - Exception hierarchy

**Features:**
- ✅ Object embeds (structural JSON replacement)
- ✅ String embeds (inline text interpolation)
- ✅ Path extraction with `@ag.selector` (e.g., `path: "parameters.system_prompt"`)
- ✅ Nested embeds (embeds within embeds)
- ✅ Circular reference detection (iteration-based tracking)
- ✅ Depth limit enforcement (default: 10 levels)
- ✅ Embed count limit (default: 100 embeds)
- ✅ Error policies: EXCEPTION, PLACEHOLDER, KEEP
- ✅ Universal resolver (routes to appropriate service based on entity type)

**Supported Entity Types:**
- ✅ `workflow_artifact`, `workflow_variant`, `workflow_revision`
- ✅ `environment_artifact`, `environment_variant`, `environment_revision`
- ✅ `application_artifact`, `application_variant`, `application_revision`
- ✅ `evaluator_artifact`, `evaluator_variant`, `evaluator_revision`

### API Integration (100% Complete)

**Endpoint:**
- ✅ `POST /preview/workflows/revisions/resolve`

**Implementation:**
- `api/oss/src/apis/fastapi/workflows/router.py` - Endpoint handler
- `api/oss/src/apis/fastapi/workflows/models.py` - Request/response models
- `api/oss/src/core/workflows/service.py` - Service method

**Request Model:**
```python
{
  "workflow_ref": Reference,
  "workflow_variant_ref": Reference,
  "workflow_revision_ref": Reference,
  "max_depth": 10,
  "max_embeds": 100,
  "error_policy": "exception"
}
```

**Response Model:**
```python
{
  "count": 1,
  "workflow_revision": WorkflowRevision,  # with resolved config
  "resolution_metadata": {
    "references_used": [...],
    "depth_reached": 2,
    "embeds_resolved": 3,
    "errors": []
  }
}
```

### Testing (100% Coverage)

**Unit Tests:** 46/46 passing (100%)
- `api/oss/tests/pytest/unit/embeds/test_service.py` - EmbedsService tests
- `api/oss/tests/pytest/unit/embeds/test_utils.py` - Utility function tests

**Test Coverage:**
- ✅ Object embed resolution
- ✅ String embed resolution
- ✅ Nested embeds
- ✅ Circular detection
- ✅ Multiple references to same entity
- ✅ Cross-entity references (all 4 types)
- ✅ Path extraction with selectors
- ✅ Depth limits
- ✅ Embed count limits
- ✅ Error policies (EXCEPTION, PLACEHOLDER, KEEP)

**Manual Tests:**
- ✅ `manual_test_embeds.py` - Core resolution logic (6 test cases)
- ✅ `manual_test_services.py` - Service integration (3 test cases)
- ✅ `manual_test_api_simple.py` - API flow simulation (2 test cases)

## 🚧 Remaining Work

### High Priority

#### 1. Environments Resolution Endpoint
**Estimate:** 2-3 hours

**Tasks:**
- [ ] Add `POST /preview/environments/revisions/resolve` endpoint
- [ ] Add request/response models in `environments/models.py`
- [ ] Add `resolve_environment_revision()` in `EnvironmentsService`
- [ ] Add unit tests for environments resolution

**Pattern:** Follow same structure as workflows endpoint

#### 2. Legacy Adapters (Applications & Evaluators)
**Estimate:** 3-4 hours

**Tasks:**
- [ ] Add `resolve_application_revision()` in `ApplicationsService`
- [ ] Add `resolve_evaluator_revision()` in `EvaluatorsService`
- [ ] Wire through legacy API endpoints if needed
- [ ] Add integration tests

**Note:** These are wrappers since applications/evaluators are workflows with flags

### Medium Priority

#### 3. SDK Integration
**Estimate:** 4-6 hours

**Tasks:**
- [ ] Add `resolve_embeds` parameter to `WorkflowServiceRequest`
- [ ] Add resolution middleware in SDK
- [ ] Call API endpoint to resolve before invocation
- [ ] Add SDK tests
- [ ] Update SDK documentation

**Files to modify:**
- `sdk/agenta/sdk/models/workflows.py`
- `sdk/agenta/sdk/decorators/running.py`
- New: `sdk/agenta/sdk/middlewares/running/resolver.py`

#### 4. E2E Integration Tests
**Estimate:** 3-4 hours

**Tasks:**
- [ ] Create E2E test with real database
- [ ] Test full workflow: create → reference → resolve
- [ ] Test via actual HTTP client
- [ ] Test permission checks
- [ ] Test cross-project reference blocking

### Low Priority (Future Enhancements)

#### 5. Caching & Performance
**Estimate:** 4-6 hours

**Tasks:**
- [ ] Add caching for frequently-referenced workflows
- [ ] Performance profiling for deep nesting
- [ ] Optimize batch fetches if possible
- [ ] Add telemetry/metrics

#### 6. Documentation
**Estimate:** 4-5 hours

**Tasks:**
- [ ] API documentation (OpenAPI specs)
- [ ] User guide for creating reusable components
- [ ] Migration guide from duplicated configs
- [ ] SDK examples and best practices
- [ ] Architecture documentation

#### 7. Web UI Integration
**Estimate:** 8-12 hours

**Tasks:**
- [ ] Embed picker component
- [ ] Visual embed editor
- [ ] Preview resolved configuration
- [ ] Embed dependency graph visualization

## Reference Format Examples

### Object Embed (Structural Replacement)
```python
{
  "llm_config": {
    "@ag.embed": {
      "@ag.references": {
        "workflow_revision": {
          "version": "base-prompt",
          "slug": None,
          "id": None
        }
      },
      "@ag.selector": {
        "path": "parameters.system_prompt"
      }
    }
  }
}

# After resolution:
{
  "llm_config": "You are a helpful AI assistant"
}
```

### String Embed (Inline Interpolation)
```python
{
  "prompt": "Use this system prompt: @ag.embed[@ag.references[workflow_revision:v1], @ag.selector[path:parameters.system_prompt]]"
}

# After resolution:
{
  "prompt": "Use this system prompt: You are a helpful AI assistant"
}
```

### Nested Embeds (Workflow → Workflow → Environment)
```python
# Level 1: App references workflow
{
  "app_config": {
    "@ag.embed": {
      "@ag.references": {"workflow_revision": {"version": "v1"}}
    }
  }
}

# Level 2: Workflow v1 references environment
{
  "parameters": {
    "api_config": {
      "@ag.embed": {
        "@ag.references": {"environment_revision": {"slug": "prod"}}
      }
    }
  }
}

# Level 3: Environment has final config
{
  "api_key": "your-api-key",
  "base_url": "https://api.openai.com/v1"
}

# Final resolved:
{
  "app_config": {
    "parameters": {
      "api_config": {
        "api_key": "your-api-key",
        "base_url": "https://api.openai.com/v1"
      }
    }
  }
}
```

## Architecture Decisions

### ✅ Selector-Based References (No Entity Flags)
**Decision:** Use type selectors in references instead of `is_embeddable` flags.

**Benefits:**
- Any entity can be referenced without marking
- Clear intent in the reference itself
- Flexible: same entity can be referenced differently based on path
- No database schema changes needed

### ✅ Iteration-Based Circular Detection
**Problem:** Need to allow multiple refs to same entity in one iteration, but detect circular refs across iterations.

**Solution:** Track `seen_by_iteration: Dict[str, int]` globally.
- Same entity referenced twice in iteration N → ✅ Allowed
- Entity resolved in iteration N appears again in iteration N+1 → ❌ Circular

### ✅ Universal Resolver Pattern
**Pattern:** Single resolver function that routes to appropriate service based on entity type.

**Benefits:**
- Any entity can reference any other entity
- Clean separation of concerns
- Easy to extend with new entity types

## Testing Strategy

### Unit Tests (Current: 46/46 = 100%)
- Core resolution logic isolated
- Mock services for entity fetching
- All edge cases covered

### Integration Tests (To Do)
- Real database-backed services
- Full entity lifecycle (create → reference → resolve)
- Permission checks
- Cross-entity scenarios

### E2E Tests (To Do)
- HTTP client tests
- SDK integration tests
- Performance tests (100+ embeds, 10 levels deep)

## Migration & Deployment

### No Breaking Changes
- ✅ Embeds are opt-in (only if `@ag.embed` present)
- ✅ No database schema changes
- ✅ No entity flags to backfill
- ✅ Existing configs work unchanged

### Deployment Checklist
- [x] Core service implemented
- [x] Unit tests passing
- [x] API endpoint exposed
- [ ] E2E tests passing
- [ ] Documentation complete
- [ ] SDK integration complete
- [ ] Performance validated

## Success Metrics

**Functionality:**
- ✅ String and object embeds both work
- ✅ Path extraction functional
- ✅ Cycle detection prevents infinite loops
- ✅ Depth and count limits enforced

**Integration:**
- ✅ Works with /preview/workflows endpoint
- ⏳ Works with /preview/environments endpoint
- ⏳ Legacy applications/evaluators compatible
- ⏳ SDK resolution transparent

**Performance:**
- ⏳ Resolution < 1s for 10 embeds
- ⏳ Resolution < 3s for 100 embeds
- ⏳ No N+1 queries

**Reliability:**
- ✅ Graceful error handling
- ✅ No data corruption on resolution failure
- ⏳ Permission checks enforced
- ⏳ Tenant isolation maintained

## Next Steps

**Immediate (Next Session):**
1. Implement environments resolution endpoint
2. Add legacy adapters (applications, evaluators)
3. Create E2E integration tests

**Short Term (This Sprint):**
4. SDK integration
5. API documentation
6. User guide

**Long Term (Future Sprints):**
7. Web UI integration
8. Performance optimization
9. Advanced features (caching, telemetry)

---

**Last Updated:** 2026-02-16
**Status:** ✅ Core Complete, 🚧 Integration In Progress
