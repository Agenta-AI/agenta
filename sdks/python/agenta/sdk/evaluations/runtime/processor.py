import asyncio
from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional, Union
from uuid import UUID

from pydantic import BaseModel

from agenta.sdk.evaluations.runtime.executor import (
    ResultSetter,
    TraceLoader,
    execute_workflow_batch,
)
from agenta.sdk.evaluations.runtime.status import (
    ProcessedScenario,
    scenario_status,
)
from agenta.sdk.evaluations.runtime.models import (
    EvaluationStep,
    PlannedCell,
    ResolvedSourceItem,
    WorkflowExecutionRequest,
    WorkflowExecutionResult,
)
from agenta.sdk.evaluations.runtime.planner import EvaluationPlanner
from agenta.sdk.models.evaluations import EvaluationStatus
from agenta.sdk.utils.logging import get_logger

logger = get_logger(__name__)

# Default concurrency for a slice when the caller passes no explicit batch_size.
# batch_size is None across both drivers by default (nothing sets
# run.data.concurrency), which would leave the engine's semaphore inert and run
# every scenario's workflows unbounded. A bounded default gives both the API and
# the SDK the same in-slice concurrency through the shared semaphore instead of
# dormant machinery. An explicit batch_size (e.g. from run.data.concurrency)
# still overrides this.
DEFAULT_BATCH_SIZE = 10


class Concurrency(BaseModel):
    """The three concurrency knobs that always travel together.

    `batch_size` bounds concurrent workflow invocations across the slice;
    `max_retries`/`retry_delay` govern per-invocation retry. Grouped into one
    object so the engine and both drivers pass one value instead of three flat
    params. Sourced from the API's `run.data.concurrency`; the SDK driver leaves
    it at the default.
    """

    batch_size: Optional[int] = None
    max_retries: Optional[int] = None
    retry_delay: Optional[float] = None


# Keyword-only seam callables. The engine invokes these by keyword
# (`create_scenario(run_id=...)`, `refresh_metrics(run_id=..., scenario_id=...)`),
# which `Callable[[...], ...]` (positional-only) can't express, so the aliases use
# `Callable[..., ...]` to stay honest about the keyword contract.
CreateScenario = Callable[..., Awaitable[Any]]
RefreshMetrics = Callable[..., Awaitable[Any]]
PlanCellFilter = Callable[[PlannedCell], bool]
# Per-repeat upstream context seed. Either ONE slice-wide dict (every scenario
# gets the same seed — the simple/SDK case, usually None) OR an async callable
# `(scenario_id) -> {repeat_idx: ctx}` resolved lazily per scenario. The
# callable form lets a batched slice carry DIFFERENT recovered context per
# scenario (the API re-execute path) without holding every scenario's context
# in memory at once.
InitialContextByRepeat = Dict[int, Dict[str, Any]]
InitialContextSeed = Union[
    InitialContextByRepeat,
    Callable[[UUID], Awaitable[InitialContextByRepeat]],
]
# Adapter boundary for persisting a scenario's terminal status. The engine
# computes the verdict (has_errors/has_pending) per scenario, so writing the
# status is a property of `process` itself — every driver (API ingest,
# API re-execute, SDK) injects its own setter rather than re-deriving status
# in a separate post-process. A plain async `(scenario, status) -> Any`.
EditScenario = Callable[..., Awaitable[Any]]


