# Test Plan: Reference Enrichment Across All Evaluation Paths

## Overview

This test plan validates that all reference enrichment paths correctly populate the `references` dictionary with fully enriched data (id, slug, version for revisions; id, slug for variants/entities; id-only for testcases).

The reference enrichment system supports six primary evaluation/invocation paths, each with distinct reference enrichment requirements.

---

## Reference Enrichment Specification

### Entity Reference Schema

**Revision Reference** (for application_revision, evaluator_revision, etc.):
```python
{
  "id": UUID,
  "slug": str,
  "version": int,
}
```

**Variant Reference** (for application_variant, evaluator_variant, etc.):
```python
{
  "id": UUID,
  "slug": str,
}
```

**Entity Reference** (for application, evaluator, testset, query):
```python
{
  "id": UUID,
  "slug": str,
}
```

**Testcase Reference** (unique, id-only):
```python
{
  "id": UUID,
}
```

**Environment References** (when used):
- `environment`: {id, slug}
- `environment_variant`: {id, slug}
- `environment_revision`: {id, slug, version}
- `selector`: {key: str} (the key used to look up target in environment's references)

---

## Evaluation Paths

### Path 1: Batch Evaluation with Application Invocation

**Scenario**: Testset is executed against an application revision.

**Entry Point**: `EvaluationsService.create_simple_evaluation()`
  - Input: testset refs, application refs, testcase refs

**Reference Enrichment Flow**:
1. `TestsetsService.retrieve_testset_revision()` → enriches testset, testset_variant, testset_revision
2. `ApplicationsService.retrieve_application_revision()` → enriches application, application_variant, application_revision ± environment stack
3. Testcase IDs passed as-is (id-only references)

**Expected References in EvaluationRunDataStep**:
- `testset`: {id, slug}
- `testset_variant`: {id, slug}
- `testset_revision`: {id, slug, version}
- `application`: {id, slug}
- `application_variant`: {id, slug}
- `application_revision`: {id, slug, version}
- `testcase`: {id} ← **id-only**
- `environment` (optional): {id, slug}
- `environment_variant` (optional): {id, slug}
- `environment_revision` (optional): {id, slug, version}
- `selector` (optional): {key: str}

---

### Path 2: Batch Evaluation with Evaluator Invocation

**Scenario**: Testset is executed through evaluators (not applications).

**Entry Point**: `EvaluationsService.create_simple_evaluation()` with evaluator steps
  - Input: testset refs, evaluator refs, testcase refs

**Reference Enrichment Flow**:
1. `TestsetsService.retrieve_testset_revision()` → enriches testset, testset_variant, testset_revision
2. `EvaluatorsService.retrieve_evaluator_revision()` → enriches evaluator, evaluator_variant, evaluator_revision
3. Testcase IDs passed as-is (id-only references)

**Expected References in EvaluationRunDataStep**:
- `testset`: {id, slug}
- `testset_variant`: {id, slug}
- `testset_revision`: {id, slug, version}
- `evaluator`: {id, slug}
- `evaluator_variant`: {id, slug}
- `evaluator_revision`: {id, slug, version}
- `testcase`: {id} ← **id-only**

---

### Path 3: Live Evaluation with Evaluator Invocation

**Scenario**: Query revisions are executed live against evaluators (no testset).

**Entry Point**: `EvaluationsService.create_simple_evaluation()` with query steps and live flag
  - Input: query refs, evaluator refs (no testcase)

**Reference Enrichment Flow**:
1. `QueriesService.retrieve_query_revision()` → enriches query, query_variant, query_revision
2. `EvaluatorsService.retrieve_evaluator_revision()` → enriches evaluator, evaluator_variant, evaluator_revision

**Expected References in EvaluationRunDataStep**:
- `query`: {id, slug}
- `query_variant`: {id, slug}
- `query_revision`: {id, slug, version}
- `evaluator`: {id, slug}
- `evaluator_variant`: {id, slug}
- `evaluator_revision`: {id, slug, version}
- **NO testcase reference** (live queries have no static testcases)

---

### Path 4: Invocations Service Direct (No Environment)

**Scenario**: Application revision is invoked directly without environment backing.

**Entry Point**: `InvocationsService.create()`
  - Input: application refs (direct)

**Reference Enrichment Flow**:
1. `ApplicationsService.retrieve_application_revision()` → enriches application, application_variant, application_revision
   - `RetrievalInfo` has no environment stack (direct retrieval)

**Expected References**:
- `application`: {id, slug}
- `application_variant`: {id, slug}
- `application_revision`: {id, slug, version}
- **NO environment references**
- **NO selector**

---

### Path 5: Invocations Service with Environment Backing

**Scenario**: Application revision is resolved through an environment configuration.

**Entry Point**: `InvocationsService.create()`
  - Input: environment refs + selector key

**Reference Enrichment Flow**:
1. `ApplicationsService.retrieve_application_revision()` with environment refs
   - Resolves environment → environment_variant → environment_revision
   - Uses selector key to look up target application refs in environment's references map
   - Returns `RetrievalInfo` with:
     - `references`: {environment, environment_variant, environment_revision, application, application_variant, application_revision}
     - `selector`: {key: "..."}

**Expected References**:
- `environment`: {id, slug}
- `environment_variant`: {id, slug}
- `environment_revision`: {id, slug, version}
- `selector`: {key: str} ← **the key used in lookup**
- `application`: {id, slug}
- `application_variant`: {id, slug}
- `application_revision`: {id, slug, version}

---

### Path 6: Annotations Service Direct

**Scenario**: Evaluator revision is annotated directly (feedback, human review, etc.).

**Entry Point**: `AnnotationsService.create()`
  - Input: evaluator refs

**Reference Enrichment Flow**:
1. `EvaluatorsService.retrieve_evaluator_revision()` → enriches evaluator, evaluator_variant, evaluator_revision
   - Creates simple evaluator if none provided

**Expected References**:
- `evaluator`: {id, slug}
- `evaluator_variant`: {id, slug}
- `evaluator_revision`: {id, slug, version}
- **NO environment references**
- **NO testcase reference**

---

## Test Cases

### Test 1: Batch Evaluation - Application Invocation (Testset + Application)

```python
@pytest.mark.asyncio
async def test_batch_evaluation_application_invocation_enrichment(
    db, evaluations_service, testsets_service, applications_service
):
    """Test that batch evaluation with application invocation enriches all references correctly.
    
    Path: testset + testset_variant + testset_revision + application + application_variant + application_revision + testcase
    
    Expected: All 7 references present with correct enrichment (id+slug for variants/entities, id+slug+version for revisions, id-only for testcase)
    """
    # Setup: Create testset with revision
    testset = await testsets_service.create_testset(
        project_id=project_id,
        user_id=user_id,
        testset_create=TestsetCreate(slug="test-set", name="Test Set"),
    )
    testset_variant = await testsets_service.create_testset_variant(
        project_id=project_id,
        user_id=user_id,
        testset_id=testset.id,
        variant_create=VariantCreate(slug="v1"),
    )
    testset_revision = await testsets_service.commit_testset_revision(
        project_id=project_id,
        user_id=user_id,
        testset_id=testset.id,
        variant_id=testset_variant.id,
        data={"rows": [{"input": "hello"}]},
    )
    
    # Setup: Create testcase
    testcase = await testsets_service.create_testcase(
        project_id=project_id,
        testset_revision_id=testset_revision.id,
        testcase_create=TestcaseCreate(inputs={"input": "hello"}),
    )
    
    # Setup: Create application with revision
    application = await applications_service.create_application(
        project_id=project_id,
        user_id=user_id,
        application_create=ApplicationCreate(slug="app", name="App"),
    )
    app_variant = await applications_service.create_application_variant(
        project_id=project_id,
        user_id=user_id,
        application_id=application.id,
        variant_create=VariantCreate(slug="v1"),
    )
    app_revision = await applications_service.commit_application_revision(
        project_id=project_id,
        user_id=user_id,
        application_id=application.id,
        variant_id=app_variant.id,
        data={"nodes": [{"id": "node1", "type": "llm"}]},
    )
    
    # Execute: Create simple evaluation (batch)
    evaluation = await evaluations_service.create_simple_evaluation(
        project_id=project_id,
        user_id=user_id,
        simple_eval_create=SimpleEvaluationCreate(
            flags=SimpleEvaluationFlags(has_testsets=True, has_applications=True),
            data=SimpleEvaluationData(
                testset_steps=[testset_revision.id],
                application_steps=[app_revision.id],
            ),
        ),
    )
    
    # Fetch the run to inspect enriched references
    run = await evaluations_service.fetch_evaluation_run(
        project_id=project_id,
        run_id=evaluation.run_id,
    )
    
    # Assert: Check testset step references
    testset_step = next(
        (s for s in run.data.steps if s.key == "testset"), None
    )
    assert testset_step is not None
    assert testset_step.references["testset"]["id"] == testset.id
    assert testset_step.references["testset"]["slug"] == testset.slug
    # NO version on entity
    assert "version" not in testset_step.references["testset"]
    
    assert testset_step.references["testset_variant"]["id"] == testset_variant.id
    assert testset_step.references["testset_variant"]["slug"] == testset_variant.slug
    # NO version on variant
    assert "version" not in testset_step.references["testset_variant"]
    
    assert testset_step.references["testset_revision"]["id"] == testset_revision.id
    assert testset_step.references["testset_revision"]["slug"] == testset_revision.slug
    assert testset_step.references["testset_revision"]["version"] == testset_revision.version
    
    assert testset_step.references["testcase"]["id"] == testcase.id
    # testcase is id-only, NO slug or version
    assert "slug" not in testset_step.references["testcase"]
    assert "version" not in testset_step.references["testcase"]
    
    # Assert: Check application step references
    app_step = next(
        (s for s in run.data.steps if s.key == "application"), None
    )
    assert app_step is not None
    assert app_step.references["application"]["id"] == application.id
    assert app_step.references["application"]["slug"] == application.slug
    assert "version" not in app_step.references["application"]
    
    assert app_step.references["application_variant"]["id"] == app_variant.id
    assert app_step.references["application_variant"]["slug"] == app_variant.slug
    assert "version" not in app_step.references["application_variant"]
    
    assert app_step.references["application_revision"]["id"] == app_revision.id
    assert app_step.references["application_revision"]["slug"] == app_revision.slug
    assert app_step.references["application_revision"]["version"] == app_revision.version
```

---

### Test 2: Batch Evaluation - Evaluator Invocation (Testset + Evaluator)

```python
@pytest.mark.asyncio
async def test_batch_evaluation_evaluator_invocation_enrichment(
    db, evaluations_service, testsets_service, evaluators_service
):
    """Test that batch evaluation with evaluator invocation enriches testset and evaluator refs.
    
    Path: testset + testset_variant + testset_revision + evaluator + evaluator_variant + evaluator_revision + testcase
    """
    # Setup: Create testset (same as Path 1)
    testset = await testsets_service.create_testset(...)
    testset_variant = await testsets_service.create_testset_variant(...)
    testset_revision = await testsets_service.commit_testset_revision(...)
    testcase = await testsets_service.create_testcase(...)
    
    # Setup: Create evaluator with revision
    evaluator = await evaluators_service.create_evaluator(
        project_id=project_id,
        user_id=user_id,
        evaluator_create=EvaluatorCreate(slug="eval", name="Evaluator"),
    )
    eval_variant = await evaluators_service.create_evaluator_variant(
        project_id=project_id,
        user_id=user_id,
        evaluator_id=evaluator.id,
        variant_create=VariantCreate(slug="v1"),
    )
    eval_revision = await evaluators_service.commit_evaluator_revision(
        project_id=project_id,
        user_id=user_id,
        evaluator_id=evaluator.id,
        variant_id=eval_variant.id,
        data={"code": "def evaluate(): pass"},
    )
    
    # Execute: Create simple evaluation (batch with evaluators)
    evaluation = await evaluations_service.create_simple_evaluation(
        project_id=project_id,
        user_id=user_id,
        simple_eval_create=SimpleEvaluationCreate(
            flags=SimpleEvaluationFlags(has_testsets=True, has_evaluators=True),
            data=SimpleEvaluationData(
                testset_steps=[testset_revision.id],
                evaluator_steps={eval_revision.id: "human"},  # human origin
            ),
        ),
    )
    
    run = await evaluations_service.fetch_evaluation_run(
        project_id=project_id,
        run_id=evaluation.run_id,
    )
    
    # Assert: Evaluator step references enriched
    eval_step = next(
        (s for s in run.data.steps if s.key == "evaluator"), None
    )
    assert eval_step is not None
    assert eval_step.references["evaluator"]["id"] == evaluator.id
    assert eval_step.references["evaluator"]["slug"] == evaluator.slug
    assert eval_step.references["evaluator_variant"]["id"] == eval_variant.id
    assert eval_step.references["evaluator_variant"]["slug"] == eval_variant.slug
    assert eval_step.references["evaluator_revision"]["id"] == eval_revision.id
    assert eval_step.references["evaluator_revision"]["slug"] == eval_revision.slug
    assert eval_step.references["evaluator_revision"]["version"] == eval_revision.version
```

---

### Test 3: Live Evaluation - Evaluator Invocation (Query + Evaluator)

```python
@pytest.mark.asyncio
async def test_live_evaluation_evaluator_invocation_enrichment(
    db, evaluations_service, queries_service, evaluators_service
):
    """Test that live evaluation with evaluators enriches query and evaluator refs.
    
    Path: query + query_variant + query_revision + evaluator + evaluator_variant + evaluator_revision
    
    Note: NO testcase reference (live queries fetch from invocation traces)
    """
    # Setup: Create query with revision
    query = await queries_service.create_query(
        project_id=project_id,
        user_id=user_id,
        query_create=QueryCreate(slug="q1", name="Query 1"),
    )
    query_variant = await queries_service.create_query_variant(
        project_id=project_id,
        user_id=user_id,
        query_id=query.id,
        variant_create=VariantCreate(slug="v1"),
    )
    query_revision = await queries_service.commit_query_revision(
        project_id=project_id,
        user_id=user_id,
        query_id=query.id,
        variant_id=query_variant.id,
        data={"type": "invocation", "filtering": {...}},
    )
    
    # Setup: Create evaluator
    evaluator = await evaluators_service.create_evaluator(...)
    eval_variant = await evaluators_service.create_evaluator_variant(...)
    eval_revision = await evaluators_service.commit_evaluator_revision(...)
    
    # Execute: Create simple evaluation (live)
    evaluation = await evaluations_service.create_simple_evaluation(
        project_id=project_id,
        user_id=user_id,
        simple_eval_create=SimpleEvaluationCreate(
            flags=SimpleEvaluationFlags(is_live=True, has_evaluators=True),
            data=SimpleEvaluationData(
                query_steps=[query_revision.id],
                evaluator_steps=[eval_revision.id],
            ),
        ),
    )
    
    run = await evaluations_service.fetch_evaluation_run(
        project_id=project_id,
        run_id=evaluation.run_id,
    )
    
    # Assert: Query step references enriched
    query_step = next(
        (s for s in run.data.steps if s.key == "query"), None
    )
    assert query_step is not None
    assert query_step.references["query"]["id"] == query.id
    assert query_step.references["query"]["slug"] == query.slug
    assert query_step.references["query_variant"]["id"] == query_variant.id
    assert query_step.references["query_revision"]["id"] == query_revision.id
    assert query_step.references["query_revision"]["version"] == query_revision.version
    
    # Assert: NO testcase reference in live query step
    assert "testcase" not in query_step.references
    
    # Assert: Evaluator step references enriched
    eval_step = next(
        (s for s in run.data.steps if s.key == "evaluator"), None
    )
    assert eval_step.references["evaluator"]["id"] == evaluator.id
    assert eval_step.references["evaluator_revision"]["version"] == eval_revision.version
```

---

### Test 4: Invocations Service Direct (No Environment)

```python
@pytest.mark.asyncio
async def test_invocations_service_direct_enrichment(
    db, invocations_service, applications_service
):
    """Test that invocation service enriches application refs without environment.
    
    Path: application + application_variant + application_revision
    
    Note: NO environment, NO environment_variant, NO environment_revision, NO selector
    """
    # Setup: Create application
    application = await applications_service.create_application(...)
    app_variant = await applications_service.create_application_variant(...)
    app_revision = await applications_service.commit_application_revision(...)
    
    # Execute: Create invocation (direct, no environment)
    invocation = await invocations_service.create(
        organization_id=organization_id,
        project_id=project_id,
        user_id=user_id,
        invocation_create=InvocationCreate(
            references=InvocationReferences(
                application=Reference(id=application.id),
                application_variant=Reference(id=app_variant.id),
                application_revision=Reference(id=app_revision.id),
            ),
            data={"input": "test"},
        ),
    )
    
    # Assert: Invocation references enriched with id+slug for variants/entities, id+slug+version for revision
    assert invocation.references.application.id == application.id
    assert invocation.references.application.slug == application.slug
    assert "version" not in invocation.references.application
    
    assert invocation.references.application_variant.id == app_variant.id
    assert invocation.references.application_variant.slug == app_variant.slug
    
    assert invocation.references.application_revision.id == app_revision.id
    assert invocation.references.application_revision.slug == app_revision.slug
    assert invocation.references.application_revision.version == app_revision.version
    
    # Assert: NO environment references
    assert "environment" not in invocation.references or invocation.references.environment is None
    assert "selector" not in invocation.references or invocation.references.selector is None
```

---

### Test 5: Invocations Service with Environment Backing

```python
@pytest.mark.asyncio
async def test_invocations_service_environment_backed_enrichment(
    db, invocations_service, environments_service, applications_service
):
    """Test that invocation service enriches environment + application refs.
    
    Path: environment + environment_variant + environment_revision + selector + application + application_variant + application_revision
    
    Note: selector carries the {key: str} used to look up target in environment's references
    """
    # Setup: Create target application
    target_app = await applications_service.create_application(...)
    target_app_variant = await applications_service.create_application_variant(...)
    target_app_revision = await applications_service.commit_application_revision(...)
    
    # Setup: Create environment with selector mapping to target app
    environment = await environments_service.create_environment(...)
    env_variant = await environments_service.create_environment_variant(...)
    env_revision = await environments_service.commit_environment_revision(
        project_id=project_id,
        user_id=user_id,
        environment_id=environment.id,
        variant_id=env_variant.id,
        data={
            "references": {
                "production": {
                    "application": Reference(id=target_app.id, slug=target_app.slug),
                    "application_variant": Reference(id=target_app_variant.id, slug=target_app_variant.slug),
                    "application_revision": Reference(id=target_app_revision.id, slug=target_app_revision.slug),
                }
            }
        },
    )
    
    # Execute: Create invocation (environment-backed)
    invocation = await invocations_service.create(
        organization_id=organization_id,
        project_id=project_id,
        user_id=user_id,
        invocation_create=InvocationCreate(
            references=InvocationReferences(
                environment=Reference(id=environment.id),
                environment_variant=Reference(id=env_variant.id),
                environment_revision=Reference(id=env_revision.id),
                selector={"key": "production"},  # selector key
            ),
            data={"input": "test"},
        ),
    )
    
    # Assert: Environment references enriched
    assert invocation.references.environment.id == environment.id
    assert invocation.references.environment.slug == environment.slug
    assert "version" not in invocation.references.environment
    
    assert invocation.references.environment_variant.id == env_variant.id
    assert invocation.references.environment_variant.slug == env_variant.slug
    
    assert invocation.references.environment_revision.id == env_revision.id
    assert invocation.references.environment_revision.slug == env_revision.slug
    assert invocation.references.environment_revision.version == env_revision.version
    
    # Assert: Selector populated
    assert invocation.references.selector == {"key": "production"}
    
    # Assert: Target application references enriched (resolved from environment)
    assert invocation.references.application.id == target_app.id
    assert invocation.references.application.slug == target_app.slug
    
    assert invocation.references.application_variant.id == target_app_variant.id
    assert invocation.references.application_variant.slug == target_app_variant.slug
    
    assert invocation.references.application_revision.id == target_app_revision.id
    assert invocation.references.application_revision.slug == target_app_revision.slug
    assert invocation.references.application_revision.version == target_app_revision.version
```

---

### Test 6: Annotations Service Direct

```python
@pytest.mark.asyncio
async def test_annotations_service_direct_enrichment(
    db, annotations_service, evaluators_service
):
    """Test that annotations service enriches evaluator refs.
    
    Path: evaluator + evaluator_variant + evaluator_revision
    
    Note: NO testcase, NO environment, NO selector
    """
    # Setup: Create evaluator
    evaluator = await evaluators_service.create_evaluator(...)
    eval_variant = await evaluators_service.create_evaluator_variant(...)
    eval_revision = await evaluators_service.commit_evaluator_revision(...)
    
    # Execute: Create annotation (feedback/review)
    annotation = await annotations_service.create(
        organization_id=organization_id,
        project_id=project_id,
        user_id=user_id,
        annotation_create=AnnotationCreate(
            references=AnnotationReferences(
                evaluator=Reference(id=evaluator.id),
                evaluator_variant=Reference(id=eval_variant.id),
                evaluator_revision=Reference(id=eval_revision.id),
            ),
            origin=AnnotationOrigin.HUMAN,
            data={"score": 5},
        ),
    )
    
    # Assert: Evaluator references enriched
    assert annotation.references.evaluator.id == evaluator.id
    assert annotation.references.evaluator.slug == evaluator.slug
    
    assert annotation.references.evaluator_variant.id == eval_variant.id
    assert annotation.references.evaluator_variant.slug == eval_variant.slug
    
    assert annotation.references.evaluator_revision.id == eval_revision.id
    assert annotation.references.evaluator_revision.slug == eval_revision.slug
    assert annotation.references.evaluator_revision.version == eval_revision.version
    
    # Assert: NO testcase, environment, selector
    assert "testcase" not in annotation.references or annotation.references.testcase is None
    assert "environment" not in annotation.references or annotation.references.environment is None
    assert "selector" not in annotation.references or annotation.references.selector is None
```

---

## Test Fixtures & Setup

Each test should use a shared fixture setup:

```python
@pytest.fixture
async def project_and_user(db):
    """Create a test organization, project, and user."""
    organization = await create_organization(db, slug="test-org")
    project = await create_project(db, org_id=organization.id, slug="test-proj")
    user = await create_user(db, email="test@example.com")
    return organization.id, project.id, user.id

@pytest.fixture
async def services(db, project_and_user):
    """Wire up all required services with DI."""
    org_id, proj_id, user_id = project_and_user
    
    workflows_service = WorkflowsService(workflows_dao=workflows_dao)
    applications_service = ApplicationsService(workflows_service=workflows_service)
    evaluators_service = EvaluatorsService(workflows_service=workflows_service)
    queries_service = QueriesService(queries_dao=queries_dao)
    testsets_service = TestsetsService(testsets_dao=testsets_dao)
    environments_service = EnvironmentsService(environments_dao=environments_dao)
    tracing_service = TracingService(tracing_dao=tracing_dao)
    
    invocations_service = InvocationsService(
        applications_service=applications_service,
        simple_applications_service=simple_apps_service,
        tracing_service=tracing_service,
    )
    
    annotations_service = AnnotationsService(
        evaluators_service=evaluators_service,
        simple_evaluators_service=simple_evals_service,
        tracing_service=tracing_service,
    )
    
    evaluations_service = EvaluationsService(
        evaluations_dao=evaluations_dao,
        tracing_service=tracing_service,
        queries_service=queries_service,
        testsets_service=testsets_service,
        evaluators_service=evaluators_service,
    )
    
    return {
        "project_id": proj_id,
        "user_id": user_id,
        "org_id": org_id,
        "applications": applications_service,
        "evaluators": evaluators_service,
        "queries": queries_service,
        "testsets": testsets_service,
        "environments": environments_service,
        "invocations": invocations_service,
        "annotations": annotations_service,
        "evaluations": evaluations_service,
    }
```

---

## Validation Checklist

For each test:

- [ ] All expected reference keys present in the references dict
- [ ] Entity references (application, evaluator, testset, query) have {id, slug} only (no version)
- [ ] Variant references (application_variant, evaluator_variant, etc.) have {id, slug} only (no version)
- [ ] Revision references have {id, slug, version}
- [ ] Testcase references are {id} only (no slug, no version)
- [ ] Selector keys are present when environment backing is used
- [ ] Environment references enriched when environment backing is used
- [ ] Environment references absent when direct (non-environment) path is used
- [ ] All IDs match the created entities
- [ ] All slugs match the created entities
- [ ] All versions match the created revisions

---

## Notes

1. **RetrievalInfo Pattern**: The applications/evaluators services return `RetrievalInfo` which carries both the direct references (application, variant, revision) and optional environment references. This pattern is reused in Path 5.

2. **Testcase ID-Only**: Testcases are referenced by ID only because they are variants of a specific testset revision — their full lineage is available via the testset_revision reference.

3. **Selector Key**: The `selector` is always a dict with a single "key" entry — it indicates which field in the environment's references map was used to select the target (e.g., "production", "staging").

4. **Origin Tagging**: In Path 2 and Path 3, evaluators can have origin tags ("human", "auto", "custom") in the step definition, but these are separate from the reference enrichment and should be tested independently.
