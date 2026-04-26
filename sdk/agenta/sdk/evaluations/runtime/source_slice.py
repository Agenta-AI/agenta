from typing import Any, Awaitable, Callable, Dict, List, Mapping, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from agenta.sdk.evaluations.runtime.execution import (
    ResultLogger,
    TraceLoader,
    execute_workflow_batch,
)
from agenta.sdk.evaluations.runtime.models import (
    EvaluationStep,
    PlannedCell,
    ResolvedSourceItem,
    ResultLogRequest,
    WorkflowExecutionRequest,
)
from agenta.sdk.evaluations.runtime.planner import EvaluationPlanner


class ProcessedScenario(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    scenario: Any
    results: Dict[str, Any] = Field(default_factory=dict)
    metrics: Optional[Any] = None
    has_pending: bool = False
    has_errors: bool = False
    auto_results_created: bool = False


CreateScenario = Callable[[UUID], Awaitable[Any]]
RefreshMetrics = Callable[[UUID, Optional[UUID]], Awaitable[Any]]


async def process_evaluation_source_slice(
    *,
    run_id: UUID,
    source_items: List[ResolvedSourceItem],
    steps: List[EvaluationStep],
    repeats: Optional[int],
    create_scenario: CreateScenario,
    result_logger: ResultLogger,
    refresh_metrics: RefreshMetrics,
    runners: Mapping[str, Any],
    revisions: Mapping[str, Any],
    trace_loader: Optional[TraceLoader] = None,
    is_split: bool = False,
    log_pending: bool = True,
    refresh_metrics_without_auto_results: bool = True,
) -> List[ProcessedScenario]:
    """Process concrete source items through the SDK-owned runtime contract.

    The function is runner/persistence agnostic. SDK preview uses local
    decorator runners and API result logging; backend code can move to this
    shape by supplying backend DAO/workflow adapters.
    """
    processed: List[ProcessedScenario] = []

    for source_item in source_items:
        scenario = await create_scenario(run_id)
        scenario_id = scenario.id
        plan = EvaluationPlanner().plan(
            run_id=run_id,
            scenario_id=scenario_id,
            source=source_item,
            steps=steps,
            repeats=repeats,
            is_split=is_split,
        )
        results: Dict[str, Any] = {}
        context_by_repeat = _initial_context_by_repeat(
            source_item=source_item,
            repeats=repeats,
        )
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
                results[cell.step_key] = await result_logger.log(
                    ResultLogRequest(
                        cell=cell,
                        testcase_id=source_item.testcase_id,
                        trace_id=source_item.trace_id,
                    )
                )
                idx += 1
                continue

            if not cell.should_execute:
                scenario_has_pending = True
                if log_pending:
                    results[cell.step_key] = await result_logger.log(
                        ResultLogRequest(cell=cell)
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
                for batch_cell in batch_cells:
                    scenario_has_errors = True
                    results[batch_cell.step_key] = await result_logger.log(
                        ResultLogRequest(
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
                        )
                    )
                idx += len(batch_cells)
                continue

            requests = [
                _build_execution_request(
                    cell=batch_cell,
                    step=step,
                    source_item=source_item,
                    revision=revision,
                    context_by_repeat=context_by_repeat,
                )
                for batch_cell in batch_cells
            ]

            executions = await execute_workflow_batch(
                runner=runner,
                requests=requests,
            )
            for batch_cell, execution in zip(batch_cells, executions):
                if trace_loader and execution.trace_id and execution.trace is None:
                    execution.trace = await trace_loader.load(str(execution.trace_id))
                if execution.outputs is None and execution.trace is not None:
                    execution.outputs = _extract_outputs(execution.trace)

                results[batch_cell.step_key] = await result_logger.log(
                    ResultLogRequest(
                        cell=batch_cell,
                        trace_id=execution.trace_id,
                        span_id=execution.span_id,
                        testcase_id=source_item.testcase_id,
                        error=execution.error,
                    )
                )
                scenario_auto_results_created = True
                if execution.error or str(execution.status) in {
                    "failure",
                    "EvaluationStatus.FAILURE",
                    "errors",
                    "EvaluationStatus.ERRORS",
                }:
                    scenario_has_errors = True

                if execution.trace_id:
                    _remember_context(
                        cell=batch_cell,
                        context_by_repeat=context_by_repeat,
                        trace=execution.trace,
                        trace_id=str(execution.trace_id),
                        span_id=execution.span_id,
                        outputs=execution.outputs,
                    )

            idx += len(batch_cells)

        metrics = None
        if refresh_metrics_without_auto_results or scenario_auto_results_created:
            metrics = await refresh_metrics(run_id, scenario_id)
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

    if processed and (
        refresh_metrics_without_auto_results
        or any(item.auto_results_created for item in processed)
    ):
        await refresh_metrics(run_id, None)

    return processed


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
    context_by_repeat: Dict[int, Dict[str, Any]],
    trace: Optional[Any],
    trace_id: str,
    span_id: Optional[str],
    outputs: Optional[Any],
) -> None:
    context = {
        "trace": trace,
        "trace_id": trace_id,
        "span_id": span_id,
        "outputs": outputs,
    }
    context_by_repeat[cell.repeat_idx] = context
    if cell.step_type == "invocation" and 0 not in context_by_repeat:
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