async def process_sources(
    *,
    run_id: UUID,
    #
    steps: List[EvaluationStep],
    repeats: Optional[int] = None,
    #
    source_items: List[ResolvedSourceItem],
    #
    revisions: Mapping[str, Any],
    #
    runners: Mapping[str, Any],
    #
    concurrency: Optional[Concurrency] = None,
    #
    is_split: bool = False,
    #
    should_set_pending: bool = True,
    should_refresh_metrics: bool = True,
    #
    execute_custom: bool = False,
    #
    initial_context_seed: Optional[InitialContextSeed] = None,
    plan_cell_filter: Optional[PlanCellFilter] = None,
    #
    create_scenario: CreateScenario,
    edit_scenario: Optional[EditScenario] = None,
    set_results: ResultSetter,
    refresh_metrics: RefreshMetrics,
    fetch_trace: Optional[TraceLoader] = None,
) -> List[ProcessedScenario]:
    """Process concrete source items through the SDK-owned runtime contract.

    The function is runner/persistence agnostic. SDK preview uses local
    decorator runners and API result logging; backend code can move to this
    shape by supplying backend DAO/workflow adapters.

    batch_size controls the maximum number of concurrent invoke_workflow calls
    across all scenarios and repeats. A single asyncio.Semaphore is shared by
    both the scenario-level gather and the per-step repeat batch so that peak
    concurrency equals exactly batch_size regardless of how repeats are split.
    When the caller passes no batch_size, `DEFAULT_BATCH_SIZE` applies so the
    slice still runs bounded-concurrent rather than unbounded — the same default
    for both the API and the SDK driver.
    """
    concurrency = concurrency or Concurrency()
    max_retries = concurrency.max_retries
    retry_delay = concurrency.retry_delay
    effective_batch_size = concurrency.batch_size or DEFAULT_BATCH_SIZE
    semaphore = asyncio.Semaphore(effective_batch_size)
    processed_lock = asyncio.Lock()
    processed: List[ProcessedScenario] = []

    logger.info(
        "[SLICE] Starting",
        run_id=str(run_id),
        scenarios=len(source_items),
        batch_size=effective_batch_size,
        **({"max_retries": max_retries} if max_retries else {}),
        **({"retry_delay": retry_delay} if retry_delay else {}),
    )

    async def _process_one(scenario: Any, source_item: ResolvedSourceItem) -> None:
        scenario_id = scenario.id

        logger.info(
            "[SCENARIO] Starting",
            run_id=str(run_id),
            scenario_id=str(scenario_id),
            **(
                {"testcase_id": str(source_item.testcase_id)}
                if source_item.testcase_id
                else {}
            ),
        )

        plan = EvaluationPlanner().plan(
            run_id=run_id,
            #
            steps=steps,
            repeats=repeats,
            #
            scenario_id=scenario_id,
            #
            source=source_item,
            #
            is_split=is_split,
            #
            execute_custom=execute_custom,
        )
        if plan_cell_filter is not None:
            plan = plan.model_copy(
                update={
                    "cells": [cell for cell in plan.cells if plan_cell_filter(cell)]
                }
            )
        # Keyed by step_key, then repeat_idx. A step with repeats>1 produces one
        # result per repeat; keying by step_key alone would let later repeats
        # overwrite earlier ones, so each step maps to a {repeat_idx: result}
        # dict. JSON-serializable (int keys) so it survives the SDK return.
        results: Dict[str, Dict[int, Any]] = {}

        def _remember(cell: PlannedCell, value: Any) -> None:
            results.setdefault(cell.step_key, {})[cell.repeat_idx] = value

        context_by_repeat = _initial_context_by_repeat(
            source_item=source_item,
            repeats=repeats,
        )
        # The seed is either a slice-wide dict (every scenario the same) or an
        # async callable resolved lazily for THIS scenario — the batched-slice
        # case where each scenario recovers its own upstream context.
        seed = initial_context_seed
        if callable(seed):
            seed = await seed(scenario_id)
        if seed:
            context_by_repeat.update(seed)
        scenario_has_pending = False
        scenario_has_errors = False
        scenario_auto_results_created = False

        idx = 0
        while idx < len(plan.cells):
            cell = plan.cells[idx]
            step = _step_by_key(steps, cell.step_key)
            if step is None:
                idx += 1
                continue

            if cell.step_type == "input":
                _remember(
                    cell,
                    await set_results.set(
                        cell=cell,
                        testcase_id=source_item.testcase_id,
                        trace_id=source_item.trace_id,
                    ),
                )
                idx += 1
                continue

            if not cell.should_execute:
                scenario_has_pending = True
                logger.info(
                    "[STEP] Pending",
                    run_id=str(run_id),
                    scenario_id=str(scenario_id),
                    step_key=cell.step_key,
                    repeat_idx=cell.repeat_idx,
                )
                if should_set_pending:
                    _remember(
                        cell,
                        await set_results.set(cell=cell),
                    )
                idx += 1
                continue

            batch_cells = _next_runnable_batch(
                cells=plan.cells,
                start_idx=idx,
                step_key=cell.step_key,
            )
            runner = runners.get(cell.step_key)
            revision = revisions.get(cell.step_key)
            if runner is None or revision is None:
                logger.info(
                    "[STEP] Error",
                    run_id=str(run_id),
                    scenario_id=str(scenario_id),
                    step_key=cell.step_key,
                    error=f"Missing runner or revision for {cell.step_key}",
                )
                for batch_cell in batch_cells:
                    scenario_has_errors = True
                    _remember(
                        batch_cell,
                        await set_results.set(
                            cell=_failed_cell(
                                batch_cell,
                                message=(
                                    f"Missing runner or revision for "
                                    f"{batch_cell.step_key}"
                                ),
                            ),
                            error={
                                "message": (
                                    f"Missing runner or revision for "
                                    f"{batch_cell.step_key}"
                                )
                            },
                        ),
                    )
                idx += len(batch_cells)
                continue

            requests = [
                _build_execution_request(
                    cell=batch_cell,
                    #
                    step=step,
                    source_item=source_item,
                    revision=revision,
                    context_by_repeat=context_by_repeat,
                )
                for batch_cell in batch_cells
            ]

            executions = await _execute_with_retry(
                runner=runner,
                #
                requests=requests,
                #
                semaphore=semaphore,
                #
                max_retries=max_retries,
                retry_delay=retry_delay,
            )
            for batch_cell, execution in zip(batch_cells, executions):
                if fetch_trace and execution.trace_id and execution.trace is None:
                    execution.trace = await fetch_trace(
                        trace_id=str(execution.trace_id)
                    )
                if execution.outputs is None and execution.trace is not None:
                    execution.outputs = _extract_outputs(execution.trace)

                # Persist the EXECUTED status, not the planned one. `batch_cell`
                # still carries its pre-execution status (e.g. QUEUED); the result
                # row must record the verdict the runner produced (SUCCESS/ERRORS)
                # or the cell stays QUEUED in the DB and renders grey in the UI.
                batch_cell.status = execution.status

                _remember(
                    batch_cell,
                    await set_results.set(
                        cell=batch_cell,
                        #
                        trace_id=execution.trace_id,
                        hash_id=execution.hash_id,
                        testcase_id=source_item.testcase_id,
                        error=execution.error,
                    ),
                )
                scenario_auto_results_created = True
                step_failed = bool(
                    execution.error or _is_failure_status(execution.status)
                )
                if step_failed:
                    scenario_has_errors = True
                logger.info(
                    "[STEP] Done",
                    run_id=str(run_id),
                    scenario_id=str(scenario_id),
                    step_key=batch_cell.step_key,
                    repeat_idx=batch_cell.repeat_idx,
                    status=getattr(execution.status, "name", execution.status),
                    **(
                        {"trace_id": str(execution.trace_id)}
                        if execution.trace_id
                        else {}
                    ),
                    **({"error": execution.error} if step_failed else {}),
                )

                if execution.trace_id:
                    _remember_context(
                        cell=batch_cell,
                        #
                        context_by_repeat=context_by_repeat,
                        trace=execution.trace,
                        trace_id=str(execution.trace_id),
                        span_id=execution.span_id,
                        outputs=execution.outputs,
                    )

            if len(executions) != len(batch_cells):
                scenario_has_errors = True
                message = (
                    f"Runner for {cell.step_key} returned {len(executions)} "
                    f"execution(s) for {len(batch_cells)} planned cell(s)."
                )
                if len(executions) < len(batch_cells):
                    # Fewer executions than cells: fail the unplanned-for cells so
                    # the mismatch is visible per cell.
                    for batch_cell in batch_cells[len(executions) :]:
                        _remember(
                            batch_cell,
                            await set_results.set(
                                cell=_failed_cell(batch_cell, message=message),
                                testcase_id=source_item.testcase_id,
                                error={"message": message},
                            ),
                        )
                        scenario_auto_results_created = True
                else:
                    # More executions than cells: the extras have no cell and were
                    # dropped by the zip() above. Warn with their summaries so the
                    # contract violation leaves an audit trail.
                    extra_executions = executions[len(batch_cells) :]
                    logger.warning(
                        message,
                        step_key=cell.step_key,
                        planned_cells=len(batch_cells),
                        returned_executions=len(executions),
                        dropped_executions=[
                            {
                                "trace_id": str(execution.trace_id)
                                if execution.trace_id
                                else None,
                                "span_id": str(execution.span_id)
                                if execution.span_id
                                else None,
                                "status": str(execution.status),
                                "error": execution.error,
                            }
                            for execution in extra_executions
                        ],
                    )

            idx += len(batch_cells)

        metrics = None
        if should_refresh_metrics or scenario_auto_results_created:
            try:
                logger.info(
                    "[METRICS] Refreshing",
                    run_id=str(run_id),
                    scenario_id=str(scenario_id),
                    scope="variational",
                )
                metrics = await refresh_metrics(run_id=run_id, scenario_id=scenario_id)
            except Exception:  # pylint: disable=broad-exception-caught
                # A metrics-refresh failure must not lose the result cells that
                # were already written for this scenario, nor abort sibling
                # scenarios in the gather. Mark the scenario errored and carry on.
                logger.error(
                    "[SLICE] scenario metrics refresh failed",
                    run_id=str(run_id),
                    scenario_id=str(scenario_id),
                    exc_info=True,
                )
                scenario_has_errors = True

        status = scenario_status(
            has_errors=scenario_has_errors,
            has_pending=scenario_has_pending,
        )
        logger.info(
            "[SCENARIO] Complete",
            run_id=str(run_id),
            scenario_id=str(scenario_id),
            status=status.name,
            cells=len(plan.cells),
        )

        # Per-scenario status write. The verdict is known here (this scenario's
        # touched cells), so the engine owns the write via the injected adapter
        # — the same path for every driver, instead of a separate post-process.
        if edit_scenario is not None:
            await edit_scenario(scenario=scenario, status=status)

        async with processed_lock:
            processed.append(
                ProcessedScenario(
                    scenario=scenario,
                    results=results,
                    metrics=metrics,
                    has_pending=scenario_has_pending,
                    has_errors=scenario_has_errors,
                    auto_results_created=scenario_auto_results_created,
                )
            )

    async def _guarded_process_one(source_item: ResolvedSourceItem) -> None:
        # One scenario's failure must not abort the slice. Isolate it, but record
        # it: mark the scenario errored and roll it up so it does not vanish.
        try:
            scenario = await create_scenario(run_id=run_id)
        except Exception:  # pylint: disable=broad-exception-caught
            logger.error(
                "[SLICE] scenario creation failed",
                run_id=str(run_id),
                step_key=source_item.step_key,
                exc_info=True,
            )
            return

        try:
            await _process_one(scenario, source_item)
        except Exception:  # pylint: disable=broad-exception-caught
            logger.error(
                "[SLICE] scenario processing failed",
                run_id=str(run_id),
                scenario_id=str(scenario.id),
                step_key=source_item.step_key,
                exc_info=True,
            )
            if edit_scenario is not None:
                await edit_scenario(scenario=scenario, status=EvaluationStatus.ERRORS)
            async with processed_lock:
                processed.append(ProcessedScenario(scenario=scenario, has_errors=True))

    await asyncio.gather(*(_guarded_process_one(item) for item in source_items))

    has_errors = any(item.has_errors for item in processed)
    logger.info(
        "[SLICE] Complete",
        run_id=str(run_id),
        processed=len(processed),
        **({"has_errors": has_errors} if has_errors else {}),
    )

    if processed and (
        should_refresh_metrics or any(item.auto_results_created for item in processed)
    ):
        try:
            logger.info(
                "[METRICS] Refreshing",
                run_id=str(run_id),
                scope="global",
            )
            await refresh_metrics(run_id=run_id, scenario_id=None)
        except Exception:  # pylint: disable=broad-exception-caught
            # The run-level rollup is best-effort: every scenario already
            # refreshed its own metrics above, and the result cells are
            # persisted. A failure here must not discard the processed list the
            # caller uses to finalize run status.
            logger.error(
                "[SLICE] run-level metrics refresh failed",
                run_id=str(run_id),
                exc_info=True,
            )

    return processed


