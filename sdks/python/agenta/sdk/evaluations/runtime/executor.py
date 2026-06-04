from asyncio import Lock, Semaphore, gather
from datetime import datetime
from typing import Any, Awaitable, Callable, Dict, List, Optional, Protocol, Tuple
from uuid import UUID

from agenta.sdk.evaluations.runtime.adapters import (
    SDKResultSetter,
    SDKScenarioEditor,
    SDKMetricsRefresher,
    SDKTraceFetcher,
)
from agenta.sdk.evaluations.runtime.models import (
    EvaluationStep,
    PlannedCell,
    ResolvedSourceItem,
    WorkflowExecutionRequest,
    WorkflowExecutionResult,
)
from agenta.sdk.models.shared import Reference
from agenta.sdk.utils.logging import get_module_logger

_log = get_module_logger(__name__)


class WorkflowRunner(Protocol):
    """Adapter boundary for application/evaluator execution.

    SDK-local evaluation, API service execution, and backend-internal workflow
    invocation should each implement this protocol instead of changing the
    planner or topology classifier.
    """

    async def execute(
        self,
        *,
        request: WorkflowExecutionRequest,
    ) -> WorkflowExecutionResult: ...


class WorkflowBatchRunner(WorkflowRunner, Protocol):
    """Optional batch execution boundary for any runnable workflow step."""

    async def execute_batch(
        self,
        *,
        requests: List[WorkflowExecutionRequest],
        semaphore: Optional[Semaphore] = None,
    ) -> List[WorkflowExecutionResult]: ...


async def execute_workflow_batch(
    *,
    runner: WorkflowRunner,
    requests: List[WorkflowExecutionRequest],
    semaphore: Optional[Semaphore] = None,
) -> List[WorkflowExecutionResult]:
    execute_batch = getattr(runner, "execute_batch", None)

    async def _guarded(request: WorkflowExecutionRequest) -> WorkflowExecutionResult:
        if semaphore is not None:
            async with semaphore:
                return await runner.execute(request=request)
        return await runner.execute(request=request)

    if execute_batch is not None:
        return await execute_batch(requests=requests, semaphore=semaphore)

    return list(await gather(*(_guarded(request) for request in requests)))


class EvaluationTaskRunner(Protocol):
    """Generic evaluation task dispatch boundary.

    SDK/local code should use an in-process asyncio implementation. API code can
    adapt this protocol to Taskiq without Taskiq leaking into SDK runtime code.
    """

    async def process_run_from_source(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run_id: UUID,
        newest: Optional[datetime] = None,
        oldest: Optional[datetime] = None,
    ) -> Any: ...

    async def process_run_from_batch(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run_id: UUID,
        source_kind: str,
        trace_ids: Optional[List[str]] = None,
        testcase_ids: Optional[List[UUID]] = None,
        input_step_key: Optional[str] = None,
    ) -> Any: ...


