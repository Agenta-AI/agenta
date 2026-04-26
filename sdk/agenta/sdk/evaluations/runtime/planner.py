from typing import List, Optional
from uuid import UUID

from agenta.sdk.evaluations.runtime.models import (
    EvaluationStep,
    ExecutionPlan,
    PlannedCell,
    ResolvedSourceItem,
    ScenarioBinding,
)
from agenta.sdk.models.evaluations import EvaluationStatus


def build_repeat_indices(repeats: Optional[int]) -> List[int]:
    count = repeats or 1
    if count < 1:
        count = 1
    return list(range(count))


def effective_is_split(
    *,
    is_split: bool,
    is_live: bool = False,
    is_queue: bool = False,
    has_application_steps: bool = False,
    has_evaluator_steps: bool = False,
) -> bool:
    if is_live or is_queue:
        return False
    if not has_application_steps or not has_evaluator_steps:
        return False
    return is_split


class EvaluationPlanner:
    """Build the evaluation result tensor without knowing how steps execute."""

    def plan(
        self,
        *,
        run_id: UUID,
        scenario_id: UUID,
        source: ResolvedSourceItem,
        steps: List[EvaluationStep],
        repeats: Optional[int] = None,
        is_split: bool = False,
        is_live: bool = False,
        is_queue: bool = False,
    ) -> ExecutionPlan:
        return self.plan_bindings(
            run_id=run_id,
            bindings=[
                ScenarioBinding(
                    scenario_id=scenario_id,
                    source=source,
                )
            ],
            steps=steps,
            repeats=repeats,
            is_split=is_split,
            is_live=is_live,
            is_queue=is_queue,
        )

    def plan_bindings(
        self,
        *,
        run_id: UUID,
        bindings: List[ScenarioBinding],
        steps: List[EvaluationStep],
        repeats: Optional[int] = None,
        is_split: bool = False,
        is_live: bool = False,
        is_queue: bool = False,
    ) -> ExecutionPlan:
        repeat_indices = build_repeat_indices(repeats)

        input_steps = [step for step in steps if step.type == "input"]
        application_steps = [step for step in steps if step.type == "invocation"]
        evaluator_steps = [step for step in steps if step.type == "annotation"]
        app_repeat_indices = self._application_repeat_indices(
            repeat_indices=repeat_indices,
            is_split=is_split,
            is_live=is_live,
            is_queue=is_queue,
            has_application_steps=bool(application_steps),
            has_evaluator_steps=bool(evaluator_steps),
        )

        cells: List[PlannedCell] = []

        for binding in bindings:
            source = binding.source

            for step in input_steps:
                cells.extend(
                    PlannedCell(
                        run_id=run_id,
                        scenario_id=binding.scenario_id,
                        step_key=step.key,
                        step_type=step.type,
                        origin=step.origin,
                        repeat_idx=repeat_idx,
                        status=EvaluationStatus.SUCCESS,
                        trace_id=source.trace_id,
                        span_id=source.span_id,
                        testcase_id=source.testcase_id,
                    )
                    for repeat_idx in repeat_indices
                )

            for step in application_steps:
                cells.extend(
                    self._runnable_cells(
                        run_id=run_id,
                        scenario_id=binding.scenario_id,
                        source=source,
                        step=step,
                        repeat_indices=app_repeat_indices,
                    )
                )

            for step in evaluator_steps:
                cells.extend(
                    self._runnable_cells(
                        run_id=run_id,
                        scenario_id=binding.scenario_id,
                        source=source,
                        step=step,
                        repeat_indices=repeat_indices,
                    )
                )

        return ExecutionPlan(run_id=run_id, cells=cells)

    def _application_repeat_indices(
        self,
        *,
        repeat_indices: List[int],
        is_split: bool,
        is_live: bool,
        is_queue: bool,
        has_application_steps: bool,
        has_evaluator_steps: bool,
    ) -> List[int]:
        split = effective_is_split(
            is_split=is_split,
            is_live=is_live,
            is_queue=is_queue,
            has_application_steps=has_application_steps,
            has_evaluator_steps=has_evaluator_steps,
        )

        if not has_application_steps:
            return []
        if not has_evaluator_steps:
            return repeat_indices
        if split:
            return repeat_indices
        return [0]

    def _runnable_cells(
        self,
        *,
        run_id: UUID,
        scenario_id: UUID,
        source: ResolvedSourceItem,
        step: EvaluationStep,
        repeat_indices: List[int],
    ) -> List[PlannedCell]:
        is_manual_annotation = step.type == "annotation" and step.origin in {
            "human",
            "custom",
        }
        status = (
            EvaluationStatus.PENDING
            if is_manual_annotation
            else EvaluationStatus.QUEUED
        )

        return [
            PlannedCell(
                run_id=run_id,
                scenario_id=scenario_id,
                step_key=step.key,
                step_type=step.type,
                origin=step.origin,
                repeat_idx=repeat_idx,
                status=status,
                should_execute=not is_manual_annotation,
                testcase_id=source.testcase_id,
            )
            for repeat_idx in repeat_indices
        ]
