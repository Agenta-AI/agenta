from typing import Optional
from uuid import UUID
from functools import wraps

from fastapi import APIRouter, Request, HTTPException, Depends, Query

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.evaluations.types import (
    EvaluationClosedConflict,
    EvaluationRun,
)

from oss.src.apis.fastapi.evaluations.models import EvaluationClosedException
from oss.src.apis.fastapi.evaluations.models import (
    # EVALUATION RUN
    EvaluationRunsCreateRequest,
    EvaluationRunEditRequest,
    EvaluationRunsEditRequest,
    EvaluationRunQueryRequest,
    EvaluationRunIdsRequest,
    EvaluationRunResponse,
    EvaluationRunsResponse,
    EvaluationRunIdResponse,
    EvaluationRunIdsResponse,
    # EVALUATION SCENARIO
    EvaluationScenariosCreateRequest,
    EvaluationScenarioEditRequest,
    EvaluationScenariosEditRequest,
    EvaluationScenarioQueryRequest,
    EvaluationScenarioIdsRequest,
    EvaluationScenarioResponse,
    EvaluationScenariosResponse,
    EvaluationScenarioIdResponse,
    EvaluationScenarioIdsResponse,
    # EVALUATION STEP
    EvaluationStepsCreateRequest,
    EvaluationStepEditRequest,
    EvaluationStepsEditRequest,
    EvaluationStepQueryRequest,
    EvaluationStepIdsRequest,
    EvaluationStepResponse,
    EvaluationStepsResponse,
    EvaluationStepIdResponse,
    EvaluationStepIdsResponse,
    # EVALUATION METRIC
    EvaluationMetricsCreateRequest,
    EvaluationMetricEditRequest,
    EvaluationMetricsEditRequest,
    EvaluationMetricQueryRequest,
    EvaluationMetricIdsRequest,
    EvaluationMetricResponse,
    EvaluationMetricsResponse,
    EvaluationMetricIdResponse,
    EvaluationMetricIdsResponse,
    # EVALUATION QUEUE
    EvaluationQueuesCreateRequest,
    EvaluationQueueEditRequest,
    EvaluationQueuesEditRequest,
    EvaluationQueueQueryRequest,
    EvaluationQueueIdsRequest,
    EvaluationQueueResponse,
    EvaluationQueuesResponse,
    EvaluationQueueIdResponse,
    EvaluationQueueIdsResponse,
    EvaluationQueueScenarioIdsResponse,
)
from oss.src.apis.fastapi.evaluations.utils import (
    parse_run_query_request,
    parse_scenario_query_request,
    parse_step_query_request,
    parse_metric_query_request,
    parse_queue_query_request,
)


if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


def handle_evaluation_closed_exception():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except EvaluationClosedConflict as e:
                raise EvaluationClosedException(
                    message=e.message,
                    run_id=e.run_id,
                    scenario_id=e.scenario_id,
                    step_id=e.step_id,
                    metric_id=e.metric_id,
                ) from e
            except Exception as e:
                raise e

        return wrapper

    return decorator