class AsyncioEvaluationTaskRunner:
    """In-process evaluation executor for SDK/local runs.

    The SDK counterpart of the API's Taskiq worker. It mirrors the API's slice-op
    sequence — add_scenarios -> populate -> refresh — but adapted to the SDK's
    irreducible differences: it works by VALUE (entities already resolved in
    `aevaluate`), executes workflows LOCALLY (the user's decorated functions, via
    `SDKWorkflowRunner`), and runs inline with no broker.

    Per testset revision the sequence is:

      1. add_scenarios — bulk-mint N skeleton scenarios (the `add_scenarios` op),
      2. process — ONE slice over all scenarios via the SDK engine with local
         runners. Each cell is written live (SDKResultSetter -> populate), the
         engine refreshes metrics inline per scenario (variational) and once at
         the end (global), and writes each scenario's status — the SAME shape as
         the API worker, only the runner is local.

    The source processor (`process_sources`) is the same engine the API funnels
    through; only the injected adapters (local runner) differ.
    """

    def __init__(
        self,
        *,
        process_sources: Callable[..., Awaitable[List[Any]]],
        add_scenarios: Callable[..., Awaitable[List[Any]]],
        populate_slice: Callable[..., Awaitable[Any]],
        refresh_metrics: Callable[..., Awaitable[Any]],
        edit_scenario: Callable[..., Awaitable[Any]],
        retrieve_testset: Callable[..., Awaitable[Any]],
        retrieve_application: Callable[..., Awaitable[Any]],
        retrieve_evaluator: Callable[..., Awaitable[Any]],
        workflow_runner: Any,
        fetch_trace: Any,
    ):
        self._process_sources = process_sources
        self._add_scenarios = add_scenarios
        self._populate_slice = populate_slice
        self._refresh_metrics = refresh_metrics
        self._edit_scenario = edit_scenario
        self._retrieve_testset = retrieve_testset
        self._retrieve_application = retrieve_application
        self._retrieve_evaluator = retrieve_evaluator
        # Stateless dispatcher (branches on step type); one shared instance is
        # wired into every runnable step — no per-step minting needed.
        self._workflow_runner = workflow_runner
        self._fetch_trace = fetch_trace

    def _build_steps_and_runners(
        self,
        *,
        testset: Tuple[Any, Any],
        input_step_key: str,
        application_revisions: List[Tuple[Any, Any]],
        evaluator_revisions: List[Tuple[Any, Any]],
    ) -> tuple:
        """Build the step graph + wire local runners for one testset revision.

        All three entity kinds arrive as the same `(revision, origin)` shape,
        consumed symmetrically (testset is a single pair; applications and
        evaluators are lists of pairs). The input step carries the testset's
        origin, the invocation step the application's, the annotation step the
        evaluator's; only evaluators vary (auto / custom / human), and only
        non-human runnable steps get a local runner. The one shared
        `SDKWorkflowRunner` is wired into every runnable step; it branches on
        step type internally.
        """
        testset_revision, testset_origin = testset
        steps = [
            EvaluationStep(
                key=input_step_key,
                type="input",
                origin=testset_origin,
                references={
                    "testset": Reference(id=testset_revision.testset_id),
                    "testset_variant": Reference(
                        id=testset_revision.testset_variant_id
                    ),
                    "testset_revision": Reference(
                        id=testset_revision.id,
                        slug=testset_revision.slug,
                        version=testset_revision.version,
                    ),
                },
            )
        ]
        runners: Dict[str, Any] = {}
        revisions: Dict[str, Any] = {}

        for application_revision, origin in application_revisions:
            if not application_revision or not application_revision.data:
                continue
            application_step_key = "application-" + application_revision.slug
            steps.append(
                EvaluationStep(
                    key=application_step_key,
                    type="invocation",
                    origin=origin,
                    references={
                        "application": Reference(
                            id=application_revision.application_id
                        ),
                        "application_variant": Reference(
                            id=application_revision.application_variant_id,
                        ),
                        "application_revision": Reference(
                            id=application_revision.id,
                            slug=application_revision.slug,
                            version=application_revision.version,
                        ),
                    },
                )
            )
            if origin != "human":
                runners[application_step_key] = self._workflow_runner
                revisions[application_step_key] = application_revision

        for evaluator_revision, origin in evaluator_revisions:
            if not evaluator_revision or not evaluator_revision.data:
                continue
            evaluator_step_key = "evaluator-" + evaluator_revision.slug
            steps.append(
                EvaluationStep(
                    key=evaluator_step_key,
                    type="annotation",
                    origin=origin,
                    references={
                        "evaluator": Reference(id=evaluator_revision.evaluator_id),
                        "evaluator_variant": Reference(
                            id=evaluator_revision.evaluator_variant_id,
                        ),
                        "evaluator_revision": Reference(
                            id=evaluator_revision.id,
                            slug=evaluator_revision.slug,
                            version=evaluator_revision.version,
                        ),
                    },
                )
            )
            # auto + custom evaluators run locally; only human is left to the web.
            if origin != "human":
                runners[evaluator_step_key] = self._workflow_runner
                revisions[evaluator_step_key] = evaluator_revision

        return steps, runners, revisions

    def _build_source_items(
        self,
        *,
        testset_revision: Any,
        input_step_key: str,
    ) -> List[Any]:
        """One hydrated source item per testcase in the revision."""
        source_items: List[Any] = []
        for testcase in testset_revision.data.testcases:
            inputs = dict(testcase.data or {})
            inputs.pop("testcase_dedup_id", None)
            source_items.append(
                ResolvedSourceItem(
                    kind="testcase",
                    step_key=input_step_key,
                    references={
                        "testcase": Reference(id=testcase.id),
                        "testset": Reference(id=testset_revision.testset_id),
                        "testset_variant": Reference(
                            id=testset_revision.testset_variant_id,
                        ),
                        "testset_revision": Reference(
                            id=testset_revision.id,
                            slug=testset_revision.slug,
                            version=testset_revision.version,
                        ),
                    },
                    testcase_id=testcase.id,
                    testcase=testcase.model_dump(mode="json", exclude_none=True),
                    inputs=inputs,
                )
            )
        return source_items

    async def _retrieve_revisions(
        self,
        run_data: Any,
    ) -> Tuple[
        List[Tuple[Any, Any]],
        List[Tuple[Any, Any]],
        List[Tuple[Any, Any]],
    ]:
        """Fetch the revision objects for the run's step ids.

        `run_data` carries revision IDS; local execution needs the revision
        OBJECTS (slug/data/refs), so fetch them via the injected per-entity
        retrievers — the SDK analogue of the API executor's
        `_resolve_runners_and_revisions`. Returns `(revision, origin)` pairs per
        kind. Testsets get the revision-id-then-testset-id fallback.
        """
        testset_revisions: List[Tuple[Any, Any]] = []
        for testset_ref, origin in (run_data.testset_steps or {}).items():
            testset_revision = await self._retrieve_testset(
                testset_revision_id=testset_ref,
            )
            if not testset_revision or not testset_revision.id:
                # Fallback: treat the id as a testset id (latest revision).
                testset_revision = await self._retrieve_testset(
                    testset_id=testset_ref,
                )
            if not testset_revision or not testset_revision.id:
                _log.warning(
                    "[EVAL] testset reference could not be retrieved; skipping",
                    testset_ref=str(testset_ref),
                )
                continue
            testset_revisions.append((testset_revision, origin))

        application_revisions: List[Tuple[Any, Any]] = []
        for application_revision_id, origin in (
            run_data.application_steps or {}
        ).items():
            application_revision = await self._retrieve_application(
                application_revision_id=application_revision_id,
            )
            if not application_revision:
                continue
            application_revisions.append((application_revision, origin))

        evaluator_revisions: List[Tuple[Any, Any]] = []
        for evaluator_revision_id, origin in (run_data.evaluator_steps or {}).items():
            evaluator_revision = await self._retrieve_evaluator(
                evaluator_revision_id=evaluator_revision_id,
            )
            if not evaluator_revision:
                continue
            evaluator_revisions.append((evaluator_revision, origin))

        return testset_revisions, application_revisions, evaluator_revisions

    async def process_run_locally(
        self,
        *,
        run_id: UUID,
        run_data: Any,
    ) -> Tuple[List[Dict[str, Any]], Any]:
        """Run the evaluation locally via the API-mirroring slice sequence.

        Takes `run_data` (revision IDS) and fetches the revision OBJECTS itself
        (`_retrieve_revisions`, via injected retrievers) — mirroring the API
        executor, which fetches its revisions inside `process`, not before. Per
        testset: add_scenarios (bulk) -> ONE process_sources slice over all
        scenarios (live cell writes, inline + global metric refresh, status
        writes). Empty/unresolved testsets are skipped, not failed.
        """
        # Local import: processor.py imports from this module, so importing it at
        # module load would be circular. The verdict→status ranking lives there
        # so every driver shares one definition.
        from agenta.sdk.evaluations.runtime.processor import (
            run_status,
            scenario_status,
        )

        (
            testset_revisions,
            application_revisions,
            evaluator_revisions,
        ) = await self._retrieve_revisions(run_data)
        repeats = run_data.repeats

        scenarios: List[Dict[str, Any]] = []
        # Accumulate the engine's per-scenario verdicts across every slice so the
        # run status is rolled up once via the shared `run_status` — not
        # re-derived by the caller at close time.
        all_processed: List[Any] = []

        for testset in testset_revisions:
            testset_revision, _origin = testset
            if not testset_revision.data or not testset_revision.data.testcases:
                # An empty testset produces no scenarios. Warn per-testset so a
                # partially-empty run (some testsets have data, others don't) is
                # still surfaced — the caller's aggregate "no scenarios" warning
                # only fires when EVERY testset was empty.
                _log.warning(
                    "[EVAL] testset has no testcases; skipping",
                    testset_revision_id=str(testset_revision.id),
                )
                continue

            _log.info(
                "[EVAL] processing testset",
                testset_id=str(testset_revision.testset_id),
            )

            input_step_key = "testset-" + testset_revision.slug
            steps, runners, revisions = self._build_steps_and_runners(
                testset=testset,
                input_step_key=input_step_key,
                application_revisions=application_revisions,
                evaluator_revisions=evaluator_revisions,
            )
            source_items = self._build_source_items(
                testset_revision=testset_revision,
                input_step_key=input_step_key,
            )

            # add_scenarios — bulk-mint one skeleton per source item, in order.
            minted = await self._add_scenarios(
                run_id=run_id,
                count=len(source_items),
            )
            if len(minted) != len(source_items):
                _log.warning(
                    "[EVAL] add_scenarios returned an unexpected count; skipping",
                    wanted=len(source_items),
                    got=len(minted),
                    testset_revision_id=str(testset_revision.id),
                )
                continue

            # ONE slice over ALL scenarios — the design's `process_slice(all
            # scenarios, all steps)`. The engine's internal gather + semaphore run
            # the scenarios concurrently (bounded by batch_size), which is what
            # makes concurrency real; an outer per-scenario loop would feed the
            # engine one item at a time and leave the semaphore inert.
            # Live persistence, aligned with the API: each cell is populated as
            # the engine produces it (SDKResultSetter), so the engine's inline
            # per-scenario metric refresh (arefresh) sees persisted cells, and
            # the engine's end-of-slice global refresh rolls up the run — the
            # same variational-inline + global-at-end shape as the API worker.
            processed = await self._process_sources(
                run_id=run_id,
                source_items=source_items,
                steps=steps,
                repeats=repeats,
                create_scenario=_PreMintedScenarios(minted),
                set_results=SDKResultSetter(populate=self._populate_slice),
                refresh_metrics=SDKMetricsRefresher(refresh=self._refresh_metrics),
                edit_scenario=SDKScenarioEditor(edit=self._edit_scenario),
                runners=runners,
                revisions=revisions,
                fetch_trace=SDKTraceFetcher(fetch=self._fetch_trace),
                # The SDK evaluate() loop IS the executor for custom-origin steps.
                execute_custom=True,
            )

            # Cells are live-written and status is written in-loop by the engine's
            # edit_scenario adapter (same as the API), so here we only assemble
            # the return payload.
            for item in processed:
                scenarios.append(
                    {
                        "scenario": item.scenario,
                        "results": item.results,
                        "metrics": item.metrics,
                        "status": scenario_status(
                            has_errors=item.has_errors,
                            has_pending=item.has_pending,
                        ),
                    }
                )
            all_processed.extend(processed)

        # Run status rolled up once from every touched scenario (shared with the
        # API). The caller applies it (closes the run with it); it is NOT
        # re-derived there.
        return scenarios, run_status(all_processed)