async def _execute_with_retry(
    *,
    runner: Any,
    #
    requests: List[WorkflowExecutionRequest],
    #
    semaphore: Optional[asyncio.Semaphore],
    #
    max_retries: Optional[int],
    retry_delay: Optional[float],
) -> List[WorkflowExecutionResult]:
    attempts = max(1, (max_retries or 0) + 1)
    delay = retry_delay or 0.0
    results: List[WorkflowExecutionResult] = await execute_workflow_batch(
        runner=runner,
        #
        requests=requests,
        #
        semaphore=semaphore,
    )
    for attempt in range(attempts - 1):
        failed_indices = [
            i for i, r in enumerate(results) if r.error or _is_failure_status(r.status)
        ]
        if not failed_indices:
            break
        logger.warning(
            "[RETRY] Retrying failed requests",
            attempt=attempt + 1,
            failed=len(failed_indices),
            total=len(requests),
            delay=delay,
        )
        if delay > 0:
            await asyncio.sleep(delay)
        retried = await execute_workflow_batch(
            runner=runner,
            #
            requests=[requests[i] for i in failed_indices],
            #
            semaphore=semaphore,
        )
        for idx, result in zip(failed_indices, retried):
            results[idx] = result
    return results


def _is_failure_status(status: EvaluationStatus) -> bool:
    # `WorkflowExecutionResult.status` is typed `EvaluationStatus`, so compare
    # members directly rather than matching `str(status)` against literals.
    return status in (EvaluationStatus.FAILURE, EvaluationStatus.ERRORS)