class EvaluationsRouter:
    VERSION = "preview"

    def __init__(
        self,
        *,
        evaluations_service: EvaluationsService,
    ):
        self.evaluations_service = evaluations_service

        self.router = APIRouter()

        # - EVALUATION RUN -----------------------------------------------------

        # POST /api/preview/evaluations/runs/
        self.router.add_api_route(
            path="/runs/",
            methods=["POST"],
            endpoint=self.create_runs,
            response_model=EvaluationRunsResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/evaluations/runs/
        self.router.add_api_route(
            path="/runs/",
            methods=["GET"],
            endpoint=self.fetch_runs,
            response_model=EvaluationRunsResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/preview/evaluations/runs/
        self.router.add_api_route(
            path="/runs/",
            methods=["PATCH"],
            endpoint=self.edit_runs,
            response_model=EvaluationRunsResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/preview/evaluations/runs/
        self.router.add_api_route(
            path="/runs/",
            methods=["DELETE"],
            endpoint=self.delete_runs,
            response_model=EvaluationRunIdsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/evaluations/runs/query
        self.router.add_api_route(
            path="/runs/query",
            methods=["POST"],
            endpoint=self.query_runs,
            response_model=EvaluationRunsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/evaluations/runs/archive
        self.router.add_api_route(
            path="/runs/archive",
            methods=["POST"],
            endpoint=self.archive_runs,
            response_model=EvaluationRunsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/evaluations/runs/unarchive
        self.router.add_api_route(
            path="/runs/unarchive",
            methods=["POST"],
            endpoint=self.unarchive_runs,
            response_model=EvaluationRunsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/evaluations/runs/close
        self.router.add_api_route(
            path="/runs/close",
            methods=["POST"],
            endpoint=self.close_runs,
            response_model=EvaluationRunsResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/evaluations/runs/{run_id}
        self.router.add_api_route(
            path="/runs/{run_id}",
            methods=["GET"],
            endpoint=self.fetch_run,
            response_model=EvaluationRunResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/preview/evaluations/runs/{run_id}
        self.router.add_api_route(
            path="/runs/{run_id}",
            methods=["PATCH"],
            endpoint=self.edit_run,
            response_model=EvaluationRunResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/preview/evaluations/runs/{run_id}
        self.router.add_api_route(
            path="/runs/{run_id}",
            methods=["DELETE"],
            endpoint=self.delete_run,
            response_model=EvaluationRunIdResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/evaluations/runs/{run_id}/archive
        self.router.add_api_route(
            path="/runs/{run_id}/archive",
            methods=["POST"],
            endpoint=self.archive_run,
            response_model=EvaluationRunResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/evaluations/runs/{run_id}/unarchive
        self.router.add_api_route(
            path="/runs/{run_id}/unarchive",
            methods=["POST"],
            endpoint=self.unarchive_run,
            response_model=EvaluationRunResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/evaluations/runs/{run_id}/close
        self.router.add_api_route(
            path="/runs/{run_id}/close",
            methods=["POST"],
            endpoint=self.close_run,
            response_model=EvaluationRunResponse,
            response_model_exclude_none=True,
        )

        # - EVALUATION SCENARIO ------------------------------------------------

        # POST /api/preview/evaluations/scenarios/
        self.router.add_api_route(
            path="/scenarios/",
            methods=["POST"],
            endpoint=self.create_scenarios,
            response_model=EvaluationScenariosResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/evaluations/scenarios/
        self.router.add_api_route(
            path="/scenarios/",
            methods=["GET"],
            endpoint=self.fetch_scenarios,
            response_model=EvaluationScenariosResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/preview/evaluations/scenarios/
        self.router.add_api_route(
            path="/scenarios/",
            methods=["PATCH"],
            endpoint=self.edit_scenarios,
            response_model=EvaluationScenariosResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/preview/evaluations/scenarios/
        self.router.add_api_route(
            path="/scenarios/",
            methods=["DELETE"],
            endpoint=self.delete_scenarios,
            response_model=EvaluationScenarioIdsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/evaluations/scenarios/query
        self.router.add_api_route(
            path="/scenarios/query",
            methods=["POST"],
            endpoint=self.query_scenarios,
            response_model=EvaluationScenariosResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/evaluations/scenarios/{scenario_id}
        self.router.add_api_route(
            path="/scenarios/{scenario_id}",
            methods=["GET"],
            endpoint=self.fetch_scenario,
            response_model=EvaluationScenarioResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/preview/evaluations/scenarios/{scenario_id}
        self.router.add_api_route(
            path="/scenarios/{scenario_id}",
            methods=["PATCH"],
            endpoint=self.edit_scenario,
            response_model=EvaluationScenarioResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/preview/evaluations/scenarios/{scenario_id}
        self.router.add_api_route(
            path="/scenarios/{scenario_id}",
            methods=["DELETE"],
            endpoint=self.delete_scenario,
            response_model=EvaluationScenarioIdResponse,
            response_model_exclude_none=True,
        )

        # - EVALUATION STEP ----------------------------------------------------

        # POST /api/preview/evaluations/steps/
        self.router.add_api_route(
            path="/steps/",
            methods=["POST"],
            endpoint=self.create_steps,
            response_model=EvaluationStepsResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/evaluations/steps/
        self.router.add_api_route(
            path="/steps/",
            methods=["GET"],
            endpoint=self.fetch_steps,
            response_model=EvaluationStepsResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/preview/evaluations/steps/
        self.router.add_api_route(
            path="/steps/",
            methods=["PATCH"],
            endpoint=self.edit_steps,
            response_model=EvaluationStepsResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/preview/evaluations/steps/
        self.router.add_api_route(
            path="/steps/",
            methods=["DELETE"],
            endpoint=self.delete_steps,
            response_model=EvaluationStepIdsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/evaluations/steps/query
        self.router.add_api_route(
            path="/steps/query",
            methods=["POST"],
            endpoint=self.query_steps,
            response_model=EvaluationStepsResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/evaluations/steps/{step_id}
        self.router.add_api_route(
            path="/steps/{step_id}",
            methods=["GET"],
            endpoint=self.fetch_step,
            response_model=EvaluationStepResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/preview/evaluations/steps/{step_id}
        self.router.add_api_route(
            path="/steps/{step_id}",
            methods=["PATCH"],
            endpoint=self.edit_step,
            response_model=EvaluationStepResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/preview/evaluations/steps/{step_id}
        self.router.add_api_route(
            path="/steps/{step_id}",
            methods=["DELETE"],
            endpoint=self.delete_step,
            response_model=EvaluationStepIdResponse,
            response_model_exclude_none=True,
        )

        # - EVALUATION METRIC --------------------------------------------------

        # POST /api/preview/evaluations/metrics/
        self.router.add_api_route(
            path="/metrics/",
            methods=["POST"],
            endpoint=self.create_metrics,
            response_model=EvaluationMetricsResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/evaluations/metrics/
        self.router.add_api_route(
            path="/metrics/",
            methods=["GET"],
            endpoint=self.fetch_metrics,
            response_model=EvaluationMetricsResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/preview/evaluations/metrics/
        self.router.add_api_route(
            path="/metrics/",
            methods=["PATCH"],
            endpoint=self.edit_metrics,
            response_model=EvaluationMetricsResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/preview/evaluations/metrics/
        self.router.add_api_route(
            path="/metrics/",
            methods=["DELETE"],
            endpoint=self.delete_metrics,
            response_model=EvaluationMetricIdsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/evaluations/metrics/query
        self.router.add_api_route(
            path="/metrics/query",
            methods=["POST"],
            endpoint=self.query_metrics,
            response_model=EvaluationMetricsResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/evaluations/metrics/{metric_id}
        self.router.add_api_route(
            path="/metrics/{metric_id}",
            methods=["GET"],
            endpoint=self.fetch_metric,
            response_model=EvaluationMetricResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/preview/evaluations/metrics/{metric_id}
        self.router.add_api_route(
            path="/metrics/{metric_id}",
            methods=["PATCH"],
            endpoint=self.edit_metric,
            response_model=EvaluationMetricResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/preview/evaluations/metrics/{metric_id}
        self.router.add_api_route(
            path="/metrics/{metric_id}",
            methods=["DELETE"],
            endpoint=self.delete_metric,
            response_model=EvaluationMetricIdResponse,
            response_model_exclude_none=True,
        )

        # - EVALUATION QUEUE ---------------------------------------------------

        # POST /api/preview/evaluations/queues/
        self.router.add_api_route(
            path="/queues/",
            methods=["POST"],
            endpoint=self.create_queues,
            response_model=EvaluationQueuesResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/evaluations/queues/
        self.router.add_api_route(
            path="/queues/",
            methods=["GET"],
            endpoint=self.fetch_queues,
            response_model=EvaluationQueuesResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/preview/evaluations/queues/
        self.router.add_api_route(
            path="/queues/",
            methods=["PATCH"],
            endpoint=self.edit_queues,
            response_model=EvaluationQueuesResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/preview/evaluations/queues/
        self.router.add_api_route(
            path="/queues/",
            methods=["DELETE"],
            endpoint=self.delete_queues,
            response_model=EvaluationQueueIdsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/preview/evaluations/queues/query
        self.router.add_api_route(
            path="/queues/query",
            methods=["POST"],
            endpoint=self.query_queues,
            response_model=EvaluationQueuesResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/evaluations/queues/{queue_id}
        self.router.add_api_route(
            path="/queues/{queue_id}",
            methods=["GET"],
            endpoint=self.fetch_queue,
            response_model=EvaluationQueueResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/preview/evaluations/queues/{queue_id}
        self.router.add_api_route(
            path="/queues/{queue_id}",
            methods=["PATCH"],
            endpoint=self.edit_queue,
            response_model=EvaluationQueueResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/preview/evaluations/queues/{queue_id}
        self.router.add_api_route(
            path="/queues/{queue_id}",
            methods=["DELETE"],
            endpoint=self.delete_queue,
            response_model=EvaluationQueueIdResponse,
            response_model_exclude_none=True,
        )

        # GET /api/preview/evaluations/queues/{queue_id}/scenarios
        self.router.add_api_route(
            path="/queues/{queue_id}/scenarios",
            methods=["GET"],
            endpoint=self.fetch_queue_scenarios,
            response_model=EvaluationQueueScenarioIdsResponse,
            response_model_exclude_none=True,
        )

        # ----------------------------------------------------------------------

    # - EVALUATION RUN ---------------------------------------------------------

    # POST /evaluations/runs/
    @intercept_exceptions()
    async def create_runs(
        self,
        *,
        request: Request,
        runs_create_request: EvaluationRunsCreateRequest,
    ) -> EvaluationRunsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        runs = await self.evaluations_service.create_runs(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            runs=runs_create_request.runs,
        )

        runs_response = EvaluationRunsResponse(
            count=len(runs),
            runs=runs,
        )

        return runs_response

        # GET /evaluations/runs/

    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationRunsResponse())
    async def fetch_runs(
        self,
        *,
        request: Request,
        run_query_request: Optional[EvaluationRunQueryRequest] = Depends(
            parse_run_query_request
        ),
    ) -> EvaluationRunsResponse:
        return await self.query_runs(
            request=request,
            run_query_request=run_query_request,
        )

    # PATCH /evaluations/runs/
    @intercept_exceptions()
    async def edit_runs(
        self,
        *,
        request: Request,
        runs_edit_request: EvaluationRunsEditRequest,
    ) -> EvaluationRunsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        runs = await self.evaluations_service.edit_runs(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            runs=runs_edit_request.runs,
        )

        runs_response = EvaluationRunsResponse(
            count=len(runs),
            runs=[EvaluationRun(**r.model_dump()) for r in runs],
        )

        return runs_response

    # DELETE /evaluations/runs/
    @intercept_exceptions()
    async def delete_runs(
        self,
        *,
        request: Request,
        run_ids_request: EvaluationRunIdsRequest,
    ) -> EvaluationRunIdsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        run_ids = await self.evaluations_service.delete_runs(
            project_id=request.state.project_id,
            run_ids=run_ids_request.run_ids,
        )

        run_ids_response = EvaluationRunIdsResponse(
            count=len(run_ids),
            run_ids=run_ids,
        )

        return run_ids_response

    # POST /evaluations/runs/query
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationRunsResponse())
    async def query_runs(
        self,
        *,
        request: Request,
        run_query_request: EvaluationRunQueryRequest,
    ) -> EvaluationRunsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        runs = await self.evaluations_service.query_runs(
            project_id=request.state.project_id,
            run=run_query_request.run,
            include_archived=run_query_request.include_archived,
            windowing=run_query_request.windowing,
        )

        runs_response = EvaluationRunsResponse(
            count=len(runs),
            runs=[EvaluationRun(**r.model_dump()) for r in runs],
        )

        return runs_response

    # POST /evaluations/runs/archive
    @intercept_exceptions()
    async def archive_runs(
        self,
        *,
        request: Request,
        run_ids_request: EvaluationRunIdsRequest,
    ) -> EvaluationRunsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        runs = await self.evaluations_service.archive_runs(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            run_ids=run_ids_request.run_ids,
        )

        runs_response = EvaluationRunsResponse(
            count=len(runs),
            runs=runs,
        )

        return runs_response

    # POST /evaluations/runs/unarchive
    @intercept_exceptions()
    async def unarchive_runs(
        self,
        *,
        request: Request,
        run_ids_request: EvaluationRunIdsRequest,
    ) -> EvaluationRunsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        runs = await self.evaluations_service.unarchive_runs(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            run_ids=run_ids_request.run_ids,
        )

        runs_response = EvaluationRunsResponse(
            count=len(runs),
            runs=runs,
        )

        return runs_response

    # POST /evaluations/runs/close
    @intercept_exceptions()
    async def close_runs(
        self,
        *,
        request: Request,
        run_ids_request: EvaluationRunIdsRequest,
    ) -> EvaluationRunsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        runs = await self.evaluations_service.close_runs(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            run_ids=run_ids_request.run_ids,
        )

        runs_response = EvaluationRunsResponse(
            count=len(runs),
            runs=runs,
        )

        return runs_response

    # GET /evaluations/runs/{run_id}
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationRunResponse())
    async def fetch_run(
        self,
        *,
        request: Request,
        run_id: UUID,
    ) -> EvaluationRunResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        run = await self.evaluations_service.fetch_run(
            project_id=request.state.project_id,
            run_id=run_id,
        )

        run_response = EvaluationRunResponse(
            count=1 if run else 0,
            run=run,
        )

        return run_response

    # PATCH /evaluations/runs/{run_id}
    @intercept_exceptions()
    async def edit_run(
        self,
        *,
        request: Request,
        run_id: UUID,
        run_edit_request: EvaluationRunEditRequest,
    ) -> EvaluationRunResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        if run_id != run_edit_request.run.id:
            raise HTTPException(status_code=400, detail="Run ID mismatch")

        run = await self.evaluations_service.edit_run(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            run=run_edit_request.run,
        )

        run_response = EvaluationRunResponse(
            count=1 if run else 0,
            run=run,
        )

        return run_response

    # DELETE /evaluations/runs/{run_id}
    @intercept_exceptions()
    async def delete_run(
        self,
        *,
        request: Request,
        run_id: UUID,
    ) -> EvaluationRunIdResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        run_id = await self.evaluations_service.delete_run(
            project_id=request.state.project_id,
            run_id=run_id,
        )

        run_id_response = EvaluationRunIdResponse(
            count=1 if run_id else 0,
            run_id=run_id,
        )

        return run_id_response

    # POST /evaluations/runs/{run_id}/archive
    @intercept_exceptions()
    async def archive_run(
        self,
        *,
        request: Request,
        run_id: UUID,
    ) -> EvaluationRunResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        run = await self.evaluations_service.archive_run(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            run_id=run_id,
        )

        run_response = EvaluationRunResponse(
            count=1 if run else 0,
            run=run,
        )

        return run_response

    # POST /evaluations/runs/{run_id}/unarchive
    @intercept_exceptions()
    async def unarchive_run(
        self,
        *,
        request: Request,
        run_id: UUID,
    ) -> EvaluationRunResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        run = await self.evaluations_service.unarchive_run(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            run_id=run_id,
        )

        run_response = EvaluationRunResponse(
            count=1 if run else 0,
            run=run,
        )

        return run_response

    # POST /evaluations/runs/{run_id}/close
    @intercept_exceptions()
    async def close_run(
        self,
        *,
        request: Request,
        run_id: UUID,
    ) -> EvaluationRunResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        run = await self.evaluations_service.close_run(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            run_id=run_id,
        )

        run_response = EvaluationRunResponse(
            count=1 if run else 0,
            run=run,
        )

        return run_response

    # - EVALUATION SCENARIO ----------------------------------------------------

    # POST /evaluations/scenarios/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def create_scenarios(
        self,
        *,
        request: Request,
        scenarios_create_request: EvaluationScenariosCreateRequest,
    ) -> EvaluationScenariosResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        scenarios = await self.evaluations_service.create_scenarios(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            scenarios=scenarios_create_request.scenarios,
        )

        scenarios_response = EvaluationScenariosResponse(
            count=len(scenarios),
            scenarios=scenarios,
        )

        return scenarios_response

    # GET /evaluations/scenarios/
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationScenariosResponse())
    async def fetch_scenarios(
        self,
        *,
        request: Request,
        scenario_query_request: Optional[EvaluationScenarioQueryRequest] = Depends(
            parse_scenario_query_request
        ),
    ) -> EvaluationScenariosResponse:
        return await self.query_scenarios(
            request=request,
            scenario_query_request=scenario_query_request,
        )

    # PATCH /evaluations/scenarios/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def edit_scenarios(
        self,
        *,
        request: Request,
        scenarios_edit_request: EvaluationScenariosEditRequest,
    ) -> EvaluationScenariosResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        scenarios = await self.evaluations_service.edit_scenarios(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            scenarios=scenarios_edit_request.scenarios,
        )

        scenarios_response = EvaluationScenariosResponse(
            count=len(scenarios),
            scenarios=scenarios,
        )

        return scenarios_response

    # DELETE /evaluations/scenarios/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def delete_scenarios(
        self,
        *,
        request: Request,
        scenario_ids_request: EvaluationScenarioIdsRequest,
    ) -> EvaluationScenarioIdsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        scenario_ids = await self.evaluations_service.delete_scenarios(
            project_id=request.state.project_id,
            scenario_ids=scenario_ids_request.scenario_ids,
        )

        scenario_ids_response = EvaluationScenarioIdsResponse(
            count=len(scenario_ids),
            scenario_ids=scenario_ids,
        )

        return scenario_ids_response

    # POST /evaluations/scenarios/query
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationScenariosResponse())
    async def query_scenarios(
        self,
        *,
        request: Request,
        scenario_query_request: EvaluationScenarioQueryRequest,
    ) -> EvaluationScenariosResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        scenarios = await self.evaluations_service.query_scenarios(
            project_id=request.state.project_id,
            scenario=scenario_query_request.scenario,
            windowing=scenario_query_request.windowing,
        )

        scenarios_response = EvaluationScenariosResponse(
            count=len(scenarios),
            scenarios=scenarios,
        )

        return scenarios_response

    # GET /evaluations/scenarios/{scenario_id}
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationScenarioResponse())
    async def fetch_scenario(
        self,
        *,
        request: Request,
        scenario_id: UUID,
    ) -> EvaluationScenarioResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        scenario = await self.evaluations_service.fetch_scenario(
            project_id=request.state.project_id,
            scenario_id=scenario_id,
        )

        scenario_response = EvaluationScenarioResponse(
            count=1 if scenario else 0,
            scenario=scenario,
        )

        return scenario_response

    # PATCH /evaluations/scenarios/{scenario_id}
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def edit_scenario(
        self,
        *,
        request: Request,
        scenario_id: UUID,
        scenario_edit_request: EvaluationScenarioEditRequest,
    ) -> EvaluationScenarioResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        if scenario_id != scenario_edit_request.scenario.id:
            raise HTTPException(status_code=400, detail="Scenario ID mismatch")

        scenario = await self.evaluations_service.edit_scenario(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            scenario=scenario_edit_request.scenario,
        )

        scenario_response = EvaluationScenarioResponse(
            count=1 if scenario else 0,
            scenario=scenario,
        )

        return scenario_response

    # DELETE /evaluations/scenarios/{scenario_id}
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def delete_scenario(
        self,
        *,
        request: Request,
        scenario_id: UUID,
    ) -> EvaluationScenarioIdsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        scenario_id = await self.evaluations_service.delete_scenario(
            project_id=request.state.project_id,
            scenario_id=scenario_id,
        )

        scenario_id_response = EvaluationScenarioIdResponse(
            count=1 if scenario_id else 0,
            scenario_id=scenario_id,
        )

        return scenario_id_response

    # - EVALAUTION STEP --------------------------------------------------------

    # POST /evaluations/steps/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def create_steps(
        self,
        *,
        request: Request,
        steps_create_request: EvaluationStepsCreateRequest,
    ) -> EvaluationStepsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        steps = await self.evaluations_service.create_steps(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            steps=steps_create_request.steps,
        )

        steps_response = EvaluationStepsResponse(
            count=len(steps),
            steps=steps,
        )

        return steps_response

    # GET /evaluations/steps/
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationStepsResponse())
    async def fetch_steps(
        self,
        *,
        request: Request,
        step_query_request: Optional[EvaluationStepQueryRequest] = Depends(
            parse_step_query_request
        ),
    ) -> EvaluationStepsResponse:
        return await self.query_steps(
            request=request,
            step_query_request=step_query_request,
        )

    # PATCH /evaluations/steps/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def edit_steps(
        self,
        *,
        request: Request,
        steps_edit_request: EvaluationStepsEditRequest,
    ) -> EvaluationStepsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        steps = await self.evaluations_service.edit_steps(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            steps=steps_edit_request.steps,
        )

        steps_response = EvaluationStepsResponse(
            count=len(steps),
            steps=steps,
        )

        return steps_response

    # DELETE /evaluations/steps/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def delete_steps(
        self,
        *,
        request: Request,
        step_ids_request: EvaluationStepIdsRequest,
    ) -> EvaluationStepIdsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        step_ids = await self.evaluations_service.delete_steps(
            project_id=request.state.project_id,
            step_ids=step_ids_request.step_ids,
        )

        step_ids_response = EvaluationStepIdsResponse(
            count=len(step_ids),
            step_ids=step_ids,
        )

        return step_ids_response

    # POST /evaluations/steps/query
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationStepsResponse())
    async def query_steps(
        self,
        *,
        request: Request,
        step_query_request: EvaluationStepQueryRequest,
    ) -> EvaluationStepsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        steps = await self.evaluations_service.query_steps(
            project_id=request.state.project_id,
            step=step_query_request.step,
            windowing=step_query_request.windowing,
        )

        steps_response = EvaluationStepsResponse(
            count=len(steps),
            steps=steps,
        )

        return steps_response

    # GET /evaluations/steps/{step_id}
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationStepResponse())
    async def fetch_step(
        self,
        *,
        request: Request,
        step_id: UUID,
    ) -> EvaluationStepResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        step = await self.evaluations_service.fetch_step(
            project_id=request.state.project_id,
            step_id=step_id,
        )

        step_response = EvaluationStepResponse(
            count=1 if step else 0,
            step=step,
        )

        return step_response

    # PATCH /evaluations/steps/{step_id}
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def edit_step(
        self,
        *,
        request: Request,
        step_id: UUID,
        step_edit_request: EvaluationStepEditRequest,
    ) -> EvaluationStepResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        if step_id != step_edit_request.step.id:
            raise HTTPException(status_code=400, detail="Step ID mismatch")

        step = await self.evaluations_service.edit_step(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            step=step_edit_request.step,
        )

        step_response = EvaluationStepResponse(
            count=1 if step else 0,
            step=step,
        )

        return step_response

    # DELETE /evaluations/steps/{step_id}
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def delete_step(
        self,
        *,
        request: Request,
        step_id: UUID,
    ) -> EvaluationStepIdsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        step_id_val = await self.evaluations_service.delete_step(
            project_id=request.state.project_id,
            step_id=step_id,
        )

        step_id_response = EvaluationStepIdResponse(
            count=1 if step_id_val else 0,
            step_id=step_id_val,
        )

        return step_id_response

    # - EVALUATION METRIC ------------------------------------------------------

    # POST /evaluations/metrics/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def create_metrics(
        self,
        *,
        request: Request,
        metrics_create_request: EvaluationMetricsCreateRequest,
    ) -> EvaluationMetricsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        metrics = await self.evaluations_service.create_metrics(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            metrics=metrics_create_request.metrics,
        )

        metrics_response = EvaluationMetricsResponse(
            count=len(metrics),
            metrics=metrics,
        )

        return metrics_response

    # GET /evaluations/metrics/
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationMetricsResponse())
    async def fetch_metrics(
        self,
        *,
        request: Request,
        metric_query_request: Optional[EvaluationMetricQueryRequest] = Depends(
            parse_metric_query_request
        ),
    ) -> EvaluationMetricsResponse:
        return await self.query_metrics(
            request=request,
            metric_query_request=metric_query_request,
        )

    # PATCH /evaluations/metrics/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def edit_metrics(
        self,
        *,
        request: Request,
        metrics_edit_request: EvaluationMetricsEditRequest,
    ) -> EvaluationMetricsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        metrics = await self.evaluations_service.edit_metrics(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            metrics=metrics_edit_request.metrics,
        )

        metrics_response = EvaluationMetricsResponse(
            count=len(metrics),
            metrics=metrics,
        )

        return metrics_response

    # DELETE /evaluations/metrics/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def delete_metrics(
        self,
        *,
        request: Request,
        metric_ids_request: EvaluationMetricIdsRequest,
    ) -> EvaluationMetricIdsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        metric_ids = await self.evaluations_service.delete_metrics(
            project_id=request.state.project_id,
            metric_ids=metric_ids_request.metric_ids,
        )

        metric_ids_response = EvaluationMetricIdsResponse(
            count=len(metric_ids),
            metric_ids=metric_ids,
        )

        return metric_ids_response

    # POST /evaluations/metrics/query
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationMetricsResponse())
    async def query_metrics(
        self,
        *,
        request: Request,
        metric_query_request: EvaluationMetricQueryRequest,
    ) -> EvaluationMetricsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        metrics = await self.evaluations_service.query_metrics(
            project_id=request.state.project_id,
            metric=metric_query_request.metric,
            windowing=metric_query_request.windowing,
        )

        metrics_response = EvaluationMetricsResponse(
            count=len(metrics),
            metrics=metrics,
        )

        return metrics_response

    # GET /evaluations/metrics/{metric_id}
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationMetricResponse())
    async def fetch_metric(
        self,
        *,
        request: Request,
        metric_id: UUID,
    ) -> EvaluationMetricResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        metric = await self.evaluations_service.fetch_metric(
            project_id=request.state.project_id,
            metric_id=metric_id,
        )

        metric_response = EvaluationMetricResponse(
            count=1 if metric else 0,
            metric=metric,
        )

        return metric_response

    # PATCH /evaluations/metrics/{metric_id}
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def edit_metric(
        self,
        *,
        request: Request,
        metric_id: UUID,
        metric_edit_request: EvaluationMetricEditRequest,
    ) -> EvaluationMetricResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        if metric_id != metric_edit_request.metric.id:
            raise HTTPException(status_code=400, detail="Metric ID mismatch")

        metric = await self.evaluations_service.edit_metric(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            metric=metric_edit_request.metric,
        )

        metric_response = EvaluationMetricResponse(
            count=1 if metric else 0,
            metric=metric,
        )

        return metric_response

    # DELETE /evaluations/metrics/{metric_id}
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def delete_metric(
        self,
        *,
        request: Request,
        metric_id: UUID,
    ) -> EvaluationMetricIdsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        metric_id_val = await self.evaluations_service.delete_metric(
            project_id=request.state.project_id,
            metric_id=metric_id,
        )

        metric_id_response = EvaluationMetricIdResponse(
            count=1 if metric_id_val else 0,
            metric_id=metric_id_val,
        )

        return metric_id_response

    # - EVALUATION QUEUE -------------------------------------------------------

    # POST /evaluations/queues/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def create_queues(
        self,
        *,
        request: Request,
        queues_create_request: EvaluationQueuesCreateRequest,
    ) -> EvaluationQueuesResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        queues = await self.evaluations_service.create_queues(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            queues=queues_create_request.queues,
        )

        queues_response = EvaluationQueuesResponse(
            count=len(queues),
            queues=queues,
        )

        return queues_response

    # GET /evaluations/queues/
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationQueuesResponse())
    async def fetch_queues(
        self,
        *,
        request: Request,
        queue_query_request: Optional[EvaluationQueueQueryRequest] = Depends(
            parse_queue_query_request
        ),
    ) -> EvaluationQueuesResponse:
        return await self.query_queues(
            request=request,
            queue_query_request=queue_query_request,
        )

    # PATCH /evaluations/queues/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def edit_queues(
        self,
        *,
        request: Request,
        queues_edit_request: EvaluationQueuesEditRequest,
    ) -> EvaluationQueuesResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        queues = await self.evaluations_service.edit_queues(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            queues=queues_edit_request.queues,
        )

        queues_response = EvaluationQueuesResponse(
            count=len(queues),
            queues=queues,
        )

        return queues_response

    # DELETE /evaluations/queues/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def delete_queues(
        self,
        *,
        request: Request,
        queue_ids_request: EvaluationQueueIdsRequest,
    ) -> EvaluationQueueIdsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        queue_ids = await self.evaluations_service.delete_queues(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            queue_ids=queue_ids_request.queue_ids,
        )

        queue_ids_response = EvaluationQueueIdsResponse(
            count=len(queue_ids),
            queue_ids=queue_ids,
        )

        return queue_ids_response

    # POST /evaluations/queues/query
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationQueuesResponse())
    async def query_queues(
        self,
        *,
        request: Request,
        queue_query_request: Optional[EvaluationQueueQueryRequest] = Depends(
            parse_queue_query_request
        ),
    ) -> EvaluationQueuesResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        queues = await self.evaluations_service.query_queues(
            project_id=request.state.project_id,
            queue=queue_query_request.queue,
            windowing=queue_query_request.windowing,
        )

        queues_response = EvaluationQueuesResponse(
            count=len(queues),
            queues=queues,
        )

        return queues_response

    # GET /evaluations/queues/{queue_id}
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationQueueResponse())
    async def fetch_queue(
        self,
        *,
        request: Request,
        queue_id: UUID,
    ) -> EvaluationQueueResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        queue = await self.evaluations_service.fetch_queue(
            project_id=request.state.project_id,
            queue_id=queue_id,
        )

        queue_response = EvaluationQueueResponse(
            count=1 if queue else 0,
            queue=queue,
        )

        return queue_response

    # PATCH /evaluations/queues/{queue_id}
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def edit_queue(
        self,
        *,
        request: Request,
        queue_id: UUID,
        queue_edit_request: EvaluationQueueEditRequest,
    ) -> EvaluationQueueResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        if queue_id != queue_edit_request.queue.id:
            raise HTTPException(status_code=400, detail="Queue ID mismatch")

        queue = await self.evaluations_service.edit_queue(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            queue=queue_edit_request.queue,
        )

        queue_response = EvaluationQueueResponse(
            count=1 if queue else 0,
            queue=queue,
        )

        return queue_response

    # DELETE /evaluations/queues/{queue_id}
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def delete_queue(
        self,
        *,
        request: Request,
        queue_id: UUID,
    ) -> EvaluationQueueIdResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.DELETE_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        queue_id = await self.evaluations_service.delete_queue(
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            queue_id=queue_id,
        )

        queue_id_response = EvaluationQueueResponse(
            count=1 if queue_id else 0,
            queue_id=queue_id,
        )

        return queue_id_response

    # GET /evaluations/queues/{queue_id}/scenarios
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationQueueScenarioIdsResponse())
    async def fetch_queue_scenarios(
        self,
        *,
        request: Request,
        queue_id: UUID,
        #
        user_id: Optional[UUID] = Query(None),
    ) -> EvaluationQueueScenarioIdsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATIONS,
            ):
                raise FORBIDDEN_EXCEPTION

        scenario_ids = await self.evaluations_service.fetch_queue_scenarios(
            project_id=request.state.project_id,
            user_id=user_id,
            #
            queue_id=queue_id,
        )

        scenario_ids_response = EvaluationQueueScenarioIdsResponse(
            count=len(scenario_ids),
            scenario_ids=scenario_ids,
        )

        return scenario_ids_response

    # --------------------------------------------------------------------------