class _PreMintedScenarios:
    """`create_scenario` adapter handing back bulk-minted scenarios in order.

    The engine calls `create_scenario(run_id)` once per source item; the SDK
    minted them all up front via `add_scenarios`, so this cursor returns the next
    pre-minted scenario instead of creating a new one — the SDK analogue of the
    API's `_ExistingScenario` over a seed-bindings set.

    Order/concurrency: the engine now runs scenarios concurrently (gather +
    semaphore), so multiple coroutines call this. `create_scenario` is the FIRST
    statement of the engine's `_process_one` and this body has no `await`, so
    each task runs through the pop synchronously before reaching any real
    suspension point — i.e. the pops happen in `source_items` order, pairing
    scenario i with source_item i. The lock makes the index increment atomic so
    that ordering can never degrade into a double-hand-out if scheduling shifts.
    """

    def __init__(self, scenarios: List[Any]):
        self._scenarios = list(scenarios)
        self._idx = 0
        self._lock = Lock()

    async def __call__(self, *, run_id: UUID) -> Any:
        async with self._lock:
            scenario = self._scenarios[self._idx]
            self._idx += 1
            return scenario


class ResultSetter(Protocol):
    """Adapter boundary for persisting planned result cells."""

    async def set(
        self,
        *,
        cell,
        trace_id=None,
        testcase_id=None,
        error=None,
    ) -> Any: ...


# Adapter boundary for loading a runner's trace after a step executes: a plain
# async callable `(trace_id=...) -> trace | None`. The SDK passes `afetch_trace`
# directly; the API passes its (callable) APITraceLoader instance. The engine
# invokes it by keyword (`fetch_trace(trace_id=...)`), which a positional-only
# `Callable[[str], ...]` can't express, so the alias uses `Callable[..., ...]`.
TraceLoader = Callable[..., Awaitable[Optional[Any]]]


class RuntimeExecutionContext:
    """Small mutable context shared by runner adapters while processing a scenario."""

    def __init__(self) -> None:
        self.results: Dict[str, Any] = {}
        self.traces: Dict[str, Any] = {}
        self.outputs: Dict[str, Any] = {}

    def remember_result(self, *, cell: PlannedCell, result: Any) -> None:
        self.results[cell.step_key] = result

    def remember_execution(
        self,
        *,
        cell: PlannedCell,
        execution: WorkflowExecutionResult,
    ) -> None:
        if execution.trace is not None:
            self.traces[cell.step_key] = execution.trace
        if execution.outputs is not None:
            self.outputs[cell.step_key] = execution.outputs