def _step_by_key(
    steps: List[EvaluationStep],
    step_key: str,
) -> Optional[EvaluationStep]:
    for step in steps:
        if step.key == step_key:
            return step
    return None


def _initial_context_by_repeat(
    *,
    source_item: ResolvedSourceItem,
    repeats: Optional[int],
) -> Dict[int, Dict[str, Any]]:
    if not source_item.trace and not source_item.trace_id:
        return {}

    trace = source_item.trace
    trace_id = source_item.trace_id or _get_trace_id(trace)
    root_span = _extract_root_span(trace)
    span_id = source_item.span_id or _get_span_id(root_span)
    outputs = source_item.outputs or _extract_outputs(trace)
    if not trace_id:
        return {}

    context = {
        "trace": trace,
        "trace_id": str(trace_id),
        "span_id": span_id,
        "outputs": outputs,
    }
    count = repeats or 1
    return {repeat_idx: context for repeat_idx in range(max(count, 1))}


def _next_runnable_batch(
    *,
    cells: List[PlannedCell],
    #
    start_idx: int,
    step_key: str,
) -> List[PlannedCell]:
    batch = []
    for cell in cells[start_idx:]:
        if not cell.should_execute or cell.step_key != step_key:
            break
        batch.append(cell)
    return batch


def _build_execution_request(
    *,
    cell: PlannedCell,
    #
    step: EvaluationStep,
    source_item: ResolvedSourceItem,
    revision: Any,
    context_by_repeat: Dict[int, Dict[str, Any]],
) -> WorkflowExecutionRequest:
    upstream = _upstream_for_cell(
        cell=cell,
        context_by_repeat=context_by_repeat,
    )
    return WorkflowExecutionRequest(
        step=step,
        cell=cell,
        source=source_item,
        revision=_dump_revision(revision),
        parameters=_revision_parameters(revision),
        references={
            **(source_item.references or {}),
            **(step.references or {}),
        },
        links=upstream.get("links"),
        upstream_trace=upstream.get("trace"),
        upstream_outputs=upstream.get("outputs"),
    )


