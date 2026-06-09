from typing import Dict, Iterable, List, Optional
from uuid import UUID

from oss.src.core.evaluations.runtime.types import (
    EvaluationStep,
    ExecutionPlan,
    PlannedCell,
    ResolvedSourceItem,
    ScenarioBinding,
)
from oss.src.core.evaluations.types import (
    EvaluationResultCreate,
    EvaluationRun,
    EvaluationRunDataStep,
)
from agenta.sdk.evaluations.runtime.planner import (
    EvaluationPlanner as SDKEvaluationPlanner,
)


def _step_inputs(step: EvaluationRunDataStep) -> List[str]:
    return [step_input.key for step_input in (step.inputs or []) if step_input.key]


def normalize_steps(
    steps: Optional[Iterable[EvaluationRunDataStep]],
) -> List[EvaluationStep]:
    return [
        EvaluationStep(
            key=step.key,
            type=step.type,
            origin=step.origin,
            #
            references=step.references or {},
            #
            inputs=_step_inputs(step),
        )
        for step in (steps or [])
    ]


def make_scenario_bindings(
    *,
    scenario_ids: List[UUID],
    #
    source_items: List[ResolvedSourceItem],
) -> List[ScenarioBinding]:
    if len(scenario_ids) != len(source_items):
        raise ValueError("scenario_ids and source_items must have the same length")

    return [
        ScenarioBinding(scenario_id=scenario_id, source=source_item)
        for scenario_id, source_item in zip(scenario_ids, source_items)
    ]


class EvaluationPlanner:
    """Backend entry to the SDK-owned runtime planner.

    The runtime types (`EvaluationStep`, `ScenarioBinding`, `ExecutionPlan`,
    `PlannedCell`) are the SDK's own — the API imports them directly — so the
    SDK plan is returned as-is; no DTO conversion is needed.
    """

    def plan(
        self,
        *,
        run: EvaluationRun,
        #
        bindings: List[ScenarioBinding],
    ) -> ExecutionPlan:
        if not run.id:
            raise ValueError("run.id is required")

        steps = normalize_steps(run.data.steps if run.data else None)
        flags = run.flags

        return SDKEvaluationPlanner().plan_bindings(
            run_id=run.id,
            #
            steps=steps,
            repeats=run.data.repeats if run.data else None,
            #
            bindings=bindings,
            #
            is_split=bool(flags and flags.is_split),
            is_live=bool(flags and flags.is_live),
            #
            has_traces=bool(flags and flags.has_traces),
            has_testcases=bool(flags and flags.has_testcases),
        )


def index_cells_by_slot(
    plan: ExecutionPlan,
) -> Dict[tuple[UUID, str, int], PlannedCell]:
    return {
        (cell.scenario_id, cell.step_key, cell.repeat_idx): cell for cell in plan.cells
    }


def planned_cells_to_result_creates(
    cells: Iterable[PlannedCell],
) -> List[EvaluationResultCreate]:
    return [
        EvaluationResultCreate(
            run_id=cell.run_id,
            #
            scenario_id=cell.scenario_id,
            step_key=cell.step_key,
            repeat_idx=cell.repeat_idx,
            #
            status=cell.status,
            #
            trace_id=cell.trace_id,
            testcase_id=cell.testcase_id,
            error=cell.error,
        )
        for cell in cells
    ]


def plan_source_input_result_creates(
    *,
    run: EvaluationRun,
    #
    scenario_id: UUID,
    #
    source_item: ResolvedSourceItem,
) -> List[EvaluationResultCreate]:
    plan = EvaluationPlanner().plan(
        run=run,
        #
        bindings=make_scenario_bindings(
            scenario_ids=[scenario_id],
            source_items=[source_item],
        ),
    )
    return planned_cells_to_result_creates(
        cell
        for cell in plan.cells
        if cell.step_type == "input" and cell.step_key == source_item.step_key
    )
