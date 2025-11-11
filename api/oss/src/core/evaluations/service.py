from typing import List, Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import Windowing
from oss.src.core.evaluations.interfaces import EvaluationsDAOInterface
from oss.src.core.evaluations.types import EvaluationRunFlags
from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunCreate,
    EvaluationRunEdit,
    EvaluationRunQuery,
    EvaluationScenario,
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationScenarioQuery,
    EvaluationStep,
    EvaluationStepCreate,
    EvaluationStepEdit,
    EvaluationStepQuery,
    EvaluationMetric,
    EvaluationMetricCreate,
    EvaluationMetricEdit,
    EvaluationMetricQuery,
)


log = get_module_logger(__name__)


class EvaluationsService:
    def __init__(
        self,
        evaluations_dao: EvaluationsDAOInterface,
    ):
        self.evaluations_dao = evaluations_dao

    ### CRUD

    # - EVALUATION RUN ---------------------------------------------------------

    async def create_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run: EvaluationRunCreate,
    ) -> Optional[EvaluationRun]:
        return await self.evaluations_dao.create_run(
            project_id=project_id,
            user_id=user_id,
            #
            run=run,
        )

    async def create_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        runs: List[EvaluationRunCreate],
    ) -> List[EvaluationRun]:
        return await self.evaluations_dao.create_runs(
            project_id=project_id,
            user_id=user_id,
            #
            runs=runs,
        )

    async def fetch_run(
        self,
        *,
        project_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        return await self.evaluations_dao.fetch_run(
            project_id=project_id,
            #
            run_id=run_id,
        )

    async def fetch_runs(
        self,
        *,
        project_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[EvaluationRun]:
        return await self.evaluations_dao.fetch_runs(
            project_id=project_id,
            #
            run_ids=run_ids,
        )

    async def edit_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run: EvaluationRunEdit,
    ) -> Optional[EvaluationRun]:
        return await self.evaluations_dao.edit_run(
            project_id=project_id,
            user_id=user_id,
            #
            run=run,
        )

    async def edit_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        runs: List[EvaluationRunEdit],
    ) -> List[EvaluationRun]:
        return await self.evaluations_dao.edit_runs(
            project_id=project_id,
            user_id=user_id,
            #
            runs=runs,
        )

    async def delete_run(
        self,
        *,
        project_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[UUID]:
        return await self.evaluations_dao.delete_run(
            project_id=project_id,
            #
            run_id=run_id,
        )

    async def delete_runs(
        self,
        *,
        project_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[UUID]:
        return await self.evaluations_dao.delete_runs(
            project_id=project_id,
            #
            run_ids=run_ids,
        )

    async def archive_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        return await self.evaluations_dao.archive_run(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=run_id,
        )

    async def archive_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[EvaluationRun]:
        return await self.evaluations_dao.archive_runs(
            project_id=project_id,
            user_id=user_id,
            #
            run_ids=run_ids,
        )

    async def unarchive_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        return await self.evaluations_dao.unarchive_run(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=run_id,
        )

    async def unarchive_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[EvaluationRun]:
        return await self.evaluations_dao.unarchive_runs(
            project_id=project_id,
            user_id=user_id,
            #
            run_ids=run_ids,
        )

    async def close_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        return await self.evaluations_dao.close_run(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=run_id,
        )

    async def close_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[EvaluationRun]:
        return await self.evaluations_dao.close_runs(
            project_id=project_id,
            user_id=user_id,
            #
            run_ids=run_ids,
        )

    async def query_runs(
        self,
        *,
        project_id: UUID,
        #
        run: EvaluationRunQuery,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationRun]:
        return await self.evaluations_dao.query_runs(
            project_id=project_id,
            #
            run=run,
            #
            include_archived=include_archived,
            #
            windowing=windowing,
        )

    # - EVALUATION SCENARIO ----------------------------------------------------

    async def create_scenario(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        scenario: EvaluationScenarioCreate,
    ) -> Optional[EvaluationScenario]:
        return await self.evaluations_dao.create_scenario(
            project_id=project_id,
            user_id=user_id,
            #
            scenario=scenario,
        )

    async def create_scenarios(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        scenarios: List[EvaluationScenarioCreate],
    ) -> List[EvaluationScenario]:
        return await self.evaluations_dao.create_scenarios(
            project_id=project_id,
            user_id=user_id,
            #
            scenarios=scenarios,
        )

    async def fetch_scenario(
        self,
        *,
        project_id: UUID,
        #
        scenario_id: UUID,
    ) -> Optional[EvaluationScenario]:
        return await self.evaluations_dao.fetch_scenario(
            project_id=project_id,
            #
            scenario_id=scenario_id,
        )

    async def fetch_scenarios(
        self,
        *,
        project_id: UUID,
        #
        scenario_ids: List[UUID],
    ) -> List[EvaluationScenario]:
        return await self.evaluations_dao.fetch_scenarios(
            project_id=project_id,
            #
            scenario_ids=scenario_ids,
        )

    async def edit_scenario(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        scenario: EvaluationScenarioEdit,
    ) -> Optional[EvaluationScenario]:
        return await self.evaluations_dao.edit_scenario(
            project_id=project_id,
            user_id=user_id,
            #
            scenario=scenario,
        )

    async def edit_scenarios(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        scenarios: List[EvaluationScenarioEdit],
    ) -> List[EvaluationScenario]:
        return await self.evaluations_dao.edit_scenarios(
            project_id=project_id,
            user_id=user_id,
            #
            scenarios=scenarios,
        )

    async def delete_scenario(
        self,
        *,
        project_id: UUID,
        #
        scenario_id: UUID,
    ) -> Optional[UUID]:
        return await self.evaluations_dao.delete_scenario(
            project_id=project_id,
            #
            scenario_id=scenario_id,
        )

    async def delete_scenarios(
        self,
        *,
        project_id: UUID,
        scenario_ids: List[UUID],
    ) -> List[UUID]:
        return await self.evaluations_dao.delete_scenarios(
            project_id=project_id,
            scenario_ids=scenario_ids,
        )

    async def query_scenarios(
        self,
        *,
        project_id: UUID,
        #
        scenario: EvaluationScenarioQuery,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationScenario]:
        return await self.evaluations_dao.query_scenarios(
            project_id=project_id,
            #
            scenario=scenario,
            #
            windowing=windowing,
        )

    # - EVALUATION STEP --------------------------------------------------------

    async def create_step(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        step: EvaluationStepCreate,
    ) -> Optional[EvaluationStep]:
        return await self.evaluations_dao.create_step(
            project_id=project_id,
            user_id=user_id,
            #
            step=step,
        )

    async def create_steps(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        steps: List[EvaluationStepCreate],
    ) -> List[EvaluationStep]:
        return await self.evaluations_dao.create_steps(
            project_id=project_id,
            user_id=user_id,
            #
            steps=steps,
        )

    async def fetch_step(
        self,
        *,
        project_id: UUID,
        #
        step_id: UUID,
    ) -> Optional[EvaluationStep]:
        return await self.evaluations_dao.fetch_step(
            project_id=project_id,
            #
            step_id=step_id,
        )

    async def fetch_steps(
        self,
        *,
        project_id: UUID,
        #
        step_ids: List[UUID],
    ) -> List[EvaluationStep]:
        return await self.evaluations_dao.fetch_steps(
            project_id=project_id,
            #
            step_ids=step_ids,
        )

    async def edit_step(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        step: EvaluationStepEdit,
    ) -> Optional[EvaluationStep]:
        return await self.evaluations_dao.edit_step(
            project_id=project_id,
            user_id=user_id,
            #
            step=step,
        )

    async def edit_steps(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        steps: List[EvaluationStepEdit],
    ) -> List[EvaluationStep]:
        return await self.evaluations_dao.edit_steps(
            project_id=project_id,
            user_id=user_id,
            #
            steps=steps,
        )

    async def delete_step(
        self,
        *,
        project_id: UUID,
        #
        step_id: UUID,
    ) -> Optional[UUID]:
        return await self.evaluations_dao.delete_step(
            project_id=project_id,
            #
            step_id=step_id,
        )

    async def delete_steps(
        self,
        *,
        project_id: UUID,
        #
        step_ids: List[UUID],
    ) -> List[UUID]:
        return await self.evaluations_dao.delete_steps(
            project_id=project_id,
            #
            step_ids=step_ids,
        )

    async def query_steps(
        self,
        *,
        project_id: UUID,
        #
        step: EvaluationStepQuery,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationStep]:
        return await self.evaluations_dao.query_steps(
            project_id=project_id,
            #
            step=step,
            #
            windowing=windowing,
        )

    # - EVALUATION METRIC ------------------------------------------------------

    async def create_metric(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metric: EvaluationMetricCreate,
    ) -> Optional[EvaluationMetric]:
        return await self.evaluations_dao.create_metric(
            project_id=project_id,
            user_id=user_id,
            #
            metric=metric,
        )

    async def create_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metrics: List[EvaluationMetricCreate],
    ) -> List[EvaluationMetric]:
        return await self.evaluations_dao.create_metrics(
            project_id=project_id,
            user_id=user_id,
            #
            metrics=metrics,
        )

    async def fetch_metric(
        self,
        *,
        project_id: UUID,
        #
        metric_id: UUID,
    ) -> Optional[EvaluationMetric]:
        return await self.evaluations_dao.fetch_metric(
            project_id=project_id,
            #
            metric_id=metric_id,
        )

    async def fetch_metrics(
        self,
        *,
        project_id: UUID,
        #
        metric_ids: List[UUID],
    ) -> List[EvaluationMetric]:
        return await self.evaluations_dao.fetch_metrics(
            project_id=project_id,
            #
            metric_ids=metric_ids,
        )

    async def edit_metric(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metric: EvaluationMetricEdit,
    ) -> Optional[EvaluationMetric]:
        return await self.evaluations_dao.edit_metric(
            project_id=project_id,
            user_id=user_id,
            #
            metric=metric,
        )

    async def edit_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metrics: List[EvaluationMetricEdit],
    ) -> List[EvaluationMetric]:
        return await self.evaluations_dao.edit_metrics(
            project_id=project_id,
            user_id=user_id,
            #
            metrics=metrics,
        )

    async def delete_metric(
        self,
        *,
        project_id: UUID,
        #
        metric_id: UUID,
    ) -> Optional[UUID]:
        return await self.evaluations_dao.delete_metric(
            project_id=project_id,
            #
            metric_id=metric_id,
        )

    async def delete_metrics(
        self,
        *,
        project_id: UUID,
        #
        metric_ids: List[UUID],
    ) -> List[UUID]:
        return await self.evaluations_dao.delete_metrics(
            project_id=project_id,
            #
            metric_ids=metric_ids,
        )

    async def query_metrics(
        self,
        *,
        project_id: UUID,
        #
        metric: EvaluationMetricQuery,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationMetric]:
        return await self.evaluations_dao.query_metrics(
            project_id=project_id,
            #
            metric=metric,
            #
            windowing=windowing,
        )

    # --------------------------------------------------------------------------
