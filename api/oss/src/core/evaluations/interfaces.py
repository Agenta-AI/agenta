from typing import Optional, List
from uuid import UUID
from abc import ABC, abstractmethod

from oss.src.core.shared.dtos import Windowing
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


class EvaluationsDAOInterface(ABC):
    def __init__(
        self,
    ):
        raise NotImplementedError

    # - EVALUATION RUN ---------------------------------------------------------

    @abstractmethod
    async def create_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run: EvaluationRunCreate,
    ) -> Optional[EvaluationRun]:
        raise NotImplementedError

    @abstractmethod
    async def create_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        runs: List[EvaluationRunCreate],
    ) -> List[EvaluationRun]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_run(
        self,
        *,
        project_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_runs(
        self,
        *,
        project_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[EvaluationRun]:
        raise NotImplementedError

    @abstractmethod
    async def edit_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run: EvaluationRunEdit,
    ) -> Optional[EvaluationRun]:
        raise NotImplementedError

    @abstractmethod
    async def edit_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        runs: List[EvaluationRunEdit],
    ) -> List[EvaluationRun]:
        raise NotImplementedError

    @abstractmethod
    async def delete_run(
        self,
        *,
        project_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[UUID]:
        raise NotImplementedError

    @abstractmethod
    async def delete_runs(
        self,
        *,
        project_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[UUID]:
        raise NotImplementedError

    @abstractmethod
    async def archive_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        raise NotImplementedError

    @abstractmethod
    async def archive_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_ids: Optional[List[UUID]] = None,
    ) -> List[EvaluationRun]:
        raise NotImplementedError

    @abstractmethod
    async def unarchive_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        raise NotImplementedError

    @abstractmethod
    async def unarchive_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_ids: Optional[List[UUID]] = None,
    ) -> List[EvaluationRun]:
        raise NotImplementedError

    @abstractmethod
    async def close_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        raise NotImplementedError

    @abstractmethod
    async def close_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[UUID]:
        raise NotImplementedError

    @abstractmethod
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
        raise NotImplementedError

    # - EVALUATION SCENARIO ----------------------------------------------------

    @abstractmethod
    async def create_scenario(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        scenario: EvaluationScenarioCreate,
    ) -> Optional[EvaluationScenario]:
        raise NotImplementedError

    @abstractmethod
    async def create_scenarios(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        scenarios: List[EvaluationScenarioCreate],
    ) -> List[EvaluationScenario]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_scenario(
        self,
        *,
        project_id: UUID,
        #
        scenario_id: UUID,
    ) -> Optional[EvaluationScenario]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_scenarios(
        self,
        *,
        project_id: UUID,
        #
        scenario_ids: List[UUID],
    ) -> List[EvaluationScenario]:
        raise NotImplementedError

    @abstractmethod
    async def edit_scenario(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        scenario: EvaluationScenarioEdit,
    ) -> Optional[EvaluationScenario]:
        raise NotImplementedError

    @abstractmethod
    async def edit_scenarios(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        scenarios: List[EvaluationScenarioEdit],
    ) -> List[EvaluationScenario]:
        raise NotImplementedError

    @abstractmethod
    async def delete_scenario(
        self,
        *,
        project_id: UUID,
        #
        scenario_id: UUID,
    ) -> Optional[UUID]:
        raise NotImplementedError

    @abstractmethod
    async def delete_scenarios(
        self,
        *,
        project_id: UUID,
        #
        scenario_ids: List[UUID],
    ) -> List[UUID]:
        raise NotImplementedError

    @abstractmethod
    async def query_scenarios(
        self,
        *,
        project_id: UUID,
        #
        scenario: EvaluationScenarioQuery,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationScenario]:
        raise NotImplementedError

    # - EVALUATION STEP --------------------------------------------------------

    @abstractmethod
    async def create_step(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        step: EvaluationStepCreate,
    ) -> Optional[EvaluationStep]:
        raise NotImplementedError

    @abstractmethod
    async def create_steps(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        steps: List[EvaluationStepCreate],
    ) -> List[EvaluationStep]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_step(
        self,
        *,
        project_id: UUID,
        #
        step_id: UUID,
    ) -> Optional[EvaluationStep]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_steps(
        self,
        *,
        project_id: UUID,
        #
        step_ids: List[UUID],
    ) -> List[EvaluationStep]:
        raise NotImplementedError

    @abstractmethod
    async def edit_step(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        step: EvaluationStepEdit,
    ) -> Optional[EvaluationStep]:
        raise NotImplementedError

    @abstractmethod
    async def edit_steps(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        steps: List[EvaluationStepEdit],
    ) -> List[EvaluationStep]:
        raise NotImplementedError

    @abstractmethod
    async def delete_step(
        self,
        *,
        project_id: UUID,
        #
        step_id: UUID,
    ) -> Optional[UUID]:
        raise NotImplementedError

    @abstractmethod
    async def delete_steps(
        self,
        *,
        project_id: UUID,
        #
        step_ids: List[UUID],
    ) -> List[UUID]:
        raise NotImplementedError

    @abstractmethod
    async def query_steps(
        self,
        *,
        project_id: UUID,
        #
        step: EvaluationStepQuery,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationStep]:
        raise NotImplementedError

    # - EVALUATION METRIC -----------------------------------------------------

    @abstractmethod
    async def create_metric(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metric: EvaluationMetricCreate,
    ) -> Optional[EvaluationMetric]:
        raise NotImplementedError

    @abstractmethod
    async def create_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metrics: List[EvaluationMetricCreate],
    ) -> List[EvaluationMetric]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_metric(
        self,
        *,
        project_id: UUID,
        #
        metric_id: UUID,
    ) -> Optional[EvaluationMetric]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_metrics(
        self,
        *,
        project_id: UUID,
        #
        metric_ids: List[UUID],
    ) -> List[EvaluationMetric]:
        raise NotImplementedError

    @abstractmethod
    async def edit_metric(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metric: EvaluationMetricEdit,
    ) -> Optional[EvaluationMetric]:
        raise NotImplementedError

    @abstractmethod
    async def edit_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metrics: List[EvaluationMetricEdit],
    ) -> List[EvaluationMetric]:
        raise NotImplementedError

    @abstractmethod
    async def delete_metric(
        self,
        *,
        project_id: UUID,
        #
        metric_id: UUID,
    ) -> Optional[UUID]:
        raise NotImplementedError

    @abstractmethod
    async def delete_metrics(
        self,
        *,
        project_id: UUID,
        #
        metric_ids: Optional[List[UUID]] = None,
    ) -> List[UUID]:
        raise NotImplementedError

    @abstractmethod
    async def query_metrics(
        self,
        *,
        project_id: UUID,
        #
        metric: EvaluationMetricQuery,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationMetric]:
        raise NotImplementedError

    # --------------------------------------------------------------------------
