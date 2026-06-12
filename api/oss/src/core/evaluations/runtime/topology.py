from agenta.sdk.evaluations.runtime.topology import classify_steps_topology

from oss.src.core.evaluations.runtime.planner import normalize_steps
from oss.src.core.evaluations.runtime.types import Dispatch, TopologyDecision
from oss.src.core.evaluations.types import EvaluationRun


def classify_run_topology(run: EvaluationRun) -> TopologyDecision:
    """Classify the current evaluation graph for worker dispatch.

    This is intentionally conservative. It mirrors the currently supported
    worker-dispatched topologies while naming future-interest and not-planned
    shapes explicitly.
    """

    steps = run.data.steps if run.data and run.data.steps else []
    flags = run.flags

    decision = classify_steps_topology(
        steps=normalize_steps(steps),
        #
        is_live=bool(flags and flags.is_live),
        has_queries=bool(flags and flags.has_queries),
        has_testsets=bool(flags and flags.has_testsets),
        has_traces=bool(flags and flags.has_traces),
        has_testcases=bool(flags and flags.has_testcases),
        has_evaluators=bool(flags and flags.has_evaluators),
    )

    return TopologyDecision(
        status=decision.status,
        label=decision.label,
        reason=decision.reason,
        dispatch=(
            Dispatch(source=decision.dispatch.source, mode=decision.dispatch.mode)
            if decision.dispatch
            else None
        ),
    )