def _failed_cell(cell: PlannedCell, *, message: str) -> PlannedCell:
    return cell.model_copy(
        update={
            "status": EvaluationStatus.FAILURE,
            "error": {"message": message},
        }
    )


def _dump_revision(revision: Any) -> Any:
    if hasattr(revision, "model_dump"):
        return revision.model_dump(mode="json", exclude_none=True)
    return revision


def _revision_parameters(revision: Any) -> Optional[Any]:
    data = getattr(revision, "data", None)
    return getattr(data, "parameters", None) if data else None


def _upstream_for_cell(
    *,
    cell: PlannedCell,
    context_by_repeat: Dict[int, Dict[str, Any]],
) -> Dict[str, Any]:
    context = context_by_repeat.get(cell.repeat_idx) or context_by_repeat.get(0) or {}
    if not context:
        return {}

    trace_id = context.get("trace_id")
    span_id = context.get("span_id")
    links = (
        {
            "invocation": {
                "trace_id": trace_id,
                "span_id": span_id,
            }
        }
        if trace_id and span_id
        else None
    )
    return {
        "links": links,
        "trace": context.get("trace"),
        "outputs": context.get("outputs"),
    }


def _remember_context(
    *,
    cell: PlannedCell,
    #
    context_by_repeat: Dict[int, Dict[str, Any]],
    trace: Optional[Any],
    trace_id: str,
    span_id: Optional[str],
    outputs: Optional[Any],
) -> None:
    # Only the application produces path context; evaluators consume it and must
    # never overwrite a sibling's, so evaluator order stays irrelevant.
    if cell.step_type != "invocation":
        return

    context = {
        "trace": trace,
        "trace_id": trace_id,
        "span_id": span_id,
        "outputs": outputs,
    }
    context_by_repeat[cell.repeat_idx] = context
    if 0 not in context_by_repeat:
        context_by_repeat[0] = context


