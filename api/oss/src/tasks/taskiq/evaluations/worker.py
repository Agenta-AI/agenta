from typing import Any, Dict, List, Optional
from uuid import UUID
from datetime import datetime

from taskiq import AsyncBroker

from oss.src.apis.fastapi.tracing.router import TracingRouter
from oss.src.apis.fastapi.testsets.router import SimpleTestsetsRouter
from oss.src.apis.fastapi.evaluators.router import SimpleEvaluatorsRouter

from oss.src.core.queries.service import QueriesService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluations.service import EvaluationsService

from oss.src.core.evaluations.tasks.legacy import (
    evaluate_batch_testset as evaluate_batch_testset_impl,
)
from oss.src.core.evaluations.tasks.live import (
    evaluate_live_query as evaluate_live_query_impl,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class EvaluationsWorker:
    """
    Worker class for evaluation tasks.

    This class registers evaluation tasks with the Taskiq broker,
    following the same dependency injection pattern as FastAPI routers.
    """

    def __init__(
        self,
        *,
        broker: AsyncBroker,
        #
        tracing_router: TracingRouter,
        simple_testsets_router: SimpleTestsetsRouter,
        simple_evaluators_router: SimpleEvaluatorsRouter,
        #
        queries_service: QueriesService,
        workflows_service: WorkflowsService,
        evaluations_service: EvaluationsService,
    ):
        """
        Initialize the evaluations worker.

        Args:
            broker: The Taskiq broker to register tasks with
        """
        self.broker = broker
        #
        self.tracing_router = tracing_router
        self.simple_testsets_router = simple_testsets_router
        self.simple_evaluators_router = simple_evaluators_router
        #
        self.queries_service = queries_service
        self.workflows_service = workflows_service
        self.evaluations_service = evaluations_service

        self._register_tasks()

    def _register_tasks(self):
        """Register all evaluation tasks with the broker."""

        @self.broker.task(task_name="evaluations.legacy.annotate")
        async def evaluate_batch_testset(
            *,
            project_id: UUID,
            user_id: UUID,
            #
            run_id: UUID,
            #
            testset_id: str,
            revision_id: str,
            autoeval_ids: Optional[List[str]],
            #
            run_config: Dict[str, int],
        ) -> Any:
            """Legacy annotation task - wraps the existing annotate function."""
            log.info(
                "[TASK] Starting evaluate_batch_testset",
                project_id=str(project_id),
                user_id=str(user_id),
            )

            # Call the async annotate function directly
            result = await evaluate_batch_testset_impl(
                project_id=project_id,
                user_id=user_id,
                #
                run_id=run_id,
                #
                testset_id=testset_id,
                revision_id=revision_id,
                autoeval_ids=autoeval_ids,
                #
                run_config=run_config,
                #
                tracing_router=self.tracing_router,
                simple_testsets_router=self.simple_testsets_router,
                simple_evaluators_router=self.simple_evaluators_router,
                #
                queries_service=self.queries_service,
                workflows_service=self.workflows_service,
                evaluations_service=self.evaluations_service,
            )
            log.info("[TASK] Completed evaluate_batch_testset")
            return result

        @self.broker.task(task_name="evaluations.live.evaluate")
        async def evaluate_live_query(
            project_id: UUID,
            user_id: UUID,
            #
            run_id: UUID,
            #
            newest: datetime,
            oldest: datetime,
        ) -> Any:
            """Live evaluation task - evaluates traces against evaluators."""
            log.info("[TASK] Starting evaluate_live_query")

            # Call the async evaluate function directly
            result = await evaluate_live_query_impl(
                project_id=project_id,
                user_id=user_id,
                #
                run_id=run_id,
                #
                newest=newest,
                oldest=oldest,
            )
            log.info("[TASK] Completed evaluate_live_query")
            return result

        # Store task references for external access
        self.evaluate_batch_testset = evaluate_batch_testset
        self.evaluate_live_query = evaluate_live_query
