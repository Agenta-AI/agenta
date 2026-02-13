from typing import Optional
from uuid import UUID
from datetime import datetime, timedelta

from fastapi import APIRouter, Request, Query, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions

from oss.src.apis.fastapi.shared.utils import compute_next_windowing

from oss.src.core.queries.service import (
    QueriesService,
)
from oss.src.core.evaluations.service import (
    EvaluationStatus,
    EvaluationsService,
    SimpleEvaluationsService,
)

from oss.src.apis.fastapi.evaluations.models import (
    # EVALUATION RUNS
    EvaluationRunsCreateRequest,
    EvaluationRunEditRequest,
    EvaluationRunsEditRequest,
    EvaluationRunQueryRequest,
    EvaluationRunIdsRequest,
    EvaluationRunResponse,
    EvaluationRunsResponse,
    EvaluationRunIdResponse,
    EvaluationRunIdsResponse,
    # EVALUATION SCENARIOS
    EvaluationScenariosCreateRequest,
    EvaluationScenarioEditRequest,
    EvaluationScenariosEditRequest,
    EvaluationScenarioQueryRequest,
    EvaluationScenarioIdsRequest,
    EvaluationScenarioResponse,
    EvaluationScenariosResponse,
    EvaluationScenarioIdResponse,
    EvaluationScenarioIdsResponse,
    # EVALUATION RESULTS
    EvaluationResultsCreateRequest,
    EvaluationResultEditRequest,
    EvaluationResultsEditRequest,
    EvaluationResultQueryRequest,
    EvaluationResultIdsRequest,
    EvaluationResultResponse,
    EvaluationResultsResponse,
    EvaluationResultIdResponse,
    EvaluationResultIdsResponse,
    # EVALUATION METRICS
    EvaluationMetricsCreateRequest,
    EvaluationMetricsEditRequest,
    EvaluationMetricsQueryRequest,
    EvaluationMetricsIdsRequest,
    EvaluationMetricsResponse,
    EvaluationMetricsIdsResponse,
    EvaluationMetricsRefreshRequest,
    # EVALUATION QUEUES
    EvaluationQueuesCreateRequest,
    EvaluationQueueEditRequest,
    EvaluationQueuesEditRequest,
    EvaluationQueueQueryRequest,
    EvaluationQueueIdsRequest,
    EvaluationQueueResponse,
    EvaluationQueuesResponse,
    EvaluationQueueIdResponse,
    EvaluationQueueIdsResponse,
    #
    EvaluationQueueScenarioIdsResponse,
    #
    SimpleEvaluationCreateRequest,
    SimpleEvaluationEditRequest,
    SimpleEvaluationQueryRequest,
    SimpleEvaluationResponse,
    SimpleEvaluationsResponse,
    SimpleEvaluationIdResponse,
)
from oss.src.apis.fastapi.evaluations.utils import (
    handle_evaluation_closed_exception,
)
from oss.src.core.shared.dtos import Reference
from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunCreate,
    EvaluationRunEdit,
    #
    SimpleEvaluation,
    SimpleEvaluationCreate,
    SimpleEvaluationEdit,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class EvaluationsRouter:
    def __init__(
        self,
        *,
        evaluations_service: EvaluationsService,
        queries_service: QueriesService,
    ):
        self.evaluations_service = evaluations_service
        self.queries_service = queries_service

        self.router = APIRouter()

        self.admin_router = APIRouter()

        # EVALUATION RUNS ------------------------------------------------------

        # POST /api/evaluations/runs/refresh
        self.admin_router.add_api_route(
            path="/runs/refresh",
            methods=["POST"],
            endpoint=self.refresh_runs,
            response_model_exclude_none=True,
        )

        # POST /api/evaluations/runs/
        self.router.add_api_route(
            path="/runs/",
            methods=["POST"],
            endpoint=self.create_runs,
            response_model=EvaluationRunsResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/evaluations/runs/
        self.router.add_api_route(
            path="/runs/",
            methods=["PATCH"],
            endpoint=self.edit_runs,
            response_model=EvaluationRunsResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/evaluations/runs/
        self.router.add_api_route(
            path="/runs/",
            methods=["DELETE"],
            endpoint=self.delete_runs,
            response_model=EvaluationRunIdsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/evaluations/runs/query
        self.router.add_api_route(
            path="/runs/query",
            methods=["POST"],
            endpoint=self.query_runs,
            response_model=EvaluationRunsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/evaluations/runs/close
        self.router.add_api_route(
            path="/runs/close",
            methods=["POST"],
            endpoint=self.close_runs,
            response_model=EvaluationRunsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/evaluations/runs/open
        self.router.add_api_route(
            path="/runs/open",
            methods=["POST"],
            endpoint=self.open_runs,
            response_model=EvaluationRunsResponse,
            response_model_exclude_none=True,
        )

        # GET /api/evaluations/runs/{run_id}
        self.router.add_api_route(
            path="/runs/{run_id}",
            methods=["GET"],
            endpoint=self.fetch_run,
            response_model=EvaluationRunResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/evaluations/runs/{run_id}
        self.router.add_api_route(
            path="/runs/{run_id}",
            methods=["PATCH"],
            endpoint=self.edit_run,
            response_model=EvaluationRunResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/evaluations/runs/{run_id}
        self.router.add_api_route(
            path="/runs/{run_id}",
            methods=["DELETE"],
            endpoint=self.delete_run,
            response_model=EvaluationRunIdResponse,
            response_model_exclude_none=True,
        )

        # POST /api/evaluations/runs/{run_id}/close
        self.router.add_api_route(
            path="/runs/{run_id}/close",
            methods=["POST"],
            endpoint=self.close_run,
            response_model=EvaluationRunResponse,
            response_model_exclude_none=True,
        )

        # POST /api/evaluations/runs/{run_id}/close/{status}
        self.router.add_api_route(
            path="/runs/{run_id}/close/{status}",
            methods=["POST"],
            endpoint=self.close_run,
            response_model=EvaluationRunResponse,
            response_model_exclude_none=True,
        )

        # POST /api/evaluations/runs/{run_id}/open
        self.router.add_api_route(
            path="/runs/{run_id}/open",
            methods=["POST"],
            endpoint=self.open_run,
            response_model=EvaluationRunResponse,
            response_model_exclude_none=True,
        )

        # EVALUATION SCENARIOS -------------------------------------------------

        # POST /api/evaluations/scenarios/
        self.router.add_api_route(
            path="/scenarios/",
            methods=["POST"],
            endpoint=self.create_scenarios,
            response_model=EvaluationScenariosResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/evaluations/scenarios/
        self.router.add_api_route(
            path="/scenarios/",
            methods=["PATCH"],
            endpoint=self.edit_scenarios,
            response_model=EvaluationScenariosResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/evaluations/scenarios/
        self.router.add_api_route(
            path="/scenarios/",
            methods=["DELETE"],
            endpoint=self.delete_scenarios,
            response_model=EvaluationScenarioIdsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/evaluations/scenarios/query
        self.router.add_api_route(
            path="/scenarios/query",
            methods=["POST"],
            endpoint=self.query_scenarios,
            response_model=EvaluationScenariosResponse,
            response_model_exclude_none=True,
        )

        # GET /api/evaluations/scenarios/{scenario_id}
        self.router.add_api_route(
            path="/scenarios/{scenario_id}",
            methods=["GET"],
            endpoint=self.fetch_scenario,
            response_model=EvaluationScenarioResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/evaluations/scenarios/{scenario_id}
        self.router.add_api_route(
            path="/scenarios/{scenario_id}",
            methods=["PATCH"],
            endpoint=self.edit_scenario,
            response_model=EvaluationScenarioResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/evaluations/scenarios/{scenario_id}
        self.router.add_api_route(
            path="/scenarios/{scenario_id}",
            methods=["DELETE"],
            endpoint=self.delete_scenario,
            response_model=EvaluationScenarioIdResponse,
            response_model_exclude_none=True,
        )

        # EVALUATION RESULTS ---------------------------------------------------

        # POST /api/evaluations/results/
        self.router.add_api_route(
            path="/results/",
            methods=["POST"],
            endpoint=self.create_results,
            response_model=EvaluationResultsResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/evaluations/results/
        self.router.add_api_route(
            path="/results/",
            methods=["PATCH"],
            endpoint=self.edit_results,
            response_model=EvaluationResultsResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/evaluations/results/
        self.router.add_api_route(
            path="/results/",
            methods=["DELETE"],
            endpoint=self.delete_results,
            response_model=EvaluationResultIdsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/evaluations/results/query
        self.router.add_api_route(
            path="/results/query",
            methods=["POST"],
            endpoint=self.query_results,
            response_model=EvaluationResultsResponse,
            response_model_exclude_none=True,
        )

        # GET /api/evaluations/results/{result_id}
        self.router.add_api_route(
            path="/results/{result_id}",
            methods=["GET"],
            endpoint=self.fetch_result,
            response_model=EvaluationResultResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/evaluations/results/{result_id}
        self.router.add_api_route(
            path="/results/{result_id}",
            methods=["PATCH"],
            endpoint=self.edit_result,
            response_model=EvaluationResultResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/evaluations/results/{result_id}
        self.router.add_api_route(
            path="/results/{result_id}",
            methods=["DELETE"],
            endpoint=self.delete_result,
            response_model=EvaluationResultIdResponse,
            response_model_exclude_none=True,
        )

        # EVALUATION METRICS ---------------------------------------------------

        # POST /api/evaluations/metrics/refresh
        self.router.add_api_route(
            path="/metrics/refresh",
            methods=["POST"],
            endpoint=self.refresh_metrics,
            response_model=EvaluationMetricsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/evaluations/metrics/
        self.router.add_api_route(
            path="/metrics/",
            methods=["POST"],
            endpoint=self.create_metrics,
            response_model=EvaluationMetricsResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/evaluations/metrics/
        self.router.add_api_route(
            path="/metrics/",
            methods=["PATCH"],
            endpoint=self.edit_metrics,
            response_model=EvaluationMetricsResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/evaluations/metrics/
        self.router.add_api_route(
            path="/metrics/",
            methods=["DELETE"],
            endpoint=self.delete_metrics,
            response_model=EvaluationMetricsIdsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/evaluations/metrics/query
        self.router.add_api_route(
            path="/metrics/query",
            methods=["POST"],
            endpoint=self.query_metrics,
            response_model=EvaluationMetricsResponse,
            response_model_exclude_none=True,
        )

        # EVALUATION QUEUES ----------------------------------------------------

        # POST /api/evaluations/queues/
        self.router.add_api_route(
            path="/queues/",
            methods=["POST"],
            endpoint=self.create_queues,
            response_model=EvaluationQueuesResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/evaluations/queues/
        self.router.add_api_route(
            path="/queues/",
            methods=["PATCH"],
            endpoint=self.edit_queues,
            response_model=EvaluationQueuesResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/evaluations/queues/
        self.router.add_api_route(
            path="/queues/",
            methods=["DELETE"],
            endpoint=self.delete_queues,
            response_model=EvaluationQueueIdsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/evaluations/queues/query
        self.router.add_api_route(
            path="/queues/query",
            methods=["POST"],
            endpoint=self.query_queues,
            response_model=EvaluationQueuesResponse,
            response_model_exclude_none=True,
        )

        # GET /api/evaluations/queues/{queue_id}
        self.router.add_api_route(
            path="/queues/{queue_id}",
            methods=["GET"],
            endpoint=self.fetch_queue,
            response_model=EvaluationQueueResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/evaluations/queues/{queue_id}
        self.router.add_api_route(
            path="/queues/{queue_id}",
            methods=["PATCH"],
            endpoint=self.edit_queue,
            response_model=EvaluationQueueResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/evaluations/queues/{queue_id}
        self.router.add_api_route(
            path="/queues/{queue_id}",
            methods=["DELETE"],
            endpoint=self.delete_queue,
            response_model=EvaluationQueueIdResponse,
            response_model_exclude_none=True,
        )

        # GET /api/evaluations/queues/{queue_id}/scenarios/
        self.router.add_api_route(
            path="/queues/{queue_id}/scenarios",
            methods=["GET"],
            endpoint=self.fetch_queue_scenarios,
            response_model=EvaluationQueueScenarioIdsResponse,
            response_model_exclude_none=True,
        )

    # EVALUATION RUNS ----------------------------------------------------------

    # POST /evaluations/runs/refresh
    @intercept_exceptions()
    async def refresh_runs(
        self,
        *,
        trigger_interval: Optional[int] = Query(1, ge=1, le=60),
        trigger_datetime: Optional[datetime] = Query(None),
    ):
        # ----------------------------------------------------------------------
        # THIS IS AN ADMIN ENDPOINT
        # NO CHECK FOR PERMISSIONS / ENTITLEMENTS
        # ----------------------------------------------------------------------

        if not trigger_datetime or not trigger_interval:
            return {"status": "error"}

        timestamp = trigger_datetime - timedelta(minutes=trigger_interval)
        interval = trigger_interval

        check = await self.evaluations_service.refresh_runs(
            timestamp=timestamp,
            interval=interval,
        )

        if not check:
            return {"status": "failure"}

        return {"status": "success"}

    # POST /evaluations/runs/
    @intercept_exceptions()
    async def create_runs(
        self,
        request: Request,
        *,
        runs_create_request: EvaluationRunsCreateRequest,
    ) -> EvaluationRunsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        jit = runs_create_request.jit

        for run in runs_create_request.runs:
            await self._resolve_run_request(
                project_id=UUID(request.state.project_id),
                run=run,
                jit=jit,
            )

        runs = await self.evaluations_service.create_runs(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            runs=runs_create_request.runs,
        )

        for run in runs:
            await self._unresolve_run_response(
                project_id=UUID(request.state.project_id),
                run=run,
                jit=jit,
            )

        runs_response = EvaluationRunsResponse(
            count=len(runs),
            runs=runs,
        )

        return runs_response

    # PATCH /evaluations/runs/
    @intercept_exceptions()
    async def edit_runs(
        self,
        request: Request,
        *,
        runs_edit_request: EvaluationRunsEditRequest,
    ) -> EvaluationRunsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        jit = runs_edit_request.jit

        for run in runs_edit_request.runs:
            await self._resolve_run_request(
                project_id=UUID(request.state.project_id),
                run=run,
                jit=jit,
            )

        runs = await self.evaluations_service.edit_runs(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            runs=runs_edit_request.runs,
        )

        for run in runs:
            await self._unresolve_run_response(
                project_id=UUID(request.state.project_id),
                run=run,
                jit=jit,
            )

        runs_response = EvaluationRunsResponse(
            count=len(runs),
            runs=runs,
        )

        return runs_response

    # DELETE /evaluations/runs/
    @intercept_exceptions()
    async def delete_runs(
        self,
        request: Request,
        *,
        run_ids_request: EvaluationRunIdsRequest,
    ) -> EvaluationRunIdsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        run_ids = await self.evaluations_service.delete_runs(
            project_id=UUID(request.state.project_id),
            #
            run_ids=run_ids_request.run_ids,
        )

        run_ids_response = EvaluationRunIdsResponse(
            count=len(run_ids),
            run_ids=run_ids,
        )

        return run_ids_response

    # POST /evaluations/runs/query
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationRunsResponse(), exclude=[HTTPException])
    async def query_runs(
        self,
        request: Request,
        *,
        run_query_request: EvaluationRunQueryRequest,
    ) -> EvaluationRunsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        jit = run_query_request.jit

        runs = await self.evaluations_service.query_runs(
            project_id=UUID(request.state.project_id),
            #
            run=run_query_request.run,
            #
            windowing=run_query_request.windowing,
        )

        for run in runs:
            await self._unresolve_run_response(
                project_id=UUID(request.state.project_id),
                run=run,
                jit=jit,
            )

        windowing = compute_next_windowing(
            entities=runs,
            attribute="id",
            windowing=run_query_request.windowing,
        )

        runs_response = EvaluationRunsResponse(
            count=len(runs),
            runs=runs,
            windowing=windowing,
        )

        return runs_response

    # POST /evaluations/runs/close
    @intercept_exceptions()
    async def close_runs(
        self,
        request: Request,
        *,
        run_ids_request: EvaluationRunIdsRequest,
    ) -> EvaluationRunsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        runs = await self.evaluations_service.close_runs(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            run_ids=run_ids_request.run_ids,
        )

        for run in runs:
            await self._unresolve_run_response(
                project_id=UUID(request.state.project_id),
                run=run,
            )

        runs_response = EvaluationRunsResponse(
            count=len(runs),
            runs=runs,
        )

        return runs_response

    # POST /evaluations/runs/open
    @intercept_exceptions()
    async def open_runs(
        self,
        request: Request,
        *,
        run_ids_request: EvaluationRunIdsRequest,
    ) -> EvaluationRunsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        runs = await self.evaluations_service.open_runs(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            run_ids=run_ids_request.run_ids,
        )

        for run in runs:
            await self._unresolve_run_response(
                project_id=UUID(request.state.project_id),
                run=run,
            )

        runs_response = EvaluationRunsResponse(
            count=len(runs),
            runs=runs,
        )

        return runs_response

    # GET /evaluations/runs/{run_id}
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationRunResponse(), exclude=[HTTPException])
    async def fetch_run(
        self,
        request: Request,
        *,
        run_id: UUID,
        #
        jit: Optional[bool] = Query(True),
    ) -> EvaluationRunResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        run = await self.evaluations_service.fetch_run(
            project_id=UUID(request.state.project_id),
            #
            run_id=run_id,
        )

        if run:
            await self._unresolve_run_response(
                project_id=UUID(request.state.project_id),
                run=run,
                jit=jit,
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
        request: Request,
        *,
        run_id: UUID,
        #
        run_edit_request: EvaluationRunEditRequest,
    ) -> EvaluationRunResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(run_id) != str(run_edit_request.run.id):
            return EvaluationRunResponse()

        jit = run_edit_request.jit

        await self._resolve_run_request(
            project_id=UUID(request.state.project_id),
            run=run_edit_request.run,
            jit=jit,
        )

        run = await self.evaluations_service.edit_run(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            run=run_edit_request.run,
        )

        if run:
            await self._unresolve_run_response(
                project_id=UUID(request.state.project_id),
                run=run,
                jit=jit,
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
        request: Request,
        *,
        run_id: UUID,
    ) -> EvaluationRunIdResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        _run_id = await self.evaluations_service.delete_run(
            project_id=UUID(request.state.project_id),
            #
            run_id=run_id,
        )

        run_id_response = EvaluationRunIdResponse(
            count=1 if _run_id else 0,
            run_id=_run_id,
        )

        return run_id_response

    # POST /evaluations/runs/{run_id}/close
    # POST /evaluations/runs/{run_id}/close/{status}
    @intercept_exceptions()
    async def close_run(
        self,
        request: Request,
        *,
        run_id: UUID,
        #
        status: Optional[EvaluationStatus] = None,
        jit: Optional[bool] = Query(True),
    ) -> EvaluationRunResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        run = await self.evaluations_service.close_run(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            run_id=run_id,
            #
            status=status,
        )

        if run:
            await self._unresolve_run_response(
                project_id=UUID(request.state.project_id),
                run=run,
                jit=jit,
            )

        run_response = EvaluationRunResponse(
            count=1 if run else 0,
            run=run,
        )

        return run_response

    # POST /evaluations/runs/{run_id}/open
    @intercept_exceptions()
    async def open_run(
        self,
        request: Request,
        *,
        run_id: UUID,
        jit: Optional[bool] = Query(True),
    ) -> EvaluationRunResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        run = await self.evaluations_service.open_run(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            run_id=run_id,
        )

        if run:
            await self._unresolve_run_response(
                project_id=UUID(request.state.project_id),
                run=run,
                jit=jit,
            )

        run_response = EvaluationRunResponse(
            count=1 if run else 0,
            run=run,
        )

        return run_response

    # EVALUATION SCENARIOS -----------------------------------------------------

    # POST /evaluations/scenarios/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def create_scenarios(
        self,
        request: Request,
        *,
        scenarios_create_request: EvaluationScenariosCreateRequest,
    ) -> EvaluationScenariosResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_SCENARIOS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        scenarios = await self.evaluations_service.create_scenarios(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            scenarios=scenarios_create_request.scenarios,
        )

        scenarios_response = EvaluationScenariosResponse(
            count=len(scenarios),
            scenarios=scenarios,
        )

        return scenarios_response

    # PATCH /evaluations/scenarios/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def edit_scenarios(
        self,
        request: Request,
        *,
        scenarios_edit_request: EvaluationScenariosEditRequest,
    ) -> EvaluationScenariosResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_SCENARIOS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        scenarios = await self.evaluations_service.edit_scenarios(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
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
        request: Request,
        *,
        scenario_ids_request: EvaluationScenarioIdsRequest,
    ) -> EvaluationScenarioIdsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_SCENARIOS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        scenario_ids = await self.evaluations_service.delete_scenarios(
            project_id=UUID(request.state.project_id),
            #
            scenario_ids=scenario_ids_request.scenario_ids,
        )

        scenario_ids_response = EvaluationScenarioIdsResponse(
            count=len(scenario_ids),
            scenario_ids=scenario_ids,
        )

        return scenario_ids_response

    # POST /evaluations/scenarios/query
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationScenariosResponse(), exclude=[HTTPException])
    async def query_scenarios(
        self,
        request: Request,
        *,
        scenario_query_request: EvaluationScenarioQueryRequest,
    ) -> EvaluationScenariosResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATION_SCENARIOS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        scenarios = await self.evaluations_service.query_scenarios(
            project_id=UUID(request.state.project_id),
            #
            scenario=scenario_query_request.scenario,
            #
            windowing=scenario_query_request.windowing,
        )

        scenarios_response = EvaluationScenariosResponse(
            count=len(scenarios),
            scenarios=scenarios,
        )

        return scenarios_response

    # GET /evaluations/scenarios/{scenario_id}
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationScenarioResponse(), exclude=[HTTPException])
    async def fetch_scenario(
        self,
        request: Request,
        *,
        scenario_id: UUID,
    ) -> EvaluationScenarioResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATION_SCENARIOS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        scenario = await self.evaluations_service.fetch_scenario(
            project_id=UUID(request.state.project_id),
            #
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
        request: Request,
        *,
        scenario_id: UUID,
        #
        scenario_edit_request: EvaluationScenarioEditRequest,
    ) -> EvaluationScenarioResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_SCENARIOS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(scenario_id) != str(scenario_edit_request.scenario.id):
            return EvaluationScenarioResponse()

        scenario = await self.evaluations_service.edit_scenario(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
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
        request: Request,
        *,
        scenario_id: UUID,
    ) -> EvaluationScenarioIdResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_SCENARIOS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        _scenario_id = await self.evaluations_service.delete_scenario(
            project_id=UUID(request.state.project_id),
            #
            scenario_id=scenario_id,
        )

        scenario_id_response = EvaluationScenarioIdResponse(
            count=1 if _scenario_id else 0,
            scenario_id=_scenario_id,
        )

        return scenario_id_response

    # EVALUATION RESULTS -------------------------------------------------------

    # POST /evaluations/results/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def create_results(
        self,
        request: Request,
        *,
        results_create_request: EvaluationResultsCreateRequest,
    ) -> EvaluationResultsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RESULTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        results = await self.evaluations_service.create_results(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            results=results_create_request.results,
        )

        results_response = EvaluationResultsResponse(
            count=len(results),
            results=results,
        )

        return results_response

    # PATCH /evaluations/results/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def edit_results(
        self,
        request: Request,
        *,
        results_edit_request: EvaluationResultsEditRequest,
    ) -> EvaluationResultsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RESULTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        results = await self.evaluations_service.edit_results(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            results=results_edit_request.results,
        )

        results_response = EvaluationResultsResponse(
            count=len(results),
            results=results,
        )

        return results_response

    # DELETE /evaluations/results/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def delete_results(
        self,
        request: Request,
        *,
        result_ids_request: EvaluationResultIdsRequest,
    ) -> EvaluationResultIdsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RESULTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        result_ids = await self.evaluations_service.delete_results(
            project_id=UUID(request.state.project_id),
            #
            result_ids=result_ids_request.result_ids,
        )

        result_ids_response = EvaluationResultIdsResponse(
            count=len(result_ids),
            result_ids=result_ids,
        )

        return result_ids_response

    # POST /evaluations/results/query
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationResultsResponse(), exclude=[HTTPException])
    async def query_results(
        self,
        request: Request,
        *,
        result_query_request: EvaluationResultQueryRequest,
    ) -> EvaluationResultsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATION_RESULTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        results = await self.evaluations_service.query_results(
            project_id=UUID(request.state.project_id),
            #
            result=result_query_request.result,
            #
            windowing=result_query_request.windowing,
        )

        results_response = EvaluationResultsResponse(
            count=len(results),
            results=results,
        )

        return results_response

    # GET /evaluations/results/{result_id}
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationResultResponse(), exclude=[HTTPException])
    async def fetch_result(
        self,
        request: Request,
        *,
        result_id: UUID,
    ) -> EvaluationResultResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATION_RESULTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        result = await self.evaluations_service.fetch_result(
            project_id=UUID(request.state.project_id),
            #
            result_id=result_id,
        )

        result_response = EvaluationResultResponse(
            count=1 if result else 0,
            result=result,
        )

        return result_response

    # PATCH /evaluations/results/{result_id}
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def edit_result(
        self,
        request: Request,
        *,
        result_id: UUID,
        #
        result_edit_request: EvaluationResultEditRequest,
    ) -> EvaluationResultResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RESULTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(result_id) != str(result_edit_request.result.id):
            return EvaluationResultResponse()

        result = await self.evaluations_service.edit_result(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            result=result_edit_request.result,
        )

        result_response = EvaluationResultResponse(
            count=1 if result else 0,
            result=result,
        )

        return result_response

    # DELETE /evaluations/results/{result_id}
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def delete_result(
        self,
        request: Request,
        *,
        result_id: UUID,
    ) -> EvaluationResultIdResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RESULTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        _result_id = await self.evaluations_service.delete_result(
            project_id=UUID(request.state.project_id),
            #
            result_id=result_id,
        )

        result_id_response = EvaluationResultIdResponse(
            count=1 if _result_id else 0,
            result_id=_result_id,
        )

        return result_id_response

    # EVALUATION METRICS -------------------------------------------------------

    # POST /evaluations/metrics/refresh
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationMetricsResponse(), exclude=[HTTPException])
    async def refresh_metrics(
        self,
        request: Request,
        *,
        metrics_refresh_request: EvaluationMetricsRefreshRequest,
    ) -> EvaluationMetricsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_METRICS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        metrics = await self.evaluations_service.refresh_metrics(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            metrics=metrics_refresh_request.metrics,
        )

        metrics_response = EvaluationMetricsResponse(
            count=len(metrics),
            metrics=metrics,
        )

        return metrics_response

    # POST /evaluations/metrics/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def create_metrics(
        self,
        request: Request,
        *,
        metrics_create_request: EvaluationMetricsCreateRequest,
    ) -> EvaluationMetricsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_METRICS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        metrics = await self.evaluations_service.create_metrics(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            metrics=metrics_create_request.metrics,
        )

        metrics_response = EvaluationMetricsResponse(
            count=len(metrics),
            metrics=metrics,
        )

        return metrics_response

    # PATCH /evaluations/metrics/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def edit_metrics(
        self,
        request: Request,
        *,
        metrics_edit_request: EvaluationMetricsEditRequest,
    ) -> EvaluationMetricsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_METRICS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        metrics = await self.evaluations_service.edit_metrics(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
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
        request: Request,
        *,
        metrics_ids_request: EvaluationMetricsIdsRequest,
    ) -> EvaluationMetricsIdsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_METRICS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        metrics_ids = await self.evaluations_service.delete_metrics(
            project_id=UUID(request.state.project_id),
            #
            metrics_ids=metrics_ids_request.metrics_ids,
        )

        metrics_ids_response = EvaluationMetricsIdsResponse(
            count=len(metrics_ids),
            metrics_ids=metrics_ids,
        )

        return metrics_ids_response

    # POST /evaluations/metrics/query
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationMetricsResponse(), exclude=[HTTPException])
    async def query_metrics(
        self,
        request: Request,
        *,
        metric_query_request: EvaluationMetricsQueryRequest,
    ) -> EvaluationMetricsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATION_METRICS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        metrics = await self.evaluations_service.query_metrics(
            project_id=UUID(request.state.project_id),
            #
            metric=metric_query_request.metrics,
            #
            windowing=metric_query_request.windowing,
        )

        metrics_response = EvaluationMetricsResponse(
            count=len(metrics),
            metrics=metrics,
        )

        return metrics_response

    # EVALUATION QUEUES --------------------------------------------------------

    # POST /evaluations/queues/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def create_queues(
        self,
        request: Request,
        *,
        queues_create_request: EvaluationQueuesCreateRequest,
    ) -> EvaluationQueuesResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_QUEUES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        queues = await self.evaluations_service.create_queues(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            queues=queues_create_request.queues,
        )

        queues_response = EvaluationQueuesResponse(
            count=len(queues),
            queues=queues,
        )

        return queues_response

    # PATCH /evaluations/queues/
    @intercept_exceptions()
    @handle_evaluation_closed_exception()
    async def edit_queues(
        self,
        request: Request,
        *,
        queues_edit_request: EvaluationQueuesEditRequest,
    ) -> EvaluationQueuesResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_QUEUES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        queues = await self.evaluations_service.edit_queues(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
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
        request: Request,
        *,
        queue_ids_request: EvaluationQueueIdsRequest,
    ) -> EvaluationQueueIdsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_QUEUES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        queue_ids = await self.evaluations_service.delete_queues(
            project_id=UUID(request.state.project_id),
            #
            queue_ids=queue_ids_request.queue_ids,
        )

        queue_ids_response = EvaluationQueueIdsResponse(
            count=len(queue_ids),
            queue_ids=queue_ids,
        )

        return queue_ids_response

    # POST /evaluations/queues/query
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationQueuesResponse(), exclude=[HTTPException])
    async def query_queues(
        self,
        request: Request,
        *,
        queue_query_request: EvaluationQueueQueryRequest,
    ) -> EvaluationQueuesResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATION_QUEUES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        queues = await self.evaluations_service.query_queues(
            project_id=UUID(request.state.project_id),
            #
            queue=queue_query_request.queue,
            #
            windowing=queue_query_request.windowing,
        )

        queues_response = EvaluationQueuesResponse(
            count=len(queues),
            queues=queues,
        )

        return queues_response

    # GET /evaluations/queues/{queue_id}
    @intercept_exceptions()
    @suppress_exceptions(default=EvaluationQueueResponse(), exclude=[HTTPException])
    async def fetch_queue(
        self,
        request: Request,
        *,
        queue_id: UUID,
    ) -> EvaluationQueueResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATION_QUEUES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        queue = await self.evaluations_service.fetch_queue(
            project_id=UUID(request.state.project_id),
            #
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
        request: Request,
        *,
        queue_id: UUID,
        #
        queue_edit_request: EvaluationQueueEditRequest,
    ) -> EvaluationQueueResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_QUEUES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(queue_id) != str(queue_edit_request.queue.id):
            return EvaluationQueueResponse()

        queue = await self.evaluations_service.edit_queue(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
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
        request: Request,
        *,
        queue_id: UUID,
    ) -> EvaluationQueueIdResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_QUEUES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        _queue_id = await self.evaluations_service.delete_queue(
            project_id=UUID(request.state.project_id),
            #
            queue_id=queue_id,
        )

        queue_id_response = EvaluationQueueIdResponse(
            count=1 if _queue_id else 0,
            queue_id=_queue_id,
        )

        return queue_id_response

    # GET /evaluations/queues/{queue_id}/scenarios
    @intercept_exceptions()
    @suppress_exceptions(
        default=EvaluationQueueScenarioIdsResponse(), exclude=[HTTPException]
    )
    async def fetch_queue_scenarios(
        self,
        request: Request,
        *,
        queue_id: UUID,
        #
        user_id: Optional[UUID] = Query(None),
    ) -> EvaluationQueueScenarioIdsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATION_QUEUES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        scenario_ids = await self.evaluations_service.fetch_queue_scenarios(
            project_id=UUID(request.state.project_id),
            user_id=user_id,
            #
            queue_id=queue_id,
        )

        scenario_ids_response = EvaluationQueueScenarioIdsResponse(
            count=len(scenario_ids),
            scenario_ids=scenario_ids,
        )

        return scenario_ids_response

    # -- helpers ---------------------------------------------------------------

    async def _resolve_run_request(
        self,
        *,
        project_id: UUID,
        run: EvaluationRunCreate | EvaluationRunEdit,
        jit: bool = True,
    ) -> None:
        """Resolve evaluator artifact IDs → full reference chain on inbound requests.

        The frontend sends annotation steps with only an evaluator artifact ref.
        The service/DB layer expects evaluator, evaluator_variant, and
        evaluator_revision references.
        Controlled by jit (defaults to True).
        """
        if not jit:
            return

        if not run.data or not run.data.steps:
            return

        evaluators_service = self.evaluations_service.evaluators_service

        for step in run.data.steps:
            if step.type != "annotation":
                continue

            if "evaluator_revision" in step.references:
                continue

            if "evaluator" not in step.references:
                continue

            evaluator_ref = step.references["evaluator"]

            if not isinstance(evaluator_ref, Reference) or not evaluator_ref.id:
                continue

            evaluator_revision = await evaluators_service.fetch_evaluator_revision(
                project_id=project_id,
                evaluator_ref=Reference(id=evaluator_ref.id),
            )

            if evaluator_revision is None:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Could not resolve evaluator revision"
                        f" for evaluator {evaluator_ref.id}"
                    ),
                )

            evaluator_variant = await evaluators_service.fetch_evaluator_variant(
                project_id=project_id,
                evaluator_variant_ref=Reference(
                    id=evaluator_revision.variant_id,
                ),
            )

            evaluator = await evaluators_service.fetch_evaluator(
                project_id=project_id,
                evaluator_ref=Reference(id=evaluator_ref.id),
            )

            step.references["evaluator"] = Reference(
                id=evaluator.id,
                slug=evaluator.slug,
            )

            if evaluator_variant:
                step.references["evaluator_variant"] = Reference(
                    id=evaluator_variant.id,
                    slug=evaluator_variant.slug,
                )

            step.references["evaluator_revision"] = Reference(
                id=evaluator_revision.id,
                slug=evaluator_revision.slug,
                version=evaluator_revision.version,
            )

    async def _unresolve_run_response(
        self,
        *,
        project_id: UUID,
        run: EvaluationRun,
        jit: bool = True,
    ) -> None:
        """Strip evaluator_variant and evaluator_revision refs on outbound responses.

        The service/DB layer stores full reference chains.
        The frontend only needs the evaluator artifact ref.
        Controlled by jit (defaults to True).
        """
        if not jit:
            return

        if not run.data or not run.data.steps:
            return

        for step in run.data.steps:
            if step.type != "annotation":
                continue

            step.references.pop("evaluator_variant", None)
            step.references.pop("evaluator_revision", None)


class SimpleEvaluationsRouter:
    def __init__(
        self,
        *,
        simple_evaluations_service: SimpleEvaluationsService,
    ):
        self.simple_evaluations_service = simple_evaluations_service

        self.router = APIRouter()

        # SIMPLE EVALUATIONS ---------------------------------------------------

        # POST /api/simple/evaluations/
        self.router.add_api_route(
            path="/",
            methods=["POST"],
            endpoint=self.create_evaluation,
            response_model=SimpleEvaluationResponse,
            response_model_exclude_none=True,
        )

        # GET /api/simple/evaluations/{evaluation_id}
        self.router.add_api_route(
            path="/{evaluation_id}",
            methods=["GET"],
            endpoint=self.fetch_evaluation,
            response_model=SimpleEvaluationResponse,
            response_model_exclude_none=True,
        )

        # PATCH /api/simple/evaluations/{evaluation_id}
        self.router.add_api_route(
            path="/{evaluation_id}",
            methods=["PATCH"],
            endpoint=self.edit_evaluation,
            response_model=SimpleEvaluationResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/simple/evaluations/{evaluation_id}
        self.router.add_api_route(
            path="/{evaluation_id}",
            methods=["DELETE"],
            endpoint=self.delete_evaluation,
            response_model=SimpleEvaluationIdResponse,
            response_model_exclude_none=True,
        )

        # POST /api/simple/evaluations/query
        self.router.add_api_route(
            path="/query",
            methods=["POST"],
            endpoint=self.query_evaluations,
            response_model=SimpleEvaluationsResponse,
            response_model_exclude_none=True,
        )

        # POST /api/simple/evaluations/{evaluation_id}/start
        self.router.add_api_route(
            path="/{evaluation_id}/start",
            methods=["POST"],
            endpoint=self.start_evaluation,
            response_model=SimpleEvaluationResponse,
            response_model_exclude_none=True,
            operation_id="start_simple_evaluation",
        )

        # POST /api/simple/evaluations/{evaluation_id}/stop
        self.router.add_api_route(
            path="/{evaluation_id}/stop",
            methods=["POST"],
            endpoint=self.stop_evaluation,
            response_model=SimpleEvaluationResponse,
            response_model_exclude_none=True,
        )

        # POST /api/simpleEvaluations/{evaluation_id}/close
        self.router.add_api_route(
            path="/{evaluation_id}/close",
            methods=["POST"],
            endpoint=self.close_evaluation,
            response_model=SimpleEvaluationResponse,
            response_model_exclude_none=True,
        )

        # POST /api/simple/evaluations/{evaluation_id}/open
        self.router.add_api_route(
            path="/{evaluation_id}/open",
            methods=["POST"],
            endpoint=self.open_evaluation,
            response_model=SimpleEvaluationResponse,
            response_model_exclude_none=True,
        )

    # SIMPLE EVALUATIONS -------------------------------------------------------

    # POST /api/simple/evaluations/
    @intercept_exceptions()
    async def create_evaluation(
        self,
        request: Request,
        *,
        evaluation_create_request: SimpleEvaluationCreateRequest,
    ) -> SimpleEvaluationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluation_create = evaluation_create_request.evaluation
        jit = evaluation_create_request.jit

        await self._resolve_evaluation_request(
            project_id=UUID(request.state.project_id),
            evaluation=evaluation_create,
            jit=jit,
        )

        evaluation = await self.simple_evaluations_service.create(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluation=evaluation_create,
        )

        if evaluation:
            await self._unresolve_evaluation_response(
                project_id=UUID(request.state.project_id),
                evaluation=evaluation,
                jit=jit,
            )

        response = SimpleEvaluationResponse(
            count=1 if evaluation else 0,
            evaluation=evaluation,
        )

        return response

    # GET /api/simple/evaluations/{evaluation_id}
    @intercept_exceptions()
    @suppress_exceptions(default=SimpleEvaluationResponse(), exclude=[HTTPException])
    async def fetch_evaluation(
        self,
        request: Request,
        *,
        evaluation_id: UUID,
    ) -> SimpleEvaluationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluation = await self.simple_evaluations_service.fetch(
            project_id=UUID(request.state.project_id),
            #
            evaluation_id=evaluation_id,
        )

        if evaluation:
            await self._unresolve_evaluation_response(
                project_id=UUID(request.state.project_id),
                evaluation=evaluation,
            )

        response = SimpleEvaluationResponse(
            count=1 if evaluation else 0,
            evaluation=evaluation,
        )

        return response

    # PATCH /api/simple/evaluations/{evaluation_id}
    @intercept_exceptions()
    async def edit_evaluation(
        self,
        request: Request,
        *,
        evaluation_id: UUID,
        #
        evaluation_edit_request: SimpleEvaluationEditRequest,
    ) -> SimpleEvaluationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(evaluation_id) != str(evaluation_edit_request.evaluation.id):
            return SimpleEvaluationResponse()

        evaluation_edit = evaluation_edit_request.evaluation
        jit = evaluation_edit_request.jit

        await self._resolve_evaluation_request(
            project_id=UUID(request.state.project_id),
            evaluation=evaluation_edit,
            jit=jit,
        )

        evaluation = await self.simple_evaluations_service.edit(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluation=evaluation_edit,
        )

        if evaluation:
            await self._unresolve_evaluation_response(
                project_id=UUID(request.state.project_id),
                evaluation=evaluation,
                jit=jit,
            )

        response = SimpleEvaluationResponse(
            count=1 if evaluation else 0,
            evaluation=evaluation,
        )

        return response

    # DELETE /api/simple/evaluations/{evaluation_id}
    @intercept_exceptions()
    async def delete_evaluation(
        self,
        request: Request,
        *,
        evaluation_id: UUID,
    ) -> SimpleEvaluationIdResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        deleted_evaluation_id = await self.simple_evaluations_service.delete(
            project_id=UUID(request.state.project_id),
            #
            evaluation_id=evaluation_id,
        )

        response = SimpleEvaluationIdResponse(
            count=1 if deleted_evaluation_id else 0,
            evaluation_id=deleted_evaluation_id,
        )

        return response

    # POST /api/simple/evaluations/query
    @intercept_exceptions()
    @suppress_exceptions(default=SimpleEvaluationsResponse(), exclude=[HTTPException])
    async def query_evaluations(
        self,
        request: Request,
        *,
        evaluation_query_request: SimpleEvaluationQueryRequest,
    ) -> SimpleEvaluationsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        jit = evaluation_query_request.jit

        evaluations = await self.simple_evaluations_service.query(
            project_id=UUID(request.state.project_id),
            #
            query=evaluation_query_request.evaluation,
        )

        for evaluation in evaluations:
            await self._unresolve_evaluation_response(
                project_id=UUID(request.state.project_id),
                evaluation=evaluation,
                jit=jit,
            )

        response = SimpleEvaluationsResponse(
            count=len(evaluations),
            evaluations=evaluations,
        )

        return response

    # POST /api/simple/evaluations/{evaluation_id}/start
    @intercept_exceptions()
    async def start_evaluation(
        self,
        request: Request,
        *,
        evaluation_id: UUID,
    ) -> SimpleEvaluationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluation = await self.simple_evaluations_service.start(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluation_id=evaluation_id,
        )

        if evaluation:
            await self._unresolve_evaluation_response(
                project_id=UUID(request.state.project_id),
                evaluation=evaluation,
            )

        response = SimpleEvaluationResponse(
            count=1 if evaluation else 0,
            evaluation=evaluation,
        )

        return response

    # POST /api/simple/evaluations/{evaluation_id}/stop
    @intercept_exceptions()
    async def stop_evaluation(
        self,
        request: Request,
        *,
        evaluation_id: UUID,
    ) -> SimpleEvaluationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluation = await self.simple_evaluations_service.stop(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluation_id=evaluation_id,
        )

        if evaluation:
            await self._unresolve_evaluation_response(
                project_id=UUID(request.state.project_id),
                evaluation=evaluation,
            )

        response = SimpleEvaluationResponse(
            count=1 if evaluation else 0,
            evaluation=evaluation,
        )

        return response

    # POST /api/simple/evaluations/{evaluation_id}/close
    @intercept_exceptions()
    async def close_evaluation(
        self,
        request: Request,
        *,
        evaluation_id: UUID,
    ) -> SimpleEvaluationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluation = await self.simple_evaluations_service.close(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluation_id=evaluation_id,
        )

        if evaluation:
            await self._unresolve_evaluation_response(
                project_id=UUID(request.state.project_id),
                evaluation=evaluation,
            )

        response = SimpleEvaluationResponse(
            count=1 if evaluation else 0,
            evaluation=evaluation,
        )

        return response

    # POST /api/simple/evaluations/{evaluation_id}/open
    @intercept_exceptions()
    async def open_evaluation(
        self,
        request: Request,
        *,
        evaluation_id: UUID,
    ) -> SimpleEvaluationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATION_RUNS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluation = await self.simple_evaluations_service.open(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluation_id=evaluation_id,
        )

        if evaluation:
            await self._unresolve_evaluation_response(
                project_id=UUID(request.state.project_id),
                evaluation=evaluation,
            )

        response = SimpleEvaluationResponse(
            count=1 if evaluation else 0,
            evaluation=evaluation,
        )

        return response

    # -- helpers ---------------------------------------------------------------

    async def _resolve_evaluation_request(
        self,
        *,
        project_id: UUID,
        evaluation: SimpleEvaluationCreate | SimpleEvaluationEdit,
        jit: bool = True,
    ) -> None:
        """Resolve evaluator artifact IDs → revision IDs on inbound requests.

        The frontend sends evaluator artifact IDs in evaluator_steps.
        The service/DB layer expects revision IDs.
        Controlled by jit (defaults to True).
        """
        if not jit:
            return

        if not evaluation.data or not evaluation.data.evaluator_steps:
            return

        evaluator_steps = evaluation.data.evaluator_steps
        evaluators_service = self.simple_evaluations_service.evaluators_service

        if isinstance(evaluator_steps, list):
            evaluator_steps = {eid: "auto" for eid in evaluator_steps}

        resolved: dict[UUID, str] = {}

        for evaluator_id, origin in evaluator_steps.items():
            evaluator_revision = await evaluators_service.fetch_evaluator_revision(
                project_id=project_id,
                #
                evaluator_ref=Reference(id=evaluator_id),
            )

            if evaluator_revision is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not resolve evaluator revision for evaluator {evaluator_id}",
                )

            resolved[evaluator_revision.id] = origin

        evaluation.data.evaluator_steps = resolved

    async def _unresolve_evaluation_response(
        self,
        *,
        project_id: UUID,
        evaluation: SimpleEvaluation,
        jit: bool = True,
    ) -> None:
        """Resolve evaluator revision IDs → artifact IDs on outbound responses.

        The service/DB layer stores revision IDs in evaluator_steps.
        The frontend expects the artifact IDs it originally wrote.
        Controlled by jit (defaults to True).
        """
        if not jit:
            return

        if not evaluation.data or not evaluation.data.evaluator_steps:
            return

        evaluator_steps = evaluation.data.evaluator_steps
        evaluators_service = self.simple_evaluations_service.evaluators_service

        if isinstance(evaluator_steps, list):
            evaluator_steps = {eid: "auto" for eid in evaluator_steps}

        resolved: dict[UUID, str] = {}

        for revision_id, origin in evaluator_steps.items():
            evaluator_revision = await evaluators_service.fetch_evaluator_revision(
                project_id=project_id,
                #
                evaluator_revision_ref=Reference(id=revision_id),
            )

            if evaluator_revision is None or evaluator_revision.evaluator_id is None:
                resolved[revision_id] = origin
                continue

            resolved[evaluator_revision.evaluator_id] = origin

        evaluation.data.evaluator_steps = resolved
