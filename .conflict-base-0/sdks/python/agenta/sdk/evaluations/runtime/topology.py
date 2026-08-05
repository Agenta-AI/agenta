from typing import Iterable, List, Optional

from agenta.sdk.evaluations.runtime.models import (
    Dispatch,
    EvaluationStep,
    TopologyDecision,
)


def _has_reference(step: EvaluationStep, token: str) -> bool:
    if any(token in str(key).lower() for key in step.references.keys()):
        return True
    return token in step.key.lower()


def _input_family(step: EvaluationStep) -> Optional[str]:
    if _has_reference(step, "query"):
        return "query"
    if _has_reference(step, "testset"):
        return "testset"
    if _has_reference(step, "trace"):
        return "trace"
    if _has_reference(step, "testcase"):
        return "testcase"
    return None


def _steps_of_type(
    steps: Iterable[EvaluationStep], step_type: str
) -> List[EvaluationStep]:
    return [step for step in steps if step.type == step_type]


def classify_steps_topology(
    *,
    steps: List[EvaluationStep],
    is_live: bool = False,
    has_queries: bool = False,
    has_testsets: bool = False,
    has_traces: bool = False,
    has_testcases: bool = False,
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
    has_traces = has_traces or "trace" in input_families
    has_testcases = has_testcases or "testcase" in input_families
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
            dispatch=Dispatch(source="query", mode="live"),
        )

    if has_evaluators and not has_applications:
        if has_testcases:
            return TopologyDecision(
                status="supported",
                label="direct testcases -> evaluator",
                reason="direct testcase batches are worker-dispatched",
                dispatch=Dispatch(source="testcase", mode="queue"),
            )
        if has_traces:
            return TopologyDecision(
                status="supported",
                label="direct traces -> evaluator",
                reason="direct trace batches are worker-dispatched",
                dispatch=Dispatch(source="trace", mode="queue"),
            )

    if has_queries and has_applications:
        return TopologyDecision(
            status="not_planned",
            label="query -> application",
            reason=(
                "re-invoking an application over query-sourced traces is not a planned "
                "shape: source trace links cannot be attached as application links "
                "without misclassifying the new application traces as annotations"
            ),
        )

    if has_testsets and has_evaluators and not has_applications:
        return TopologyDecision(
            status="supported",
            label="testset -> evaluator",
            reason="batch testset evaluation with no application is worker-dispatched",
            dispatch=Dispatch(source="testset", mode="batch"),
        )

    if has_queries and has_evaluators and not has_applications:
        return TopologyDecision(
            status="supported",
            label="batch query -> evaluator",
            reason="batch query evaluator runs are worker-dispatched",
            dispatch=Dispatch(source="query", mode="batch"),
        )

    if has_testsets and has_applications and has_evaluators:
        return TopologyDecision(
            status="supported",
            label="testset -> application -> evaluator",
            reason="batch testset evaluation is worker-dispatched",
            dispatch=Dispatch(source="testset", mode="batch"),
        )

    if has_testsets and has_applications and not has_evaluators and not has_queries:
        return TopologyDecision(
            status="supported",
            label="testset -> application",
            reason="batch inference / batch invocation is worker-dispatched",
            dispatch=Dispatch(source="testset", mode="batch"),
        )

    return TopologyDecision(
        status="unsupported",
        label="unsupported evaluation topology",
        reason="no current worker dispatch path matches this evaluation graph",
    )