def _extract_outputs(trace: Any) -> Optional[Any]:
    root_span = _extract_root_span(trace)
    if root_span is None:
        return None
    attributes = (
        root_span.get("attributes", {})
        if isinstance(root_span, dict)
        else getattr(root_span, "attributes", {})
    )
    if hasattr(attributes, "model_dump"):
        attributes = attributes.model_dump(mode="json", exclude_none=True)
    return attributes.get("ag", {}).get("data", {}).get("outputs")


def _extract_root_span(trace: Any) -> Optional[Any]:
    spans = (
        trace.get("spans") if isinstance(trace, dict) else getattr(trace, "spans", None)
    )
    if not spans:
        return None
    root_span = next(iter(spans.values()), None) if isinstance(spans, dict) else None
    if isinstance(root_span, list):
        return None
    return root_span


def _get_trace_id(trace: Any) -> Optional[str]:
    if isinstance(trace, dict):
        return trace.get("trace_id")
    trace_id = getattr(trace, "trace_id", None)
    return str(trace_id) if trace_id else None


def _get_span_id(root_span: Any) -> Optional[str]:
    if root_span is None:
        return None
    span_id = (
        root_span.get("span_id")
        if isinstance(root_span, dict)
        else getattr(root_span, "span_id", None)
    )
    return str(span_id) if span_id else None
