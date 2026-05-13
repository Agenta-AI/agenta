# Evaluation System - Refactoring Analysis

**Created:** 2026-02-16
**Purpose:** Detailed analysis of current code and concrete refactoring steps
**Related:**
- [Current State - Iteration Patterns](./iteration-patterns.md)
- [Desired Architecture](./desired-architecture.md)

---

## Table of Contents

- [Side-by-Side Code Comparison](#side-by-side-code-comparison)
- [Common Patterns to Extract](#common-patterns-to-extract)
- [Divergences to Reconcile](#divergences-to-reconcile)
- [Concrete Refactoring Steps](#concrete-refactoring-steps)
- [Pure Functions to Extract](#pure-functions-to-extract)
- [Adapters to Implement](#adapters-to-implement)
- [Testing Strategy](#testing-strategy)

---

## Side-by-Side Code Comparison

### Loop Structure Comparison

#### SDK: `sdk/agenta/sdk/evaluations/preview/evaluate.py` (Lines 377-724)

```python
for testset_revision in testset_revisions.values():                    # Line 377
    testcases = testset_revision.data.testcases

    for testcase_idx, testcase in enumerate(testcases):                # Line 392
        # ────────────────────────────────────────────────────────────
        # 1. CREATE SCENARIO
        # ────────────────────────────────────────────────────────────
        scenario = await aadd_scenario(                                 # Line 412
            run_id=run.id,
        )

        results = dict()

        # ────────────────────────────────────────────────────────────
        # 2. LOG TESTCASE RESULT
        # ────────────────────────────────────────────────────────────
        result = await alog_result(                                     # Line 427
            run_id=run.id,
            scenario_id=scenario.id,
            step_key="testset-" + testset_revision.slug,
            testcase_id=testcase.id,
        )
        results[testset_revision.slug] = result

        inputs = testcase.data

        # ────────────────────────────────────────────────────────────
        # 3. FOR EACH APPLICATION
        # ────────────────────────────────────────────────────────────
        for application_revision in application_revisions.values():     # Line 454
            # Build request
            references = dict(                                          # Lines 463-486
                testset=Reference(id=testset_revision.testset_id),
                testset_variant=Reference(id=testset_revision.testset_variant_id),
                testset_revision=Reference(id=testset_revision.id, ...),
                application=Reference(id=application_revision.application_id),
                application_variant=Reference(id=application_revision.application_variant_id),
                application_revision=Reference(id=application_revision.id, ...),
            )

            interface = WorkflowServiceInterface(...)                   # Lines 493-506
            configuration = WorkflowServiceConfiguration(...)
            parameters = application_revision.data.parameters

            workflow_service_request_data = WorkflowServiceRequestData( # Lines 512-521
                revision=_revision,
                parameters=parameters,
                testcase=_testcase,
                inputs=inputs,
                trace=None,
                outputs=None,
            )

            application_request = ApplicationServiceRequest(            # Lines 523-531
                interface=interface,
                configuration=configuration,
                data=workflow_service_request_data,
                references=references,
                links=None,
            )

            # Invoke application
            application_response = await invoke_application(            # Line 533
                request=application_request,
            )

            trace_id = application_response.trace_id                    # Line 547

            # Fetch trace (with polling)
            trace = fetch_trace_data(                                   # Line 558
                trace_id,
                max_retries=30,
                delay=1.0,
            )

            # Log result
            result = await alog_result(                                 # Line 560
                run_id=run.id,
                scenario_id=scenario.id,
                step_key="application-" + application_slug,
                trace_id=trace_id,
            )
            results[application_slug] = result

            # Extract outputs from trace
            trace = await trace                                         # Line 578
            root_span = list(trace.get("spans", {}).values())[0]       # Line 584
            outputs = root_span.get("attributes", {})                   # Lines 585-588
                                .get("ag", {})
                                .get("data", {})
                                .get("outputs")

            # ────────────────────────────────────────────────────────
            # 4. FOR EACH EVALUATOR
            # ────────────────────────────────────────────────────────
            for evaluator_revision in evaluator_revisions.values():     # Line 591
                # Build request
                references = dict(                                      # Lines 598-621
                    testset=Reference(id=testset_revision.testset_id),
                    ...,
                    evaluator=Reference(id=evaluator_revision.evaluator_id),
                    evaluator_variant=Reference(id=evaluator_revision.evaluator_variant_id),
                    evaluator_revision=Reference(id=evaluator_revision.id, ...),
                )
                links = dict(                                           # Lines 622-632
                    invocation=Link(
                        trace_id=application_response.trace_id,
                        span_id=application_response.span_id,
                    )
                )

                interface = WorkflowServiceInterface(...)               # Lines 638-651
                configuration = WorkflowServiceConfiguration(...)
                parameters = evaluator_revision.data.parameters

                workflow_service_request_data = WorkflowServiceRequestData(  # Lines 654-663
                    revision=_revision,
                    parameters=parameters,
                    testcase=_testcase,
                    inputs=inputs,
                    trace=trace,              # From application
                    outputs=outputs,          # From application
                )

                evaluator_request = EvaluatorServiceRequest(            # Lines 665-675
                    version="2025.07.14",
                    interface=interface,
                    configuration=configuration,
                    data=workflow_service_request_data,
                    references=references,
                    links=links,
                )

                # Invoke evaluator
                evaluator_response = await invoke_evaluator(            # Line 677
                    request=evaluator_request,
                    annotate=True,
                )

                trace_id = evaluator_response.trace_id                  # Line 693

                # Fetch trace (with polling)
                trace = fetch_trace_data(                               # Line 695
                    trace_id,
                    max_retries=20,
                    delay=1.0,
                )

                # Log result
                result = await alog_result(                             # Line 697
                    run_id=run.id,
                    scenario_id=scenario.id,
                    step_key="evaluator-" + evaluator_revision.slug,
                    trace_id=trace_id,
                )
                results[evaluator_revision.slug] = result

        # ────────────────────────────────────────────────────────────
        # 5. COMPUTE METRICS FOR SCENARIO
        # ────────────────────────────────────────────────────────────
        metrics = await acompute_metrics(                               # Line 721
            run_id=run.id,
            scenario_id=scenario.id,
        )

        scenarios.append({                                              # Lines 735-741
            "scenario": scenario,
            "results": results,
            "metrics": metrics,
        })
```

---

#### API Legacy: `api/oss/src/core/evaluations/tasks/legacy.py` (Lines 990-1209)

```python
# Note: Applications already invoked before this loop starts
# invocations = results from prior application execution

for idx in range(nof_testcases):                                       # Line 990
    scenario = scenarios[idx]
    testcase = testcases[idx]
    invocation = invocations[idx]      # Already executed
    invocation_step_key = invocation_steps_keys[0]

    scenario_has_errors = 0
    scenario_status = EvaluationStatus.SUCCESS

    # ────────────────────────────────────────────────────────────────
    # 1. CHECK FOR INVOCATION ERRORS
    # ────────────────────────────────────────────────────────────────
    if invocation.result.error:                                         # Line 1000
        log.error(
            f"Error in invocation {invocation.trace_id}, skipping evaluation"
        )
        scenario_has_errors += 1
        scenario_status = EvaluationStatus.ERRORS
        continue

    # ────────────────────────────────────────────────────────────────
    # 2. FETCH TRACE
    # ────────────────────────────────────────────────────────────────
    if not invocation.trace_id:                                         # Line 1015
        log.warn("invocation trace_id is missing.")
        scenario_has_errors += 1
        scenario_status = EvaluationStatus.ERRORS
        continue

    trace = await fetch_trace(                                          # Line 1023
        tracing_router=tracing_router,
        request=request,
        trace_id=invocation.trace_id,
    )

    if not trace:                                                       # Line 1029
        log.warn("Trace missing")
        scenario_has_errors += 1
        scenario_status = EvaluationStatus.ERRORS
        continue

    # ────────────────────────────────────────────────────────────────
    # 3. EXTRACT ROOT SPAN
    # ────────────────────────────────────────────────────────────────
    if not isinstance(trace.spans, dict):                               # Line 1047
        log.warn(f"Trace {invocation.trace_id} has no root spans")
        scenario_has_errors += 1
        scenario_status = EvaluationStatus.ERRORS
        continue

    root_span = list(trace.spans.values())[0]                           # Line 1055

    if isinstance(root_span, list):                                     # Line 1057
        log.warn(f"More than one root span for trace {invocation.trace_id}")
        scenario_has_errors += 1
        scenario_status = EvaluationStatus.ERRORS
        continue

    # ────────────────────────────────────────────────────────────────
    # 4. FOR EACH EVALUATOR
    # ────────────────────────────────────────────────────────────────
    for jdx in range(nof_annotations):                                  # Line 1066
        annotation_step_key = annotation_steps_keys[jdx]

        step_has_errors = 0
        step_status = EvaluationStatus.SUCCESS

        # Build references
        references: Dict[str, Any] = {                                  # Lines 1072-1077
            **evaluator_references[annotation_step_key],
            "testcase": {"id": str(testcase.id)},
            "testset": {"id": str(testset_id)},
            "testset_revision": {"id": str(testset_revision_id)},
        }
        links: Dict[str, Any] = {                                       # Lines 1078-1083
            invocation_steps_keys[0]: {
                "trace_id": invocation.trace_id,
                "span_id": invocation.span_id,
            }
        }

        # Get evaluator revision
        evaluator_revision = evaluators[annotation_step_key]            # Line 1086

        if not evaluator_revision:                                      # Line 1088
            log.error(f"Evaluator revision for {annotation_step_key} not found!")
            step_has_errors += 1
            scenario_has_errors += 1
            step_status = EvaluationStatus.FAILURE
            scenario_status = EvaluationStatus.ERRORS
            continue

        # Build request
        _revision = evaluator_revision.model_dump(...)                  # Line 1100
        interface = dict(                                               # Lines 1104-1113
            uri=evaluator_revision.data.uri,
            url=evaluator_revision.data.url,
            headers=evaluator_revision.data.headers,
            schemas=evaluator_revision.data.schemas,
        )
        configuration = dict(                                           # Lines 1114-1121
            script=evaluator_revision.data.script,
            parameters=evaluator_revision.data.parameters,
        )
        parameters = configuration.get("parameters")

        # Prepare inputs/outputs
        _testcase = testcase.model_dump(mode="json")                    # Line 1124
        inputs = testcase.data
        if isinstance(inputs, dict):                                    # Lines 1126-1128
            if "testcase_dedup_id" in inputs:
                del inputs["testcase_dedup_id"]

        _trace: Optional[dict] = (                                      # Lines 1130-1137
            trace.model_dump(mode="json", exclude_none=True)
            if trace
            else None
        )

        # Extract outputs from root span
        _root_span = root_span.model_dump(mode="json", exclude_none=True)  # Line 1139
        root_span_attributes: dict = _root_span.get("attributes") or {}    # Lines 1142-1156
        root_span_attributes_ag: dict = root_span_attributes.get("ag") or {}
        root_span_attributes_ag_data: dict = (
            root_span_attributes_ag.get("data") or {}
        )
        root_span_attributes_ag_data_outputs = (
            root_span_attributes_ag_data.get("outputs")
        )
        root_span_attributes_ag_data_inputs = (
            root_span_attributes_ag_data.get("inputs")
        )

        outputs = root_span_attributes_ag_data_outputs
        inputs = testcase_data or root_span_attributes_ag_data_inputs

        workflow_service_request_data = WorkflowServiceRequestData(     # Lines 1157-1166
            revision=_revision,
            parameters=parameters,
            testcase=_testcase,
            inputs=inputs,
            trace=_trace,
            outputs=outputs,
        )

        flags = (                                                       # Lines 1168-1176
            evaluator_revision.flags.model_dump(...)
            if evaluator_revision.flags
            else None
        )

        workflow_service_request = WorkflowServiceRequest(              # Lines 1178-1190
            version="2025.07.14",
            flags=flags,
            interface=interface,
            configuration=configuration,
            data=workflow_service_request_data,
            references=references,
            links=links,
        )

        # Invoke evaluator
        log.info("Invoking evaluator...")                               # Line 1192
        workflows_service_response = (
            await workflows_service.invoke_workflow(                    # Line 1200
                project_id=project_id,
                user_id=user_id,
                request=workflow_service_request,
                annotate=True,
            )
        )
        log.info("Invoked evaluator")                                   # Line 1209

        # Create result (continues beyond line 1209...)
```

---

#### API Live: `api/oss/src/core/evaluations/tasks/live.py` (Lines 419-674)

```python
for query_step_key in query_traces.keys():                             # Line 419
    nof_traces = len(query_traces[query_step_key].keys())

    # ────────────────────────────────────────────────────────────────
    # 1. CREATE SCENARIOS (batch)
    # ────────────────────────────────────────────────────────────────
    scenarios_create = [                                                # Lines 427-436
        EvaluationScenarioCreate(
            run_id=run_id,
            timestamp=timestamp,
            interval=interval,
            status=EvaluationStatus.RUNNING,
        )
        for _ in range(nof_traces)
    ]

    scenarios = await evaluations_service.create_scenarios(             # Line 438
        project_id=project_id,
        user_id=user_id,
        scenarios=scenarios_create,
    )

    # ────────────────────────────────────────────────────────────────
    # 2. CREATE QUERY RESULTS (batch)
    # ────────────────────────────────────────────────────────────────
    query_trace_ids = list(query_traces[query_step_key].keys())        # Line 454
    scenario_ids = [scenario.id for scenario in scenarios if scenario.id]  # Line 455

    results_create = [                                                  # Lines 457-471
        EvaluationResultCreate(
            run_id=run_id,
            scenario_id=scenario_id,
            step_key=query_step_key,
            status=EvaluationStatus.SUCCESS,
            trace_id=query_trace_id,
        )
        for scenario_id, query_trace_id in zip(scenario_ids, query_trace_ids)
    ]

    results = await evaluations_service.create_results(                 # Line 473
        project_id=project_id,
        user_id=user_id,
        results=results_create,
    )

    scenario_has_errors: Dict[int, int] = dict()
    scenario_status: Dict[int, EvaluationStatus] = dict()

    # ────────────────────────────────────────────────────────────────
    # 3. FOR EACH TRACE
    # ────────────────────────────────────────────────────────────────
    for idx, trace in enumerate(query_traces[query_step_key].values()): # Line 490
        scenario_has_errors[idx] = 0
        scenario_status[idx] = EvaluationStatus.SUCCESS

        scenario = scenarios[idx]
        scenario_id = scenario_ids[idx]
        query_trace_id = query_trace_ids[idx]

        # Validate trace structure
        if not isinstance(trace.spans, dict):                           # Line 499
            log.warn(f"Trace {query_trace_id} has no root spans")
            scenario_has_errors[idx] += 1
            scenario_status[idx] = EvaluationStatus.ERRORS
            continue

        root_span = list(trace.spans.values())[0]                       # Line 508

        if isinstance(root_span, list):                                 # Line 510
            log.warn(f"More than one root span for trace {query_trace_id}")
            scenario_has_errors[idx] += 1
            scenario_status[idx] = EvaluationStatus.ERRORS
            continue

        query_span_id = root_span.span_id                               # Line 519

        # ────────────────────────────────────────────────────────────
        # 4. FOR EACH EVALUATOR
        # ────────────────────────────────────────────────────────────
        for jdx in range(nof_annotations):                              # Line 528
            annotation_step_key = annotation_steps_keys[jdx]

            step_has_errors = 0
            step_status = EvaluationStatus.SUCCESS

            # Build references
            references: Dict[str, Any] = {                              # Lines 534-536
                **evaluator_references[annotation_step_key],
            }
            links: Dict[str, Any] = {                                   # Lines 537-542
                query_step_key: dict(
                    trace_id=query_trace_id,
                    span_id=query_span_id,
                )
            }

            # Get evaluator revision
            evaluator_revision = evaluator_revisions[annotation_step_key]  # Line 545

            if not evaluator_revision:                                  # Line 547
                log.error(f"Evaluator revision for {annotation_step_key} not found!")
                step_has_errors += 1
                scenario_has_errors[idx] += 1
                step_status = EvaluationStatus.FAILURE
                scenario_status[idx] = EvaluationStatus.ERRORS
                continue

            # Build request
            _revision = evaluator_revision.model_dump(...)              # Line 559
            interface = dict(                                           # Lines 563-572
                uri=evaluator_revision.data.uri,
                url=evaluator_revision.data.url,
                headers=evaluator_revision.data.headers,
                schemas=evaluator_revision.data.schemas,
            )
            configuration = dict(                                       # Lines 573-580
                script=evaluator_revision.data.script,
                parameters=evaluator_revision.data.parameters,
            )
            parameters = configuration.get("parameters")

            # Live evaluation has no testcase
            _testcase = None                                            # Line 583
            inputs = None                                               # Line 584

            _trace: Optional[dict] = (                                  # Lines 586-593
                trace.model_dump(mode="json", exclude_none=True)
                if trace
                else None
            )

            # Extract outputs from root span
            _root_span = root_span.model_dump(mode="json", exclude_none=True)  # Line 595
            testcase_data = None                                        # Line 596

            root_span_attributes: dict = _root_span.get("attributes") or {}    # Lines 598-612
            root_span_attributes_ag: dict = root_span_attributes.get("ag") or {}
            root_span_attributes_ag_data: dict = (
                root_span_attributes_ag.get("data") or {}
            )
            root_span_attributes_ag_data_outputs = (
                root_span_attributes_ag_data.get("outputs")
            )
            root_span_attributes_ag_data_inputs = (
                root_span_attributes_ag_data.get("inputs")
            )

            outputs = root_span_attributes_ag_data_outputs
            inputs = testcase_data or root_span_attributes_ag_data_inputs

            workflow_service_request_data = WorkflowServiceRequestData( # Lines 613-622
                revision=_revision,
                parameters=parameters,
                testcase=_testcase,
                inputs=inputs,
                trace=_trace,
                outputs=outputs,
            )

            flags = (                                                   # Lines 624-632
                evaluator_revision.flags.model_dump(...)
                if evaluator_revision.flags
                else None
            )

            workflow_service_request = WorkflowServiceRequest(          # Lines 634-646
                version="2025.07.14",
                flags=flags,
                interface=interface,
                configuration=configuration,
                data=workflow_service_request_data,
                references=references,
                links=links,
            )

            # Invoke evaluator
            log.info("Invoking evaluator...")                           # Line 648
            workflows_service_response = (
                await workflows_service.invoke_workflow(                # Line 654
                    project_id=project_id,
                    user_id=user_id,
                    request=workflow_service_request,
                    annotate=True,
                )
            )
            log.info("Invoked evaluator")                               # Line 664

            # Create result (continues beyond line 674...)
```

---

## Common Patterns to Extract

### Pattern 1: Build Evaluator Request

**Appears in:**
- SDK: Lines 598-675
- API Legacy: Lines 1072-1190
- API Live: Lines 534-646

**Common logic:**
1. Get evaluator revision
2. Extract interface (uri, url, headers, schemas)
3. Extract configuration (script, parameters)
4. Build references dict
5. Build links dict (to prior step trace)
6. Prepare testcase, inputs, trace, outputs
7. Build `WorkflowServiceRequestData`
8. Build `WorkflowServiceRequest` with flags

**Can be extracted to:**
```python
def build_evaluator_request(
    evaluator_revision: EvaluatorRevision,
    *,
    testcase: Optional[Testcase] = None,
    inputs: Optional[dict] = None,
    trace: Optional[Trace] = None,
    outputs: Optional[dict] = None,
    references: dict,
    links: dict,
) -> WorkflowServiceRequest:
    """
    Build evaluator invocation request.

    Pure function - no I/O.
    """
    _revision = evaluator_revision.model_dump(mode="json", exclude_none=True)

    interface = dict(
        uri=evaluator_revision.data.uri,
        url=evaluator_revision.data.url,
        headers=evaluator_revision.data.headers,
        schemas=evaluator_revision.data.schemas,
    ) if evaluator_revision.data else dict()

    configuration = dict(
        script=evaluator_revision.data.script,
        parameters=evaluator_revision.data.parameters,
    ) if evaluator_revision.data else dict()

    parameters = configuration.get("parameters")

    _testcase = testcase.model_dump(mode="json") if testcase else None
    _trace = trace.model_dump(mode="json", exclude_none=True) if trace else None

    workflow_service_request_data = WorkflowServiceRequestData(
        revision=_revision,
        parameters=parameters,
        testcase=_testcase,
        inputs=inputs,
        trace=_trace,
        outputs=outputs,
    )

    flags = (
        evaluator_revision.flags.model_dump(
            mode="json",
            exclude_none=True,
            exclude_unset=True,
        )
        if evaluator_revision.flags
        else None
    )

    return WorkflowServiceRequest(
        version="2025.07.14",
        flags=flags,
        interface=interface,
        configuration=configuration,
        data=workflow_service_request_data,
        references=references,
        links=links,
    )
```

---

### Pattern 2: Extract Outputs from Trace

**Appears in:**
- SDK: Lines 584-588
- API Legacy: Lines 1139-1156
- API Live: Lines 595-612

**Common logic:**
1. Get root span from trace
2. Navigate: `attributes` → `ag` → `data` → `outputs`
3. Also extract `inputs` as fallback

**Can be extracted to:**
```python
def extract_trace_outputs(
    trace: Trace,
) -> Tuple[Optional[dict], Optional[dict]]:
    """
    Extract inputs and outputs from trace root span.

    Pure function - no I/O.

    Returns:
        (inputs, outputs) tuple
    """
    if not trace or not isinstance(trace.spans, dict):
        return None, None

    root_span = list(trace.spans.values())[0]

    if isinstance(root_span, list):
        return None, None

    root_span_attributes: dict = root_span.attributes or {}
    root_span_attributes_ag: dict = root_span_attributes.get("ag") or {}
    root_span_attributes_ag_data: dict = root_span_attributes_ag.get("data") or {}

    outputs = root_span_attributes_ag_data.get("outputs")
    inputs = root_span_attributes_ag_data.get("inputs")

    return inputs, outputs
```

---

### Pattern 3: Build Application Request

**Appears in:**
- SDK: Lines 463-531
- (API doesn't build app requests - apps are invoked separately)

**Common logic:**
1. Build references dict
2. Extract interface, configuration, parameters
3. Build `WorkflowServiceRequestData`
4. Build `ApplicationServiceRequest`

**Can be extracted to:**
```python
def build_application_request(
    application_revision: ApplicationRevision,
    *,
    testcase: Testcase,
    inputs: dict,
    references: dict,
) -> ApplicationServiceRequest:
    """
    Build application invocation request.

    Pure function - no I/O.
    """
    _revision = application_revision.model_dump(mode="json", exclude_none=True)

    interface = WorkflowServiceInterface(
        **(application_revision.data.model_dump() if application_revision.data else {})
    )

    configuration = WorkflowServiceConfiguration(
        **(application_revision.data.model_dump() if application_revision.data else {})
    )

    parameters = application_revision.data.parameters

    _testcase = testcase.model_dump(mode="json", exclude_none=True)

    workflow_service_request_data = WorkflowServiceRequestData(
        revision=_revision,
        parameters=parameters,
        testcase=_testcase,
        inputs=inputs,
        trace=None,
        outputs=None,
    )

    return ApplicationServiceRequest(
        interface=interface,
        configuration=configuration,
        data=workflow_service_request_data,
        references=references,
        links=None,
    )
```

---

### Pattern 4: Validate Trace Structure

**Appears in:**
- API Legacy: Lines 1047-1063
- API Live: Lines 499-517

**Common logic:**
1. Check if `trace.spans` is a dict
2. Extract root span (first value)
3. Check if root span is not a list (single root)

**Can be extracted to:**
```python
def validate_trace_structure(
    trace: Trace,
) -> Tuple[bool, Optional[Span], Optional[str]]:
    """
    Validate trace structure and extract root span.

    Pure function - no I/O.

    Returns:
        (is_valid, root_span, error_message) tuple
    """
    if not isinstance(trace.spans, dict):
        return False, None, "Trace has no root spans"

    if not trace.spans:
        return False, None, "Trace spans dict is empty"

    root_span = list(trace.spans.values())[0]

    if isinstance(root_span, list):
        return False, None, "More than one root span"

    return True, root_span, None
```

---

## Divergences to Reconcile

### Divergence 1: Iteration by Object vs Index

**SDK:**
```python
for testcase in testcases:          # Iterates by object
    ...
```

**API:**
```python
for idx in range(nof_testcases):    # Iterates by index
    testcase = testcases[idx]
    ...
```

**Resolution:**
- **Adopt SDK pattern** (iterate by object)
- More Pythonic, easier to read
- Avoids index bugs
- Supports filtering/slicing better

**Refactoring:**
```python
# Before (API)
for idx in range(nof_testcases):
    scenario = scenarios[idx]
    testcase = testcases[idx]
    invocation = invocations[idx]

# After (unified)
for testcase, scenario, invocation in zip(testcases, scenarios, invocations):
    # or
for idx, (testcase, scenario, invocation) in enumerate(zip(...)):
    # if idx is needed for logging
```

---

### Divergence 2: Trace Fetching

**SDK:**
```python
# Fetches trace with polling/retries
trace = fetch_trace_data(trace_id, max_retries=30, delay=1.0)
# Returns a coroutine/Future
trace = await trace
```

**API:**
```python
# Fetches trace via service
trace = await fetch_trace(
    tracing_router=tracing_router,
    request=request,
    trace_id=trace_id,
)
```

**Resolution:**
- **Define port** for trace fetching
- SDK adapter polls external API
- Backend adapter queries tracing service directly

**Port:**
```python
class TraceFetcher(Protocol):
    async def fetch(self, trace_id: UUID) -> Optional[Trace]:
        """Fetch trace by ID."""
        ...
```

**SDK Adapter:**
```python
class PollingTraceFetcher:
    async def fetch(self, trace_id: UUID) -> Optional[Trace]:
        return await fetch_trace_data(trace_id, max_retries=30, delay=1.0)
```

**Backend Adapter:**
```python
class ServiceTraceFetcher:
    def __init__(self, tracing_router, request):
        self.tracing_router = tracing_router
        self.request = request

    async def fetch(self, trace_id: UUID) -> Optional[Trace]:
        return await fetch_trace(
            tracing_router=self.tracing_router,
            request=self.request,
            trace_id=trace_id,
        )
```

---

### Divergence 3: Persistence

**SDK:**
```python
# Calls remote API
scenario = await aadd_scenario(run_id=run.id)
result = await alog_result(run_id, scenario_id, step_key, trace_id)
metrics = await acompute_metrics(run_id, scenario_id)
```

**API:**
```python
# Calls DAO/service directly
scenarios = await evaluations_service.create_scenarios(...)
results = await evaluations_service.create_results(...)
```

**Resolution:**
- **Define port** for persistence (see desired-architecture.md)
- SDK uses `RemoteAPIPersistence`
- Backend uses `DAOPersistence`

**Example:**
```python
# Port
class EvaluationPersistence(Protocol):
    async def create_scenario(self, run_id: UUID) -> Scenario: ...
    async def create_result(self, result: ResultCreate) -> EvaluationResult: ...
    async def compute_metrics(self, run_id: UUID, scenario_id: UUID) -> Metrics: ...

# SDK Adapter
class RemoteAPIPersistence:
    async def create_scenario(self, run_id: UUID) -> Scenario:
        return await aadd_scenario(run_id=run_id)

    async def create_result(self, result: ResultCreate) -> EvaluationResult:
        return await alog_result(
            run_id=result.run_id,
            scenario_id=result.scenario_id,
            step_key=result.step_key,
            trace_id=result.trace_id,
        )

# Backend Adapter
class DAOPersistence:
    def __init__(self, evaluations_service):
        self.service = evaluations_service

    async def create_scenario(self, run_id: UUID) -> Scenario:
        scenarios = await self.service.create_scenarios(
            scenarios=[EvaluationScenarioCreate(run_id=run_id)]
        )
        return scenarios[0]

    async def create_result(self, result: ResultCreate) -> EvaluationResult:
        results = await self.service.create_results(results=[result])
        return results[0]
```

---

### Divergence 4: Batch vs Individual Operations

**SDK:**
```python
# Creates scenarios one at a time
for testcase in testcases:
    scenario = await aadd_scenario(run_id=run.id)  # Individual
    ...
```

**API Live:**
```python
# Creates scenarios in batch
scenarios_create = [
    EvaluationScenarioCreate(...)
    for _ in range(nof_traces)
]
scenarios = await evaluations_service.create_scenarios(scenarios=scenarios_create)
```

**Resolution:**
- **Support both** in persistence port
- Individual: `create_scenario(run_id)`
- Batch: `create_scenarios(scenarios: list[ScenarioCreate])`
- Adapter chooses most efficient implementation

**Port:**
```python
class EvaluationPersistence(Protocol):
    # Individual operations
    async def create_scenario(self, run_id: UUID) -> Scenario: ...
    async def create_result(self, result: ResultCreate) -> EvaluationResult: ...

    # Batch operations (optional, for performance)
    async def create_scenarios(
        self,
        scenarios: list[ScenarioCreate],
    ) -> list[Scenario]: ...

    async def create_results(
        self,
        results: list[ResultCreate],
    ) -> list[EvaluationResult]: ...
```

**Execution loop can choose:**
```python
# Option 1: Individual (simple, works everywhere)
for testcase in testcases:
    scenario = await persistence.create_scenario(run_id=run_id)

# Option 2: Batch (efficient, if adapter supports it)
scenarios_create = [ScenarioCreate(run_id=run_id) for _ in testcases]
scenarios = await persistence.create_scenarios(scenarios=scenarios_create)
```

---

### Divergence 5: Application Invocation

**SDK:**
```python
# SDK invokes applications itself
for application_revision in application_revisions.values():
    application_response = await invoke_application(request=application_request)
    # Then runs evaluators on the output
    for evaluator_revision in evaluator_revisions.values():
        evaluator_response = await invoke_evaluator(...)
```

**API Legacy:**
```python
# API invokes applications BEFORE this loop
# invocations = results from prior application execution
for idx in range(nof_testcases):
    invocation = invocations[idx]  # Already done
    # Only runs evaluators
    for jdx in range(nof_annotations):
        ...
```

**API Live:**
```python
# API Live has no application step
# Evaluates traces directly from production
for trace in query_traces:
    for evaluator in evaluators:
        ...
```

**Resolution:**
- **Unified loop** should support optional application step
- Graph structure determines whether to invoke apps or not
- Live evaluation: graph has no app nodes
- Batch evaluation: graph has app nodes

**Execution:**
```python
async def execute_evaluation(
    graph: EvaluationGraph,
    persistence: EvaluationPersistence,
):
    for scenario in scenarios:
        scenario = await persistence.create_scenario(...)

        node_outputs = {}

        # Execute nodes in topological order
        for node in graph.topological_order():
            if node.type == "query":
                # Already have the data (testcase or trace)
                continue

            elif node.type == "application":
                # Invoke application
                inputs = get_node_inputs(node, scenario, node_outputs)
                response = await invoke_application(...)
                node_outputs[node.id] = response

                # Persist result
                await persistence.populate(...)

            elif node.type == "evaluator":
                # Invoke evaluator
                inputs = get_node_inputs(node, scenario, node_outputs)
                response = await invoke_evaluator(...)

                # Persist result
                await persistence.populate(...)
```

---

## Concrete Refactoring Steps

### Step 1: Extract Pure Functions

**Goal:** Extract common logic into pure, testable functions

**Functions to create:**
1. `build_application_request()` - SDK lines 463-531
2. `build_evaluator_request()` - SDK lines 598-675, API Legacy lines 1072-1190, API Live lines 534-646
3. `extract_trace_outputs()` - SDK lines 584-588, API Legacy lines 1139-1156, API Live lines 595-612
4. `validate_trace_structure()` - API Legacy lines 1047-1063, API Live lines 499-517
5. `prepare_testcase_inputs()` - Common pattern of extracting/cleaning testcase data

**Location:**
- `agenta/core/evaluations/engine/request_builders.py`
- `agenta/core/evaluations/engine/trace_utils.py`

**Example refactoring:**

**Before (SDK, lines 598-675):**
```python
references = dict(
    testset=Reference(id=testset_revision.testset_id),
    ...,
)
links = dict(...)

_revision = evaluator_revision.model_dump(mode="json", exclude_none=True)
interface = WorkflowServiceInterface(...)
configuration = WorkflowServiceConfiguration(...)
parameters = evaluator_revision.data.parameters

workflow_service_request_data = WorkflowServiceRequestData(...)

evaluator_request = EvaluatorServiceRequest(...)
```

**After (SDK refactored):**
```python
from agenta.core.evaluations.engine.request_builders import build_evaluator_request

references = dict(
    testset=Reference(id=testset_revision.testset_id),
    ...,
)
links = dict(
    invocation=Link(trace_id=application_response.trace_id, ...),
)

evaluator_request = build_evaluator_request(
    evaluator_revision=evaluator_revision,
    testcase=testcase,
    inputs=inputs,
    trace=trace,
    outputs=outputs,
    references=references,
    links=links,
)
```

**Testing:**
```python
# tests/unit/test_request_builders.py
def test_build_evaluator_request():
    evaluator_revision = create_mock_evaluator_revision()
    testcase = create_mock_testcase()

    request = build_evaluator_request(
        evaluator_revision=evaluator_revision,
        testcase=testcase,
        inputs={"prompt": "test"},
        trace=None,
        outputs={"result": "output"},
        references={"evaluator": {"id": "123"}},
        links={},
    )

    assert request.version == "2025.07.14"
    assert request.data.inputs == {"prompt": "test"}
    assert request.data.outputs == {"result": "output"}
    # No I/O needed - pure function test
```

---

### Step 2: Define Ports (Interfaces)

**Goal:** Define clean contracts for I/O operations

**Ports to create:**

1. **`EvaluationPersistence`** - Create/read scenarios, results, metrics
2. **`TraceFetcher`** - Fetch traces by ID
3. **`WorkflowInvoker`** - Invoke applications and evaluators

**Location:**
- `agenta/core/evaluations/interfaces/persistence.py`
- `agenta/core/evaluations/interfaces/tracing.py`
- `agenta/core/evaluations/interfaces/workflows.py`

**Example:**

```python
# agenta/core/evaluations/interfaces/persistence.py
from typing import Protocol, Optional, Literal
from uuid import UUID

class EvaluationPersistence(Protocol):
    """Port for the tensor interface: populate / probe / prune."""

    async def populate(
        self,
        *,
        run_id: UUID,
        scenario_id: UUID,
        step_key: str,
        repeat_idx: int,
        trace_id: Optional[UUID] = None,
        testcase_id: Optional[UUID] = None,
        error: Optional[str] = None,
    ) -> EvaluationResult:
        """Write a result for a (scenario, step, repeat) cell."""
        ...

    async def probe(
        self,
        *,
        run_id: UUID,
        slice: TensorSlice,
    ) -> list[EvaluationResult]:
        """Read results for a TensorSlice."""
        ...

    async def prune(
        self,
        *,
        run_id: UUID,
        slice: TensorSlice,
    ) -> int:
        """Delete results for a TensorSlice."""
        ...

    async def refresh_metrics(
        self,
        *,
        run_id: Optional[UUID] = None,
        scenario_id: Optional[UUID] = None,
    ) -> Metrics:
        """Recompute metrics for scope."""
        ...
```

```python
# agenta/core/evaluations/interfaces/tracing.py
from typing import Protocol, Optional
from uuid import UUID

class TraceFetcher(Protocol):
    """Port for fetching execution traces."""

    async def fetch(
        self,
        *,
        trace_id: UUID,
    ) -> Optional[Trace]:
        """Fetch trace by ID."""
        ...
```

```python
# agenta/core/evaluations/interfaces/workflows.py
from typing import Protocol
from uuid import UUID

class WorkflowInvoker(Protocol):
    """Port for invoking workflows (applications and evaluators)."""

    async def invoke_application(
        self,
        *,
        request: ApplicationServiceRequest,
    ) -> ApplicationServiceResponse:
        """Invoke an application workflow."""
        ...

    async def invoke_evaluator(
        self,
        *,
        request: EvaluatorServiceRequest,
        annotate: bool = True,
    ) -> EvaluatorServiceResponse:
        """Invoke an evaluator workflow."""
        ...
```

---

### Step 3: Implement Adapters

**Goal:** Implement concrete adapters for each context

**Adapters to create:**

1. **Remote API Adapters** (for SDK)
   - `RemoteAPIPersistence`
   - `PollingTraceFetcher`
   - `RemoteWorkflowInvoker`

2. **DAO Adapters** (for backend)
   - `DAOPersistence`
   - `ServiceTraceFetcher`
   - `ServiceWorkflowInvoker`

3. **Test Adapters** (for testing)
   - `InMemoryPersistence`
   - `MockTraceFetcher`
   - `MockWorkflowInvoker`

**Location:**
- `agenta/core/evaluations/interfaces/adapters/api.py`
- `agenta/core/evaluations/interfaces/adapters/dao.py`
- `agenta/core/evaluations/interfaces/adapters/memory.py`

**Example:**

```python
# agenta/core/evaluations/interfaces/adapters/api.py
from agenta.sdk.evaluations.results import acreate as alog_result
from agenta.sdk.evaluations.results import aquery as aquery_results
from agenta.sdk.evaluations.results import adelete as adelete_results
from agenta.sdk.evaluations.metrics import arefresh as arefresh_metrics

class RemoteAPIPersistence:
    """Adapter: populate/probe/prune via HTTP calls to backend API."""

    async def populate(
        self,
        *,
        run_id, scenario_id, step_key, repeat_idx,
        trace_id=None, testcase_id=None, error=None,
    ) -> EvaluationResult:
        return await alog_result(
            run_id=run_id,
            scenario_id=scenario_id,
            step_key=step_key,
            repeat_idx=repeat_idx,
            trace_id=trace_id,
            testcase_id=testcase_id,
            error=error,
        )

    async def probe(self, *, run_id, slice) -> list[EvaluationResult]:
        return await aquery_results(run_id=run_id, slice=slice)

    async def prune(self, *, run_id, slice) -> int:
        return await adelete_results(run_id=run_id, slice=slice)

    async def refresh_metrics(self, *, run_id=None, scenario_id=None) -> Metrics:
        return await arefresh_metrics(run_id=run_id, scenario_id=scenario_id)
```

```python
# agenta/core/evaluations/interfaces/adapters/dao.py
class DAOPersistence:
    """Adapter: populate/probe/prune via DAO."""

    def __init__(self, evaluations_service):
        self.service = evaluations_service

    async def populate(
        self,
        *,
        run_id, scenario_id, step_key, repeat_idx,
        trace_id=None, testcase_id=None, error=None,
    ) -> EvaluationResult:
        results = await self.service.create_results(results=[
            EvaluationResultCreate(
                run_id=run_id,
                scenario_id=scenario_id,
                step_key=step_key,
                repeat_idx=repeat_idx,
                trace_id=trace_id,
                testcase_id=testcase_id,
                error=error,
            )
        ])
        return results[0]

    async def probe(self, *, run_id, slice) -> list[EvaluationResult]:
        return await self.service.query_results(run_id=run_id, slice=slice)

    async def prune(self, *, run_id, slice) -> int:
        return await self.service.delete_results(run_id=run_id, slice=slice)

    async def refresh_metrics(self, *, run_id=None, scenario_id=None) -> Metrics:
        return await self.service.refresh_metrics(
            run_id=run_id, scenario_id=scenario_id,
        )
```

---

### Step 4: Extract Canonical Loop (`process`)

**Goal:** Create unified `process` implementation using injected dependencies

**Location:**
- `agenta/core/evaluations/engine/executor.py`

**Canonical loop structure:**

```python
# agenta/core/evaluations/engine/executor.py
from typing import Optional
from uuid import UUID

from agenta.core.evaluations.interfaces.persistence import EvaluationPersistence
from agenta.core.evaluations.interfaces.tracing import TraceFetcher
from agenta.core.evaluations.interfaces.workflows import WorkflowInvoker
from agenta.core.evaluations.types import TensorSlice
from agenta.core.evaluations.engine.request_builders import (
    build_application_request,
    build_evaluator_request,
)
from agenta.core.evaluations.engine.trace_utils import (
    extract_trace_outputs,
    validate_trace_structure,
)


async def process(
    *,
    run: EvaluationRun,
    slice: TensorSlice,
    #
    persistence: EvaluationPersistence,  # provides populate/probe/prune
    trace_fetcher: TraceFetcher,
    workflow_invoker: WorkflowInvoker,
) -> ProcessSummary:
    """
    Canonical process implementation.

    Handles all modes via TensorSlice:
    - Full run: TensorSlice()
    - Live: TensorSlice(scenarios=[...trace-derived ids...])
    - Targeted re-run: TensorSlice(scenarios=[...], steps=[...])

    Dependencies are injected via ports, allowing:
    - SDK to use remote API adapters
    - Backend to use DAO adapters
    - Tests to use in-memory adapters
    """
    scenarios = []

    # ══════════════════════════════════════════════════════════════════
    # OUTER LOOP: Testsets
    # ══════════════════════════════════════════════════════════════════
    for testset_revision in testsets.values():
        if not testset_revision.data or not testset_revision.data.testcases:
            continue

        testcases = testset_revision.data.testcases

        # ══════════════════════════════════════════════════════════════
        # MIDDLE LOOP: Testcases
        # ══════════════════════════════════════════════════════════════
        for testcase in testcases:
            # ──────────────────────────────────────────────────────────
            # 1. Create scenario
            # ──────────────────────────────────────────────────────────
            scenario = await persistence.create_scenario(run_id=run.id)

            results = {}

            # ──────────────────────────────────────────────────────────
            # 2. Populate testcase result
            # ──────────────────────────────────────────────────────────
            result = await persistence.populate(
                run_id=run.id,
                scenario_id=scenario.id,
                step_key=f"testset-{testset_revision.slug}",
                repeat_idx=0,
                testcase_id=testcase.id,
            )
            results[testset_revision.slug] = result

            inputs = testcase.data
            if isinstance(inputs, dict):
                inputs = {k: v for k, v in inputs.items() if k != "testcase_dedup_id"}

            # ──────────────────────────────────────────────────────────
            # 3. INNER LOOP: Applications
            # ──────────────────────────────────────────────────────────
            for application_revision in applications.values():
                if not application_revision or not application_revision.data:
                    continue

                # Build references
                references = {
                    "testset": {"id": str(testset_revision.testset_id)},
                    "testset_variant": {"id": str(testset_revision.testset_variant_id)},
                    "testset_revision": {
                        "id": str(testset_revision.id),
                        "slug": testset_revision.slug,
                        "version": testset_revision.version,
                    },
                    "application": {"id": str(application_revision.application_id)},
                    "application_variant": {"id": str(application_revision.application_variant_id)},
                    "application_revision": {
                        "id": str(application_revision.id),
                        "slug": application_revision.slug,
                        "version": application_revision.version,
                    },
                }

                # Build request (pure function)
                application_request = build_application_request(
                    application_revision=application_revision,
                    testcase=testcase,
                    inputs=inputs,
                    references=references,
                )

                # Invoke application (injected dependency)
                application_response = await workflow_invoker.invoke_application(
                    request=application_request,
                )

                if not application_response or not application_response.trace_id:
                    continue

                trace_id = application_response.trace_id
                application_slug = f"{application_revision.name}-{application_revision.id}"

                # Fetch trace (injected dependency)
                trace = await trace_fetcher.fetch(trace_id=trace_id)

                # Populate application result
                result = await persistence.populate(
                    run_id=run.id,
                    scenario_id=scenario.id,
                    step_key=f"application-{application_slug}",
                    repeat_idx=0,
                    trace_id=trace_id,
                )
                results[application_slug] = result

                if not trace:
                    continue

                # Extract outputs from trace (pure function)
                trace_inputs, trace_outputs = extract_trace_outputs(trace)
                outputs = trace_outputs
                inputs = inputs or trace_inputs

                # ──────────────────────────────────────────────────────
                # 4. INNERMOST LOOP: Evaluators
                # ──────────────────────────────────────────────────────
                for evaluator_revision in evaluators.values():
                    if not evaluator_revision or not evaluator_revision.data:
                        continue

                    # Build references
                    references = {
                        "testset": {"id": str(testset_revision.testset_id)},
                        "testset_variant": {"id": str(testset_revision.testset_variant_id)},
                        "testset_revision": {
                            "id": str(testset_revision.id),
                            "slug": testset_revision.slug,
                            "version": testset_revision.version,
                        },
                        "evaluator": {"id": str(evaluator_revision.evaluator_id)},
                        "evaluator_variant": {"id": str(evaluator_revision.evaluator_variant_id)},
                        "evaluator_revision": {
                            "id": str(evaluator_revision.id),
                            "slug": evaluator_revision.slug,
                            "version": evaluator_revision.version,
                        },
                    }

                    links = {
                        "invocation": {
                            "trace_id": str(application_response.trace_id),
                            "span_id": str(application_response.span_id),
                        }
                    } if application_response.trace_id and application_response.span_id else None

                    # Build request (pure function)
                    evaluator_request = build_evaluator_request(
                        evaluator_revision=evaluator_revision,
                        testcase=testcase,
                        inputs=inputs,
                        trace=trace,
                        outputs=outputs,
                        references=references,
                        links=links,
                    )

                    # Invoke evaluator (injected dependency)
                    evaluator_response = await workflow_invoker.invoke_evaluator(
                        request=evaluator_request,
                        annotate=True,
                    )

                    if not evaluator_response or not evaluator_response.trace_id:
                        continue

                    trace_id = evaluator_response.trace_id

                    # Populate evaluator result
                    result = await persistence.populate(
                        run_id=run.id,
                        scenario_id=scenario.id,
                            step_key=f"evaluator-{evaluator_revision.slug}",
                            trace_id=trace_id,
                        )
                    )
                    results[evaluator_revision.slug] = result

            # ──────────────────────────────────────────────────────────
            # 5. Refresh metrics for scenario
            # ──────────────────────────────────────────────────────────
            metrics = await persistence.refresh_metrics(
                run_id=run.id,
                scenario_id=scenario.id,
            )

            scenarios.append({
                "scenario": scenario,
                "results": results,
                "metrics": metrics,
            })

    return ExecutionSummary(
        run_id=run.id,
        scenarios=scenarios,
        total_scenarios=len(scenarios),
    )
```

---

### Step 5: Migrate SDK to Use `process`

**Goal:** Replace SDK loop with canonical `process` implementation

**File:** `sdk/agenta/sdk/evaluations/preview/evaluate.py`

**Before (lines 377-724):**
```python
# 350+ lines of loop logic with hardcoded API calls
for testset_revision in testset_revisions.values():
    for testcase in testcases:
        scenario = await aadd_scenario(run_id=run.id)  # Hardcoded
        for application_revision in applications:
            # ... invoke ...
            result = await alog_result(...)  # Hardcoded (= populate)
        for evaluator_revision in evaluators:
            # ... invoke ...
            result = await alog_result(...)  # Hardcoded (= populate)
        metrics = await acompute_metrics(...)  # Hardcoded
```

**After:**
```python
from agenta.core.evaluations.engine.executor import process
from agenta.core.evaluations.types import TensorSlice
from agenta.core.evaluations.interfaces.adapters.api import (
    RemoteAPIPersistence,
    PollingTraceFetcher,
    RemoteWorkflowInvoker,
)

async def aevaluate(...):
    # ... setup code (unchanged) ...

    # Create adapters for SDK context
    persistence = RemoteAPIPersistence()
    trace_fetcher = PollingTraceFetcher()
    workflow_invoker = RemoteWorkflowInvoker()

    # Execute using canonical process
    summary = await process(
        run=run,
        slice=TensorSlice(),  # all scenarios × all steps × all repeats
        persistence=persistence,
        trace_fetcher=trace_fetcher,
        workflow_invoker=workflow_invoker,
    )

    # ... return results (unchanged) ...
```

**Line count reduction:** ~350 lines → ~20 lines

---

### Step 6: Migrate Backend to Use `process`

**Goal:** Replace backend loops with canonical `process` implementation

**File:** `api/oss/src/core/evaluations/tasks/legacy.py`

**Before (lines 990-1300+):**
```python
# 300+ lines of loop logic with hardcoded DAO calls
for idx in range(nof_testcases):
    scenario = scenarios[idx]
    testcase = testcases[idx]
    invocation = invocations[idx]

    trace = await fetch_trace(...)  # Hardcoded

    for jdx in range(nof_annotations):
        # ... invoke evaluator ...
        result = await evaluations_dao.create_result(...)  # Hardcoded (= populate)
```

**After:**
```python
from agenta.core.evaluations.engine.executor import process
from agenta.core.evaluations.types import TensorSlice
from agenta.core.evaluations.interfaces.adapters.dao import (
    DAOPersistence,
    ServiceTraceFetcher,
    ServiceWorkflowInvoker,
)

async def evaluate_batch_testset(...):
    # ... setup code ...

    # Create adapters for backend context
    persistence = DAOPersistence(evaluations_service=evaluations_service)
    trace_fetcher = ServiceTraceFetcher(
        tracing_router=tracing_router,
        request=request,
    )
    workflow_invoker = ServiceWorkflowInvoker(
        workflows_service=workflows_service,
        project_id=project_id,
        user_id=user_id,
    )

    # Execute using canonical process
    summary = await process(
        run=run,
        slice=TensorSlice(),  # all scenarios × all steps × all repeats
        persistence=persistence,
        trace_fetcher=trace_fetcher,
        workflow_invoker=workflow_invoker,
    )

    # ... update run status ...
```

**Line count reduction:** ~300 lines → ~30 lines

---

## Pure Functions to Extract

### Summary Table

| Function | Current Location | Extraction Target | Pure? | Lines Saved |
|----------|------------------|-------------------|-------|-------------|
| `build_application_request` | SDK lines 463-531 | `engine/request_builders.py` | ✅ Yes | ~60 per call |
| `build_evaluator_request` | SDK 598-675, API Legacy 1072-1190, API Live 534-646 | `engine/request_builders.py` | ✅ Yes | ~80 per call |
| `extract_trace_outputs` | SDK 584-588, API Legacy 1139-1156, API Live 595-612 | `engine/trace_utils.py` | ✅ Yes | ~15 per call |
| `validate_trace_structure` | API Legacy 1047-1063, API Live 499-517 | `engine/trace_utils.py` | ✅ Yes | ~20 per call |
| `prepare_testcase_inputs` | SDK 445-452, API Legacy 1124-1128 | `engine/testcase_utils.py` | ✅ Yes | ~10 per call |
| `build_references` | SDK 463-486, API Legacy 1072-1077 | `engine/reference_builders.py` | ✅ Yes | ~25 per call |

**Total estimated reduction:** ~600 lines across SDK + API

---

## Adapters to Implement

### Adapter Matrix

| Port | SDK Adapter | Backend Adapter | Test Adapter |
|------|-------------|-----------------|--------------|
| `EvaluationPersistence` | `RemoteAPIPersistence` | `DAOPersistence` | `InMemoryPersistence` |
| `TraceFetcher` | `PollingTraceFetcher` | `ServiceTraceFetcher` | `MockTraceFetcher` |
| `WorkflowInvoker` | `RemoteWorkflowInvoker` | `ServiceWorkflowInvoker` | `MockWorkflowInvoker` |

**Implementation priority:**
1. **Week 1:** `InMemoryPersistence`, `MockTraceFetcher`, `MockWorkflowInvoker` (for testing)
2. **Week 2:** `RemoteAPIPersistence`, `PollingTraceFetcher`, `RemoteWorkflowInvoker` (for SDK)
3. **Week 3:** `DAOPersistence`, `ServiceTraceFetcher`, `ServiceWorkflowInvoker` (for backend)

---

## Testing Strategy

### Unit Tests (Pure Functions)

**No I/O required - fast, deterministic tests**

```python
# tests/unit/engine/test_request_builders.py
import pytest
from agenta.core.evaluations.engine.request_builders import build_evaluator_request

def test_build_evaluator_request_basic():
    evaluator_revision = create_mock_evaluator_revision()
    testcase = create_mock_testcase()

    request = build_evaluator_request(
        evaluator_revision=evaluator_revision,
        testcase=testcase,
        inputs={"prompt": "test"},
        trace=None,
        outputs={"result": "output"},
        references={"evaluator": {"id": "123"}},
        links={},
    )

    assert request.version == "2025.07.14"
    assert request.data.inputs == {"prompt": "test"}
    assert request.data.outputs == {"result": "output"}

def test_build_evaluator_request_with_flags():
    # Test with flags
    ...

def test_build_evaluator_request_without_testcase():
    # Test live evaluation (no testcase)
    ...
```

---

### Integration Tests (Adapters)

**Test each adapter independently**

```python
# tests/integration/adapters/test_dao_persistence.py
import pytest
from agenta.core.evaluations.interfaces.adapters.dao import DAOPersistence

@pytest.mark.asyncio
async def test_dao_persistence_create_scenario(evaluations_service):
    persistence = DAOPersistence(evaluations_service=evaluations_service)

    scenario = await persistence.create_scenario(run_id=UUID("..."))

    assert scenario.id is not None
    assert scenario.run_id == UUID("...")

@pytest.mark.asyncio
async def test_dao_persistence_create_scenarios_batch(evaluations_service):
    persistence = DAOPersistence(evaluations_service=evaluations_service)

    scenarios_create = [
        ScenarioCreate(run_id=UUID("...")),
        ScenarioCreate(run_id=UUID("...")),
    ]

    scenarios = await persistence.create_scenarios(scenarios=scenarios_create)

    assert len(scenarios) == 2
    assert all(s.id is not None for s in scenarios)
```

---

### End-to-End Tests (Canonical Loop)

**Test full execution with mock adapters**

```python
# tests/e2e/test_execute_evaluation.py
import pytest
from agenta.core.evaluations.engine.executor import execute_evaluation
from agenta.core.evaluations.interfaces.adapters.memory import (
    InMemoryPersistence,
    MockTraceFetcher,
    MockWorkflowInvoker,
)

@pytest.mark.asyncio
async def test_execute_evaluation_full_flow():
    # Setup
    run = create_mock_run()
    testsets = {"testset-1": create_mock_testset_revision(nof_testcases=3)}
    applications = {"app-1": create_mock_application_revision()}
    evaluators = {"eval-1": create_mock_evaluator_revision()}

    # Create mock adapters
    persistence = InMemoryPersistence()
    trace_fetcher = MockTraceFetcher()
    workflow_invoker = MockWorkflowInvoker()

    # Execute
    summary = await execute_evaluation(
        run=run,
        testsets=testsets,
        applications=applications,
        evaluators=evaluators,
        persistence=persistence,
        trace_fetcher=trace_fetcher,
        workflow_invoker=workflow_invoker,
    )

    # Assert
    assert summary.total_scenarios == 3
    assert len(summary.scenarios) == 3

    # Verify persistence was called correctly
    assert len(persistence.scenarios) == 3
    assert len(persistence.results) == 3 * (1 + 1 + 1)  # testcase + app + eval

    # Verify workflow invoker was called
    assert workflow_invoker.application_invocations == 3
    assert workflow_invoker.evaluator_invocations == 3
```

---

## Migration Risks & Mitigation

### Risk 1: Breaking Changes

**Risk:** Refactored code doesn't match existing behavior

**Mitigation:**
- Run full test suite before and after migration
- Compare outputs from old vs new implementation side-by-side
- Feature flag to toggle old/new implementation
- Gradual rollout with monitoring

---

### Risk 2: Performance Regression

**Risk:** New implementation is slower

**Mitigation:**
- Benchmark old vs new implementation
- Profile hotspots
- Batch operations where possible (especially in DAO adapter)
- Monitor evaluation run times in production

---

### Risk 3: Adapter Interface Mismatch

**Risk:** Adapters don't fully implement port contracts

**Mitigation:**
- Use `typing.Protocol` for compile-time checks
- Integration tests for each adapter
- Runtime validation in critical paths

---

### Risk 4: Hidden Dependencies

**Risk:** Code depends on side effects not captured in ports

**Mitigation:**
- Thorough code review during extraction
- Explicit dependency injection (no globals)
- Test with mock adapters to expose hidden dependencies

---

## Success Metrics

### Code Quality

- [ ] **Duplication:** < 10% code duplication between SDK and API evaluation logic
- [ ] **Line count:** > 50% reduction in total loop code
- [ ] **Pure functions:** > 80% of execution logic is pure (no I/O)
- [ ] **Test coverage:** > 90% coverage for core execution logic

### Functional

- [ ] **Backward compatibility:** All existing tests pass
- [ ] **Feature parity:** New implementation supports all current features
- [ ] **Error handling:** Graceful handling with clear error messages

### Performance

- [ ] **SDK evaluation:** Within 10% of baseline
- [ ] **API batch evaluation:** Within 10% of baseline
- [ ] **API live evaluation:** Within 10% of baseline

---

## Next Steps

1. ✅ Document current state ([iteration-patterns.md](./iteration-patterns.md))
2. ✅ Document desired state ([desired-architecture.md](./desired-architecture.md))
3. ✅ Analyze code and create refactoring plan (this document)
4. ⏭️ **Review with team** - Get feedback on approach
5. ⏭️ **Prototype** - Extract 1-2 pure functions and test
6. ⏭️ **Implement adapters** - Start with test adapters
7. ⏭️ **Migrate SDK** - Use canonical loop with remote adapters
8. ⏭️ **Migrate backend** - Use canonical loop with DAO adapters
9. ⏭️ **Consolidate** - Merge batch and live into single task

---

**Document Status:** Ready for team review
**Estimated Effort:** 8-12 weeks (see migration path in desired-architecture.md)
**Next Action:** Schedule architecture review meeting
