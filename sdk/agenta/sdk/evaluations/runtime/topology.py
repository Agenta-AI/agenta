from typing import Iterable, List, Optional

from agenta.sdk.evaluations.runtime.models import EvaluationStep, TopologyDecision


def _has_reference(step: EvaluationStep, token: str) -> bool:
    if any(token in str(key).lower() for key in step.references.keys()):
        return True
    return token in step.key.lower()


def _input_family(step: EvaluationStep) -> Optional[str]:
    if _has_reference(step, "query"):
        return "query"
    if _has_reference(step, "testset") or _has_reference(step, "testcase"):
        return "testset"
    if _has_reference(step, "trace"):
        return "trace"
    return None


def _steps_of_type(
    steps: Iterable[EvaluationStep], step_type: str
) -> List[EvaluationStep]:
    return [step for step in steps if step.type == step_type]


def classify_steps_topology(
    *,
    steps: List[EvaluationStep],
    is_live: bool = False,
    is_queue: bool = False,
    has_queries: bool = False,
    has_testsets: bool = False,
    has_evaluators: bool = False,
) -> TopologyDecision:
    input_steps = _steps_of_type(steps, "input")
    application_steps = _steps_of_type(steps, "invocation")
    evaluator_steps = _steps_of_type(steps, "annotation")

    input_families = {
        family for family in (_input_family(step) for step in input_steps) if family
    }
    has_queries = has_queries or "query" in input_families
    has_testsets = has_testsets or "testset" in input_families
    has_traces = "trace" in input_families
    has_applications = bool(application_steps)
    has_evaluators = has_evaluators or bool(evaluator_steps)

    if has_queries and has_testsets:
        return TopologyDecision(
            status="not_planned",
            label="mixed query and testset sources",
            reason="mixed query and testset source families in one run are not planned",
        )

    if is_live and has_testsets:
        return TopologyDecision(
            status="not_planned",
            label="live testset evaluation",
            reason="live testset evaluation is not a meaningful product shape",
        )

    if len(application_steps) > 1:
        return TopologyDecision(
            status="not_planned",
            label="multiple application steps",
            reason="A/B application comparisons should use separate evaluations",
        )

    if is_live and has_queries and has_evaluators and not has_applications:
        return TopologyDecision(
            status="supported",
            label="live query -> evaluator",
            reason="live query evaluator runs keep scheduler/windowing behavior",
            dispatch="live_query",
        )

    if is_queue and has_evaluators and not has_applications:
        if has_testsets:
            return TopologyDecision(
                status="supported",
                label="queue testcases -> evaluator",
                reason="queue testcase batches are worker-dispatched",
                dispatch="queue_testcases",
            )
        if has_queries or has_traces:
            return TopologyDecision(
                status="supported",
                label="queue traces -> evaluator",
                reason="queue trace batches are worker-dispatched",
                dispatch="queue_traces",
            )

    if has_queries and has_applications:
        return TopologyDecision(
            status="potential",
            label="query -> application",
            reason=(
                "query traces can seed application calls, but source trace links must "
                "not be attached as application links because that would classify the "
                "new application traces as annotations"
            ),
        )

    if has_testsets and has_evaluators and not has_applications and not is_queue:
        return TopologyDecision(
            status="potential",
            label="testset -> evaluator",
            reason="non-queue testcase-only evaluator execution needs an explicit evaluator contract",
        )

    if has_queries and has_evaluators and not has_applications:
        return TopologyDecision(
            status="supported",
            label="batch query -> evaluator",
            reason="batch query evaluator runs are worker-dispatched",
            dispatch="batch_query",
        )

    if has_testsets and has_applications and has_evaluators:
        return TopologyDecision(
            status="supported",
            label="testset -> application -> evaluator",
            reason="batch testset evaluation is worker-dispatched",
            dispatch="batch_testset",
        )

    if has_testsets and has_applications and not has_evaluators and not has_queries:
        return TopologyDecision(
            status="supported",
            label="testset -> application",
            reason="batch inference / batch invocation is worker-dispatched",
            dispatch="batch_invocation",
        )

    return TopologyDecision(
        status="unsupported",
        label="unsupported evaluation topology",
        reason="no current worker dispatch path matches this evaluation graph",
    )
