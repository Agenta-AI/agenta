from typing import List, Optional, Tuple, Dict, Any, TYPE_CHECKING
from uuid import UUID
from asyncio import sleep
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from genson import SchemaBuilder

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import Reference, Windowing, Tags, Meta
from oss.src.core.evaluations.interfaces import EvaluationsDAOInterface
from oss.src.core.evaluations.types import (
    EvaluationStatus,
    # EVALUATION RUN
    EvaluationRunFlags,
    EvaluationRunDataMappingColumn,
    EvaluationRunDataMappingStep,
    EvaluationRunDataMapping,
    EvaluationRunDataStepInput,
    EvaluationRunDataStep,
    EvaluationRunData,
    EvaluationRun,
    EvaluationRunCreate,
    EvaluationRunEdit,
    EvaluationRunQuery,
    # EVALUATION SCENARIO
    EvaluationScenario,
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationScenarioQuery,
    # EVALUATION RESULT
    EvaluationResult,
    EvaluationResultCreate,
    EvaluationResultEdit,
    EvaluationResultQuery,
    # EVALUATION METRICS
    EvaluationMetrics,
    EvaluationMetricsCreate,
    EvaluationMetricsEdit,
    EvaluationMetricsQuery,
    EvaluationMetricsRefresh,
    # EVALUATION QUEUE
    EvaluationQueue,
    EvaluationQueueCreate,
    EvaluationQueueEdit,
    EvaluationQueueQuery,
)
from oss.src.core.evaluations.types import (
    Target,
    Origin,
    #
    SimpleEvaluationFlags,
    SimpleEvaluationData,
    SimpleEvaluationStatus,
    #
    SimpleEvaluation,
    SimpleEvaluationCreate,
    SimpleEvaluationEdit,
    SimpleEvaluationQuery,
)
from oss.src.core.evaluations.types import CURRENT_VERSION
from oss.src.core.tracing.dtos import (
    TracingQuery,
    Filtering,
    Condition,
    ListOperator,
    MetricSpec,
    MetricType,
)
from oss.src.core.tracing.service import TracingService

from oss.src.core.evaluators.service import EvaluatorsService

from oss.src.core.queries.dtos import QueryRevision
from oss.src.core.testcases.dtos import Testcase
from oss.src.core.testsets.dtos import TestsetRevision
from oss.src.core.evaluators.dtos import EvaluatorRevision
from oss.src.core.queries.service import QueriesService
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.applications.services import ApplicationsService

from oss.src.core.evaluations.utils import filter_scenario_ids

from oss.src.utils.helpers import get_slug_from_name_and_id
from oss.src.core.evaluations.utils import get_metrics_keys_from_schema


log = get_module_logger(__name__)

if TYPE_CHECKING:
    from oss.src.tasks.taskiq.evaluations.worker import EvaluationsWorker


SAFE_CLOSE_DELAY = 1  # seconds
DEFAULT_ORIGIN_QUERIES = "custom"
DEFAULT_ORIGIN_TESTSETS = "custom"
DEFAULT_ORIGIN_APPLICATIONS = "custom"
DEFAULT_ORIGIN_EVALUATORS = "custom"
DEFAULT_ORIGIN = dict(
    queries=DEFAULT_ORIGIN_QUERIES,
    testsets=DEFAULT_ORIGIN_TESTSETS,
    applications=DEFAULT_ORIGIN_APPLICATIONS,
    evaluators=DEFAULT_ORIGIN_EVALUATORS,
)

DEFAULT_METRICS = [
    {
        "path": "attributes.ag.metrics.duration.cumulative",
        "type": "numeric/continuous",
    },
    {
        "path": "attributes.ag.metrics.errors.cumulative",
        "type": "numeric/continuous",
    },
    {
        "path": "attributes.ag.metrics.costs.cumulative.total",
        "type": "numeric/continuous",
    },
    {
        "path": "attributes.ag.metrics.tokens.cumulative.total",
        "type": "numeric/continuous",
    },
]

DEFAULT_REFRESH_INTERVAL = 1  # minute(s)


class EvaluationsService:
    def __init__(
        self,
        evaluations_dao: EvaluationsDAOInterface,
        tracing_service: TracingService,
        queries_service: QueriesService,
        testsets_service: TestsetsService,
        evaluators_service: EvaluatorsService,
        evaluations_worker: Optional["EvaluationsWorker"] = None,
    ):
        self.evaluations_dao = evaluations_dao

        self.tracing_service = tracing_service
        self.queries_service = queries_service
        self.testsets_service = testsets_service
        self.evaluators_service = evaluators_service
        self.evaluations_worker = evaluations_worker

    ### CRUD

    # - EVALUATION RUN ---------------------------------------------------------

    async def refresh_runs(
        self,
        *,
        timestamp: datetime,
        interval: int = DEFAULT_REFRESH_INTERVAL,
    ) -> bool:
        log.info(f"[LIVE] Refreshing runs at {timestamp} every {interval} minute(s)")

        if not timestamp:
            return False

        newest = timestamp + timedelta(minutes=interval or 0)
        oldest = timestamp

        try:
            ext_runs = await self.fetch_live_runs()
        except Exception as e:
            log.error(f"[LIVE] Error fetching live runs: {e}", exc_info=True)
            log.error(e, exc_info=True)
            return False

        if self.evaluations_worker is None:
            log.warning(
                "[LIVE] Taskiq client is not configured; skipping live run dispatch"
            )
            return False

        for project_id, run in ext_runs:
            user_id = run.created_by_id

            try:
                log.info(
                    "[LIVE] Dispatching...",
                    project_id=project_id,
                    run_id=run.id,
                    #
                    newest=newest,
                    oldest=oldest,
                )

                await self.evaluations_worker.evaluate_live_query.kiq(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    run_id=run.id,
                    #
                    newest=newest,
                    oldest=oldest,
                )

                log.info(
                    "[LIVE] Dispatched.   ",
                    project_id=project_id,
                    run_id=run.id,
                )

            except Exception as e:  # pylint: disable=broad-exception-caught
                log.error(f"[LIVE] Error refreshing run {run.id}: {e}", exc_info=True)

        return True

    async def fetch_live_runs(
        self,
        *,
        windowing: Optional[Windowing] = None,
    ) -> List[Tuple[UUID, EvaluationRun]]:
        ext_runs = await self.evaluations_dao.fetch_live_runs(
            windowing=windowing,
        )

        return ext_runs

    async def create_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run: EvaluationRunCreate,
    ) -> Optional[EvaluationRun]:
        run.version = CURRENT_VERSION

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
        for run in runs:
            run.version = CURRENT_VERSION

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
        run.version = CURRENT_VERSION

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
        for run in runs:
            run.version = CURRENT_VERSION

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

    async def close_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        #
        status: Optional[EvaluationStatus] = None,
    ) -> Optional[EvaluationRun]:
        return await self.evaluations_dao.close_run(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=run_id,
            #
            status=status,
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

    async def open_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        return await self.evaluations_dao.open_run(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=run_id,
        )

    async def open_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[EvaluationRun]:
        return await self.evaluations_dao.open_runs(
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
        run: Optional[EvaluationRunQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationRun]:
        return await self.evaluations_dao.query_runs(
            project_id=project_id,
            #
            run=run,
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
        scenario.version = CURRENT_VERSION

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
        for scenario in scenarios:
            scenario.version = CURRENT_VERSION

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
        scenario.version = CURRENT_VERSION

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
        for scenario in scenarios:
            scenario.version = CURRENT_VERSION

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
        scenario: Optional[EvaluationScenarioQuery] = None,
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

    # - EVALUATION RESULT ------------------------------------------------------

    async def create_result(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        result: EvaluationResultCreate,
    ) -> Optional[EvaluationResult]:
        result.version = CURRENT_VERSION

        return await self.evaluations_dao.create_result(
            project_id=project_id,
            user_id=user_id,
            #
            result=result,
        )

    async def create_results(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        results: List[EvaluationResultCreate],
    ) -> List[EvaluationResult]:
        for result in results:
            result.version = CURRENT_VERSION

        return await self.evaluations_dao.create_results(
            project_id=project_id,
            user_id=user_id,
            #
            results=results,
        )

    async def fetch_result(
        self,
        *,
        project_id: UUID,
        #
        result_id: UUID,
    ) -> Optional[EvaluationResult]:
        return await self.evaluations_dao.fetch_result(
            project_id=project_id,
            #
            result_id=result_id,
        )

    async def fetch_results(
        self,
        *,
        project_id: UUID,
        #
        result_ids: List[UUID],
    ) -> List[EvaluationResult]:
        return await self.evaluations_dao.fetch_results(
            project_id=project_id,
            #
            result_ids=result_ids,
        )

    async def edit_result(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        result: EvaluationResultEdit,
    ) -> Optional[EvaluationResult]:
        result.version = CURRENT_VERSION

        return await self.evaluations_dao.edit_result(
            project_id=project_id,
            user_id=user_id,
            #
            result=result,
        )

    async def edit_results(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        results: List[EvaluationResultEdit],
    ) -> List[EvaluationResult]:
        for result in results:
            result.version = CURRENT_VERSION

        return await self.evaluations_dao.edit_results(
            project_id=project_id,
            user_id=user_id,
            #
            results=results,
        )

    async def delete_result(
        self,
        *,
        project_id: UUID,
        #
        result_id: UUID,
    ) -> Optional[UUID]:
        return await self.evaluations_dao.delete_result(
            project_id=project_id,
            #
            result_id=result_id,
        )

    async def delete_results(
        self,
        *,
        project_id: UUID,
        #
        result_ids: List[UUID],
    ) -> List[UUID]:
        return await self.evaluations_dao.delete_results(
            project_id=project_id,
            #
            result_ids=result_ids,
        )

    async def query_results(
        self,
        *,
        project_id: UUID,
        #
        result: Optional[EvaluationResultQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationResult]:
        return await self.evaluations_dao.query_results(
            project_id=project_id,
            #
            result=result,
            #
            windowing=windowing,
        )

    # - EVALUATION METRIC ------------------------------------------------------

    async def create_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metrics: List[EvaluationMetricsCreate],
    ) -> List[EvaluationMetrics]:
        for metric in metrics:
            metric.version = CURRENT_VERSION

        return await self.evaluations_dao.create_metrics(
            project_id=project_id,
            user_id=user_id,
            #
            metrics=metrics,
        )

    async def fetch_metrics(
        self,
        *,
        project_id: UUID,
        #
        metrics_ids: List[UUID],
    ) -> List[EvaluationMetrics]:
        return await self.evaluations_dao.fetch_metrics(
            project_id=project_id,
            #
            metrics_ids=metrics_ids,
        )

    async def edit_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metrics: List[EvaluationMetricsEdit],
    ) -> List[EvaluationMetrics]:
        for metric in metrics:
            metric.version = CURRENT_VERSION

        return await self.evaluations_dao.edit_metrics(
            project_id=project_id,
            user_id=user_id,
            #
            metrics=metrics,
        )

    async def delete_metrics(
        self,
        *,
        project_id: UUID,
        #
        metrics_ids: List[UUID],
    ) -> List[UUID]:
        return await self.evaluations_dao.delete_metrics(
            project_id=project_id,
            #
            metrics_ids=metrics_ids,
        )

    async def query_metrics(
        self,
        *,
        project_id: UUID,
        #
        metric: Optional[EvaluationMetricsQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationMetrics]:
        return await self.evaluations_dao.query_metrics(
            project_id=project_id,
            #
            metric=metric,
            #
            windowing=windowing,
        )

    async def refresh_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metrics: EvaluationMetricsRefresh,
    ) -> List[EvaluationMetrics]:
        # Extract values from the request body
        run_id = metrics.run_id
        run_ids = metrics.run_ids
        scenario_id = metrics.scenario_id
        scenario_ids = metrics.scenario_ids
        timestamp = metrics.timestamp
        timestamps = metrics.timestamps
        interval = metrics.interval

        log.info(
            "[METRICS] [REFRESH]",
            run_id=run_id,
            run_ids=run_ids,
            scenario_id=scenario_id,
            scenario_ids=scenario_ids,
            timestamp=timestamp,
            timestamps=timestamps,
            interval=interval,
        )

        all_metrics = []

        if run_ids:
            for _run_id in run_ids:
                result = await self._refresh_metrics(
                    project_id=project_id,
                    user_id=user_id,
                    run_id=_run_id,
                )
                all_metrics.extend(result)
            return all_metrics

        # !run_ids
        elif not run_id:
            return list()

        # !run_ids & run_id
        elif scenario_ids:
            for _scenario_id in scenario_ids:
                result = await self._refresh_metrics(
                    project_id=project_id,
                    user_id=user_id,
                    run_id=run_id,
                    scenario_id=_scenario_id,
                )
                all_metrics.extend(result)
            return all_metrics

        # !run_ids & run_id & !scenario_ids
        elif timestamps:
            for _timestamp in timestamps:
                result = await self._refresh_metrics(
                    project_id=project_id,
                    user_id=user_id,
                    run_id=run_id,
                    timestamp=_timestamp,
                    interval=interval,
                )
                all_metrics.extend(result)
            return all_metrics

        # !run_ids & run_id & !scenario_ids & !timestamps
        else:
            return await self._refresh_metrics(
                project_id=project_id,
                user_id=user_id,
                run_id=run_id,
                scenario_id=scenario_id,
                timestamp=timestamp,
                interval=interval,
            )

    async def _refresh_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        scenario_id: Optional[UUID] = None,
        timestamp: Optional[datetime] = None,
        interval: Optional[int] = None,
    ) -> List[EvaluationMetrics]:
        metrics_data: Dict[str, Any] = dict()

        run = await self.fetch_run(
            project_id=project_id,
            #
            run_id=run_id,
        )

        if not run or not run.data or not run.data.steps:
            log.warning("run or run.data or run.data.steps not found")
            return []

        steps_metrics_keys: Dict[str, List[Dict[str, str]]] = {
            step.key: [] for step in run.data.steps if step.type == "annotation"
        }

        if not steps_metrics_keys:
            log.warning("No steps metrics keys found")
            return []

        step_keys = list(steps_metrics_keys.keys())

        steps_trace_ids: Dict[str, List[str]] = dict()

        for step_key in step_keys:
            results = await self.query_results(
                project_id=project_id,
                result=EvaluationResultQuery(
                    run_id=run_id,
                    scenario_id=scenario_id,
                    step_key=step_key,
                    timestamp=timestamp,
                    interval=interval,
                ),
            )

            if not results:
                log.warning(f"No results found for step_key: {step_key}")
                continue

            trace_ids: List[str] | None = [
                result.trace_id for result in results if result.trace_id
            ]

            if trace_ids:
                steps_trace_ids[step_key] = trace_ids

        if not steps_trace_ids:
            log.warning("[METRICS] No trace_ids found! Cannot extract metrics.")
            return []

        inferred_metrics_keys_by_step: Dict[str, List[Dict[str, str]]] = {}

        for step in run.data.steps:
            steps_metrics_keys[step.key] = deepcopy(DEFAULT_METRICS)

            if step.type == "annotation":
                evaluator_revision_ref = step.references.get("evaluator_revision")

                if not evaluator_revision_ref:
                    log.warning("Evaluator revision reference not found")
                    continue

                evaluator_revision = (
                    await self.evaluators_service.fetch_evaluator_revision(
                        project_id=project_id,
                        evaluator_revision_ref=evaluator_revision_ref,
                    )
                )

                if not evaluator_revision:
                    log.warning("Evaluator revision not found")
                    continue

                outputs_schema = None
                service_format = None

                if evaluator_revision.data:
                    if evaluator_revision.data.schemas:
                        outputs_schema = evaluator_revision.data.schemas.outputs
                    if evaluator_revision.data.service:
                        service_format = evaluator_revision.data.service.get("format")

                if outputs_schema:
                    metrics_keys = get_metrics_keys_from_schema(
                        schema=outputs_schema,
                    )
                elif service_format:
                    metrics_keys = get_metrics_keys_from_schema(
                        schema=service_format,
                    )
                else:
                    trace_ids = steps_trace_ids.get(step.key)

                    if not trace_ids:
                        log.warning(
                            f"[METRICS] Step '{step.key}': no trace_ids found for schema inference"
                        )
                        continue

                    inferred_schema = await self._infer_evaluator_schema_from_traces(
                        project_id=project_id,
                        trace_ids=trace_ids,
                    )

                    if not inferred_schema:
                        log.warning(
                            f"[METRICS] Step '{step.key}': could not infer outputs schema"
                        )
                        continue

                    metrics_keys = get_metrics_keys_from_schema(
                        schema=inferred_schema,
                    )

                    inferred_metrics_keys_by_step[step.key] = metrics_keys

                steps_metrics_keys[step.key] += [
                    {
                        "path": "attributes.ag.data.outputs."
                        + metric_key.get("path", ""),
                        "type": metric_key.get("type", ""),
                    }
                    for metric_key in metrics_keys
                ]

        if inferred_metrics_keys_by_step and run and run.data:
            await self._update_run_mappings_from_inferred_metrics(
                project_id=project_id,
                user_id=user_id,
                run=run,
                inferred_metrics_keys_by_step=inferred_metrics_keys_by_step,
            )

        steps_specs: Dict[str, List[MetricSpec]] = dict()

        intersection = steps_metrics_keys.keys() & steps_trace_ids.keys()
        # log.info(f"[METRICS] Intersection of keys: {intersection}")

        if not intersection:
            log.warning(
                "[METRICS] Empty intersection! No steps match between metrics_keys and trace_ids"
            )
            return []

        for step_key in intersection:
            step_metrics_keys = steps_metrics_keys[step_key]
            step_trace_ids = steps_trace_ids[step_key]

            # log.info(
            #     f"[METRICS] Processing step '{step_key}' with {len(step_trace_ids)} trace_ids"
            # )

            try:
                query = TracingQuery(
                    windowing=Windowing(
                        oldest=datetime(1970, 1, 1, tzinfo=timezone.utc),
                        newest=None,
                    ),
                    filtering=Filtering(
                        conditions=[
                            Condition(
                                field="trace_id",
                                operator=ListOperator.IN,
                                value=step_trace_ids,
                            )
                        ]
                    ),
                )

                specs = [
                    MetricSpec(
                        type=MetricType(metric.get("type")),
                        path=metric.get("path") or "*",
                    )
                    for metric in step_metrics_keys
                ] + [
                    MetricSpec(
                        type=MetricType.JSON,
                        path="attributes.ag",
                    )
                ]

                # log.info(f"[METRICS] Step '{step_key}': {len(specs)} metric specs")
                steps_specs[step_key] = specs

                buckets = await self.tracing_service.analytics(
                    project_id=project_id,
                    #
                    query=query,
                    specs=specs,
                )

                # log.info(
                #     f"[METRICS] Step '{step_key}': analytics returned {len(buckets)} buckets"
                # )

                if len(buckets) == 0:
                    log.warning(
                        f"Step '{step_key}': No metrics from analytics (0 buckets)"
                    )
                    continue

                if len(buckets) != 1:
                    log.warning("There should be one and only one bucket")
                    log.warning("Buckets:", buckets)
                    continue

                bucket = buckets[0]

                # log.info(
                #     f"[METRICS] Step '{step_key}': bucket has metrics: {bool(bucket.metrics)}"
                # )
                # if bucket.metrics:
                #     log.info(
                #         f"[METRICS] Step '{step_key}': metrics keys: {list(bucket.metrics.keys())}"
                #     )

                if not bucket.metrics:
                    log.warning("Bucket metrics should not be empty")
                    log.warning("Bucket:", bucket)
                    continue

                metrics_data |= {step_key: bucket.metrics}
                # log.info(f"[METRICS] Step '{step_key}': added to metrics_data")

            except Exception:
                log.error(
                    f"[METRICS] Step '{step_key}': Exception during analytics",
                    exc_info=True,
                )

        if not metrics_data:
            # log.warning("No metrics data: no metrics will be stored")
            return []

        metrics_create = [
            EvaluationMetricsCreate(
                run_id=run_id,
                scenario_id=scenario_id,
                timestamp=timestamp,
                interval=interval,
                #
                status=EvaluationStatus.SUCCESS,
                #
                data=metrics_data,
            )
        ]

        metrics = await self.create_metrics(
            project_id=project_id,
            user_id=user_id,
            #
            metrics=metrics_create,
        )

        return metrics

    async def _infer_evaluator_schema_from_traces(
        self,
        *,
        project_id: UUID,
        trace_ids: List[str],
    ) -> Optional[Dict[str, Any]]:
        """Infer the outputs schema from trace attributes."""
        try:
            if not trace_ids:
                return None

            # Use a sample of trace IDs (first 5) to infer schema
            sample_trace_ids = trace_ids[:5]

            query = TracingQuery(
                windowing=Windowing(
                    oldest=datetime(1970, 1, 1, tzinfo=timezone.utc),
                    newest=None,
                ),
                filtering=Filtering(
                    conditions=[
                        Condition(
                            field="trace_id",
                            operator=ListOperator.IN,
                            value=sample_trace_ids,
                        )
                    ]
                ),
            )

            spans = await self.tracing_service.query(
                project_id=project_id,
                query=query,
            )

            # Build schema from trace outputs
            builder = SchemaBuilder()
            found_outputs = False

            for span in spans:
                attributes = span.attributes
                if not isinstance(attributes, dict):
                    continue

                ag_attributes = attributes.get("ag")
                if not isinstance(ag_attributes, dict):
                    continue

                data = ag_attributes.get("data")
                if not isinstance(data, dict):
                    continue

                outputs = data.get("outputs")
                if outputs is None:
                    continue

                builder.add_object(outputs)
                found_outputs = True

            if not found_outputs:
                return None

            schema = builder.to_schema()
            return schema

        except Exception as e:
            log.warning(f"[METRICS] Failed to infer evaluator schema from traces: {e}")
            return None

    async def _update_run_mappings_from_inferred_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run: EvaluationRun,
        inferred_metrics_keys_by_step: Dict[str, List[Dict[str, str]]],
    ) -> None:
        existing_mappings = list(run.data.mappings or [])
        updated_mappings: List[EvaluationRunDataMapping] = []
        seen_mapping_keys: set[tuple[str, str, str, str]] = set()

        def mapping_key(
            mapping: EvaluationRunDataMapping,
        ) -> Optional[tuple[str, str, str, str]]:
            if not mapping.step or not mapping.column:
                return None
            return (
                mapping.step.key,
                mapping.column.kind,
                mapping.column.name,
                mapping.step.path,
            )

        for mapping in existing_mappings:
            if (
                mapping.step
                and mapping.column
                and mapping.column.kind == "annotation"
                and mapping.step.key in inferred_metrics_keys_by_step
                and (
                    mapping.column.name == "outputs"
                    or mapping.step.path.endswith("outputs.outputs")
                )
            ):
                continue
            key = mapping_key(mapping)
            if key and key in seen_mapping_keys:
                continue
            if key:
                seen_mapping_keys.add(key)
            updated_mappings.append(mapping)

        for step_key, metrics_keys in inferred_metrics_keys_by_step.items():
            for metric_key in metrics_keys:
                path_suffix = metric_key.get("path", "")
                new_key = (
                    step_key,
                    "annotation",
                    path_suffix,
                    "attributes.ag.data.outputs"
                    + (f".{path_suffix}" if path_suffix else ""),
                )
                if new_key in seen_mapping_keys:
                    continue
                seen_mapping_keys.add(new_key)
                updated_mappings.append(
                    EvaluationRunDataMapping(
                        column=EvaluationRunDataMappingColumn(
                            kind="annotation",
                            name=path_suffix,
                        ),
                        step=EvaluationRunDataMappingStep(
                            key=step_key,
                            path=(
                                "attributes.ag.data.outputs"
                                + (f".{path_suffix}" if path_suffix else "")
                            ),
                        ),
                    )
                )

        if updated_mappings != existing_mappings:
            run_data = EvaluationRunData(
                steps=run.data.steps,
                repeats=run.data.repeats,
                mappings=updated_mappings,
            )
            await self.edit_run(
                project_id=project_id,
                user_id=user_id,
                run=EvaluationRunEdit(
                    id=run.id,
                    name=run.name,
                    description=run.description,
                    status=run.status,
                    flags=run.flags,
                    data=run_data,
                ),
            )

    # - EVALUATION QUEUE -------------------------------------------------------

    async def create_queue(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        queue: EvaluationQueueCreate,
    ) -> Optional[EvaluationQueue]:
        queue.version = CURRENT_VERSION

        return await self.evaluations_dao.create_queue(
            project_id=project_id,
            user_id=user_id,
            #
            queue=queue,
        )

    async def create_queues(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        queues: List[EvaluationQueueCreate],
    ) -> List[EvaluationQueue]:
        for queue in queues:
            queue.version = CURRENT_VERSION

        return await self.evaluations_dao.create_queues(
            project_id=project_id,
            user_id=user_id,
            #
            queues=queues,
        )

    async def fetch_queue(
        self,
        *,
        project_id: UUID,
        #
        queue_id: UUID,
    ) -> Optional[EvaluationQueue]:
        return await self.evaluations_dao.fetch_queue(
            project_id=project_id,
            #
            queue_id=queue_id,
        )

    async def fetch_queues(
        self,
        *,
        project_id: UUID,
        #
        queue_ids: List[UUID],
    ) -> List[EvaluationQueue]:
        return await self.evaluations_dao.fetch_queues(
            project_id=project_id,
            #
            queue_ids=queue_ids,
        )

    async def edit_queue(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        queue: EvaluationQueueEdit,
    ) -> Optional[EvaluationQueue]:
        queue.version = CURRENT_VERSION

        return await self.evaluations_dao.edit_queue(
            project_id=project_id,
            user_id=user_id,
            #
            queue=queue,
        )

    async def edit_queues(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        queues: List[EvaluationQueueEdit],
    ) -> List[EvaluationQueue]:
        for queue in queues:
            queue.version = CURRENT_VERSION

        return await self.evaluations_dao.edit_queues(
            project_id=project_id,
            user_id=user_id,
            #
            queues=queues,
        )

    async def delete_queue(
        self,
        *,
        project_id: UUID,
        #
        queue_id: UUID,
    ) -> Optional[UUID]:
        return await self.evaluations_dao.delete_queue(
            project_id=project_id,
            #
            queue_id=queue_id,
        )

    async def delete_queues(
        self,
        *,
        project_id: UUID,
        #
        queue_ids: List[UUID],
    ) -> List[UUID]:
        return await self.evaluations_dao.delete_queues(
            project_id=project_id,
            #
            queue_ids=queue_ids,
        )

    async def query_queues(
        self,
        *,
        project_id: UUID,
        #
        queue: Optional[EvaluationQueueQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationQueue]:
        return await self.evaluations_dao.query_queues(
            project_id=project_id,
            #
            queue=queue,
            #
            windowing=windowing,
        )

    async def fetch_queue_scenarios(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        queue_id: UUID,
        #
    ) -> List[List[UUID]]:
        queue = await self.fetch_queue(
            project_id=project_id,
            queue_id=queue_id,
        )

        if not queue:
            return []

        queue_scenario_ids = queue.data.scenario_ids if queue.data else None

        scenarios = await self.query_scenarios(
            project_id=project_id,
            scenario=EvaluationScenarioQuery(
                run_id=queue.run_id,
                ids=queue_scenario_ids,
            ),
        )

        run_scenario_ids = [scenario.id for scenario in scenarios]
        run_scenario_ids = [id for id in run_scenario_ids if id is not None]

        queue_user_ids = queue.data.user_ids if queue.data else None

        if not queue_user_ids:
            return [run_scenario_ids]

        is_sequential = queue.flags and queue.flags.is_sequential or False

        user_scenario_ids = filter_scenario_ids(
            user_id,
            queue_user_ids,
            run_scenario_ids,
            is_sequential,
        )

        return user_scenario_ids


class SimpleEvaluationsService:
    def __init__(
        self,
        testsets_service: TestsetsService,
        queries_service: QueriesService,
        applications_service: ApplicationsService,
        evaluators_service: EvaluatorsService,
        evaluations_service: EvaluationsService,
        evaluations_worker: Optional["EvaluationsWorker"] = None,
    ):
        self.testsets_service = testsets_service
        self.queries_service = queries_service
        self.applications_service = applications_service
        self.evaluators_service = evaluators_service
        self.evaluations_service = evaluations_service
        self.evaluations_worker = evaluations_worker

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluation: SimpleEvaluationCreate,
    ) -> Optional[SimpleEvaluation]:
        evaluation.flags = evaluation.flags or SimpleEvaluationFlags(
            is_closed=False,
            is_live=False,
            is_active=True,
        )

        if not evaluation.data:
            log.info("[EVAL] [failure] missing simple evaluation data")
            return None

        # ----------------------------------------------------------------------
        log.info("[EVAL] [create]")
        log.info("[EVAL] [scope]       ", project_id=project_id, user_id=user_id)
        log.info("[EVAL] [flags]       ", ids=evaluation.flags.model_dump(mode="json"))
        log.info("[EVAL] [status]      ", ids=evaluation.data.status)
        log.info("[EVAL] [queries]     ", ids=evaluation.data.query_steps)
        log.info("[EVAL] [testsets]    ", ids=evaluation.data.testset_steps)
        log.info("[EVAL] [applications]", ids=evaluation.data.application_steps)
        log.info("[EVAL] [evaluators]  ", ids=evaluation.data.evaluator_steps)
        log.info("[EVAL] [repeats]     ", repeats=evaluation.data.repeats)
        # ----------------------------------------------------------------------

        try:
            run_flags = await self._make_evaluation_run_flags(
                is_closed=False,
                is_live=evaluation.flags.is_live,
                is_active=False,
            )

            if not run_flags:
                log.info("[EVAL] [failure] invalid simple evaluation flags")
                return None

            run_data = await self._make_evaluation_run_data(
                project_id=project_id,
                user_id=user_id,
                #
                query_steps=evaluation.data.query_steps,
                testset_steps=evaluation.data.testset_steps,
                application_steps=evaluation.data.application_steps,
                evaluator_steps=evaluation.data.evaluator_steps,
                #
                repeats=evaluation.data.repeats,
            )

            if not run_data:
                log.error("[EVAL] [failure] missing or invalid simple evaluation data")
                return None

            run_create = EvaluationRunCreate(
                name=evaluation.name,
                description=evaluation.description,
                #
                flags=run_flags,
                tags=evaluation.tags,
                meta=evaluation.meta,
                #
                status=evaluation.data.status or EvaluationStatus.PENDING,
                #
                data=run_data,
            )

            run = await self.evaluations_service.create_run(
                project_id=project_id,
                user_id=user_id,
                #
                run=run_create,
            )

            if not run or not run.id:
                log.error("[EVAL] [failure] could not create evaluation run")
                return None

            log.info("[EVAL] [run]         ", id=run.id)

            log.info("[EVAL] [start]       ", id=run.id)

            _evaluation = await self.start(
                project_id=project_id,
                user_id=user_id,
                evaluation_id=run.id,
                #
                just_created=True,
            )

            if not _evaluation:
                log.error("[EVAL] [failure] could not start evaluation run")
                return None

            log.info("[EVAL] [success]     ", id=run.id)
            return _evaluation

        except Exception:  # pylint: disable=broad-except
            log.error("[EVAL] [failure]     ", exc_info=True)
            return None

    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        evaluation_id: UUID,
    ) -> Optional[SimpleEvaluation]:
        run = await self.evaluations_service.fetch_run(
            project_id=project_id,
            #
            run_id=evaluation_id,
        )

        if not run:
            return None

        evaluation = await self._parse_evaluation_run(run=run)

        return evaluation

    async def edit(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluation: SimpleEvaluationEdit,
    ) -> Optional[SimpleEvaluation]:
        evaluation.flags = evaluation.flags or SimpleEvaluationFlags(
            is_closed=False,
            is_live=False,
            is_active=True,
        )

        if not evaluation.id:
            log.info("[EVAL] [failure] missing simple evaluation id")
            return None

        if not evaluation.flags:
            log.info("")
            return None

        if not evaluation.data:
            log.info("[EVAL] [failure] missing simple evaluation data")
            return None

        # ----------------------------------------------------------------------
        log.info("[EVAL] [edit]        ", run_id=evaluation.id)
        log.info("[EVAL] [scope]       ", project_id=project_id, user_id=user_id)
        log.info("[EVAL] [flags]       ", ids=evaluation.flags.model_dump(mode="json"))
        log.info("[EVAL] [queries]     ", ids=evaluation.data.query_steps)
        log.info("[EVAL] [testsets]    ", ids=evaluation.data.testset_steps)
        log.info("[EVAL] [applications]", ids=evaluation.data.application_steps)
        log.info("[EVAL] [evaluators]  ", ids=evaluation.data.evaluator_steps)
        log.info("[EVAL] [repeats]     ", repeats=evaluation.data.repeats)
        # ----------------------------------------------------------------------

        try:
            _evaluation = await self.fetch(
                project_id=project_id,
                #
                evaluation_id=evaluation.id,
            )

            if not _evaluation or not _evaluation.id:
                log.error("[EVAL] [failure] could not find evaluation run")
                return None

            if not _evaluation.flags:
                _evaluation.flags = SimpleEvaluationFlags()

            if not _evaluation.data:
                _evaluation.data = SimpleEvaluationData()

            if _evaluation.flags.is_closed:
                log.error("[EVAL] [failure] cannot edit closed evaluation run")
                return None

            was_active = _evaluation.flags.is_active

            run_status = _evaluation.data.status

            if was_active:
                log.info("[EVAL] [stop]       ", run_id=_evaluation.id)
                _evaluation = await self.stop(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    evaluation_id=_evaluation.id,
                )

                if not _evaluation or not _evaluation.id:
                    log.error("[EVAL] [failure] could not stop evaluation run")
                    return None

                if not _evaluation.flags:
                    _evaluation.flags = SimpleEvaluationFlags()

                if not _evaluation.data:
                    _evaluation.data = SimpleEvaluationData()

            await sleep(SAFE_CLOSE_DELAY)

            run_flags = await self._make_evaluation_run_flags(
                is_closed=_evaluation.flags.is_closed,
                is_live=_evaluation.flags.is_live,
                is_active=_evaluation.flags.is_active,
            )

            run_data = await self._make_evaluation_run_data(
                project_id=project_id,
                user_id=user_id,
                #
                query_steps=evaluation.data.query_steps,
                testset_steps=evaluation.data.testset_steps,
                application_steps=evaluation.data.application_steps,
                evaluator_steps=evaluation.data.evaluator_steps,
                #
                repeats=_evaluation.data.repeats,
            )

            run_edit = EvaluationRunEdit(
                id=_evaluation.id,
                name=evaluation.name,
                description=evaluation.description,
                #
                flags=run_flags,
                tags=evaluation.tags,
                meta=evaluation.meta,
                #
                status=run_status,
                #
                data=run_data,
            )

            run = await self.evaluations_service.edit_run(
                project_id=project_id,
                user_id=user_id,
                #
                run=run_edit,
            )

            if not run:
                log.error("[EVAL] [failure] could not edit evaluation run")
                return None

            if was_active:
                log.info("[EVAL] [start]       ", run_id=_evaluation.id)

                _evaluation = await self.start(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    evaluation_id=_evaluation.id,
                )

                if not _evaluation or not _evaluation.id:
                    log.error("[EVAL] [failure] could not start evaluation run")
                    return None

            else:
                _evaluation = await self.fetch(
                    project_id=project_id,
                    #
                    evaluation_id=_evaluation.id,
                )

                if not _evaluation or not _evaluation.id:
                    log.error("[EVAL] [failure] could not find evaluation run")
                    return None

            log.info("[EVAL] [success]     ", run_id=_evaluation.id)

            return _evaluation

        except Exception:  # pylint: disable=broad-except
            log.error("[EVAL] [failure]     ", exc_info=True)
            return None

    async def delete(
        self,
        *,
        project_id: UUID,
        #
        evaluation_id: UUID,
    ) -> Optional[UUID]:
        await self.evaluations_service.delete_run(
            project_id=project_id,
            #
            run_id=evaluation_id,
        )

        return evaluation_id

    async def query(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[SimpleEvaluationQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[SimpleEvaluation]:
        run_query = await self._make_evaluation_run_query(
            is_closed=query.flags.is_closed if query and query.flags else None,
            is_live=query.flags.is_live if query and query.flags else None,
            is_active=query.flags.is_active if query and query.flags else None,
            #
            tags=query.tags if query else None,
            meta=query.meta if query else None,
        )

        runs = await self.evaluations_service.query_runs(
            project_id=project_id,
            #
            run=run_query,
            #
            windowing=windowing,
        )

        _evaluations = [
            _evaluation
            for _evaluation in [
                await self._parse_evaluation_run(run=run) for run in runs if run
            ]
            if _evaluation
        ]

        return _evaluations

    async def start(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluation_id: UUID,
        #
        just_created: Optional[bool] = None,
    ) -> Optional[SimpleEvaluation]:
        try:
            _evaluation = await self.fetch(
                project_id=project_id,
                #
                evaluation_id=evaluation_id,
            )

            if not _evaluation or not _evaluation.id:
                return None

            if not _evaluation.flags:
                _evaluation.flags = SimpleEvaluationFlags()

            if not _evaluation.data:
                _evaluation.data = SimpleEvaluationData()

            if _evaluation.flags.is_live and _evaluation.data.query_steps:
                run = await self._activate_evaluation_run(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    run_id=_evaluation.id,
                    #
                    just_created=just_created,
                )

                if not run or not run.id:
                    log.error(
                        "[EVAL] [start] [failure] could not activate evaluation run"
                    )
                    return None

                _evaluation = await self._parse_evaluation_run(run=run)

            elif (
                not _evaluation.flags.is_live
                and _evaluation.data.evaluator_steps
                and (_evaluation.data.query_steps or _evaluation.data.testset_steps)
            ):
                run = await self._activate_evaluation_run(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    run_id=_evaluation.id,
                    #
                    just_created=just_created,
                )

                if not run or not run.id:
                    log.error(
                        "[EVAL] [start] [failure] could not activate evaluation run"
                    )
                    return None

                # SDK evaluations set status="running" — the loop runs locally,
                # so do NOT dispatch the legacy worker.
                if _evaluation.data.status == "running":
                    _evaluation = await self._parse_evaluation_run(run=run)
                    return _evaluation

                if self.evaluations_worker is None:
                    log.warning(
                        "[EVAL] Taskiq client missing; cannot dispatch evaluation run",
                    )
                    return _evaluation

                if _evaluation.data.query_steps:
                    await self.evaluations_worker.evaluate_live_query.kiq(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        run_id=run.id,
                    )

                elif _evaluation.data.testset_steps:
                    await self.evaluations_worker.evaluate_batch_testset.kiq(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        run_id=run.id,
                    )

                return _evaluation

            log.info("[EVAL] [start] [success]")

            return _evaluation

        except Exception:  # pylint: disable=broad-except
            log.error("[EVAL] [start] [failure]", exc_info=True)
            return None

    async def stop(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluation_id: UUID,
    ) -> Optional[SimpleEvaluation]:
        run = await self._deactivate_evaluation_run(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=evaluation_id,
        )

        if not run or not run.id:
            log.error("[EVAL] [stop] [failure] could not stop evaluation run")
            return None

        _evaluation = await self._parse_evaluation_run(run=run)

        return _evaluation

    async def close(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluation_id: UUID,
    ) -> Optional[SimpleEvaluation]:
        run = await self.evaluations_service.close_run(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=evaluation_id,
        )

        if not run or not run.id:
            log.error("[EVAL] [close] [failure] could not close evaluation run")
            return None

        evaluation = await self._parse_evaluation_run(run=run)

        return evaluation

    async def open(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        evaluation_id: UUID,
    ) -> Optional[SimpleEvaluation]:
        run = await self.evaluations_service.open_run(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=evaluation_id,
        )

        if not run or not run.id:
            log.error("[EVAL] [open] [failure] could not open evaluation run")
            return None

        evaluation = await self._parse_evaluation_run(run=run)

        return evaluation

    async def _make_evaluation_run_data(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        query_steps: Optional[Target] = None,
        testset_steps: Optional[Target] = None,
        application_steps: Optional[Target] = None,
        evaluator_steps: Optional[Target] = None,
        #
        repeats: Optional[int] = None,
    ) -> Optional[EvaluationRunData]:
        # IMPLICIT FLAG: is_multivariate=False
        # IMPLICIT FLAG: all_inputs=True
        # IMPLICIT FLAG: full_references=True

        try:
            # fetch queries ----------------------------------------------------
            query_input_steps_keys: List[str] = list()
            query_references: Dict[str, Dict[str, Reference]] = dict()
            query_revisions: Dict[str, QueryRevision] = dict()
            query_origins: Dict[str, Origin] = dict()

            if isinstance(query_steps, list):
                query_steps = {
                    query_revision_id: DEFAULT_ORIGIN_QUERIES
                    for query_revision_id in query_steps
                }

            for query_revision_id, origin in (query_steps or {}).items():
                query_revision_ref = Reference(id=query_revision_id)

                query_revision = await self.queries_service.fetch_query_revision(
                    project_id=project_id,
                    #
                    query_revision_ref=query_revision_ref,
                )

                if not query_revision or not query_revision.slug:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find query revision",
                        id=query_revision_ref.id,
                    )
                    return None

                query_variant_ref = Reference(id=query_revision.variant_id)

                query_variant = await self.queries_service.fetch_query_variant(
                    project_id=project_id,
                    #
                    query_variant_ref=query_variant_ref,
                )

                if not query_variant:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find query variant",
                        id=query_variant_ref.id,
                    )
                    return None

                query_ref = Reference(id=query_variant.query_id)

                query = await self.queries_service.fetch_query(
                    project_id=project_id,
                    #
                    query_ref=query_ref,
                )

                if not query:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find query",
                        id=query_ref.id,
                    )
                    return None

                step_key = "query-" + query_revision.slug

                query_input_steps_keys.append(step_key)

                query_references[step_key] = dict(
                    query=Reference(
                        id=query.id,
                        slug=query.slug,
                    ),
                    query_variant=Reference(
                        id=query_variant.id,
                        slug=query_variant.slug,
                    ),
                    query_revision=Reference(
                        id=query_revision.id,
                        slug=query_revision.slug,
                        version=query_revision.version,
                    ),
                )

                query_revisions[step_key] = query_revision

                query_origins[step_key] = origin

            # ------------------------------------------------------------------

            # fetch testsets ---------------------------------------------------
            testset_input_steps_keys: List[str] = list()
            testset_references: Dict[str, Dict[str, Reference]] = dict()
            testset_revisions: Dict[str, TestsetRevision] = dict()
            testset_origins: Dict[str, Origin] = dict()
            testcases: Dict[str, List[Testcase]] = dict()

            if isinstance(testset_steps, list):
                testset_steps = {
                    testset_revision_id: DEFAULT_ORIGIN_TESTSETS
                    for testset_revision_id in testset_steps
                }

            for testset_revision_id, origin in (testset_steps or {}).items():
                testset_revision_ref = Reference(id=testset_revision_id)

                testset_revision = await self.testsets_service.fetch_testset_revision(
                    project_id=project_id,
                    #
                    testset_revision_ref=testset_revision_ref,
                )

                if not testset_revision or not testset_revision.slug:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find testset revision",
                        id=testset_revision_ref.id,
                    )
                    return None

                if not testset_revision.data or not testset_revision.data.testcases:
                    log.warn(
                        "[EVAL] [run] [make] [failure] invalid testset revision",
                        id=testset_revision_ref.id,
                    )
                    return None

                testset_variant_ref = Reference(id=testset_revision.variant_id)

                testset_variant = await self.testsets_service.fetch_testset_variant(
                    project_id=project_id,
                    #
                    testset_variant_ref=testset_variant_ref,
                )

                if not testset_variant:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find testset variant",
                        id=testset_variant_ref.id,
                    )
                    return None

                testset_ref = Reference(id=testset_variant.testset_id)

                testset = await self.testsets_service.fetch_testset(
                    project_id=project_id,
                    #
                    testset_ref=testset_ref,
                )

                if not testset:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find testset",
                        id=testset_ref.id,
                    )
                    return None

                step_key = "testset-" + testset_revision.slug

                testset_input_steps_keys.append(step_key)

                testset_references[step_key] = dict(
                    testset=Reference(
                        id=testset.id,
                        slug=testset.slug,
                    ),
                    testset_variant=Reference(
                        id=testset_variant.id,
                        slug=testset_variant.slug,
                    ),
                    testset_revision=Reference(
                        id=testset_revision.id,
                        slug=testset_revision.slug,
                        version=testset_revision.version,
                    ),
                )

                testset_revisions[step_key] = testset_revision

                testset_origins[step_key] = origin

                testcases[step_key] = testset_revision.data.testcases

                if any(not testcase.data for testcase in testcases[step_key]):
                    log.warn(
                        "[EVAL] [run] [make] [failure] invalid testset revision",
                        id=testset_revision_ref.id,
                    )
                    return None
            # ------------------------------------------------------------------

            # fetch applications -----------------------------------------------
            application_invocation_steps_keys: List[str] = list()
            application_references: Dict[str, Dict[str, Reference]] = dict()
            application_origins: Dict[str, Origin] = dict()

            if isinstance(application_steps, list):
                application_steps = {
                    application_revision_id: DEFAULT_ORIGIN_APPLICATIONS
                    for application_revision_id in application_steps
                }

            for application_revision_id, origin in (application_steps or {}).items():
                application_revision_ref = Reference(id=application_revision_id)

                application_revision = (
                    await self.applications_service.fetch_application_revision(
                        project_id=project_id,
                        application_revision_ref=application_revision_ref,
                    )
                )

                if not application_revision:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find application revision",
                        id=application_revision_ref.id,
                    )
                    return None

                application_variant_ref = Reference(
                    id=application_revision.application_variant_id
                )

                application_variant = (
                    await self.applications_service.fetch_application_variant(
                        project_id=project_id,
                        application_variant_ref=application_variant_ref,
                    )
                )

                if not application_variant:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find application variant",
                        id=application_variant_ref.id,
                    )
                    return None

                application_ref = Reference(id=application_variant.application_id)

                application = await self.applications_service.fetch_application(
                    project_id=project_id,
                    application_ref=application_ref,
                )

                if not application:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find application",
                        id=application_ref.id,
                    )
                    return None

                application_revision_slug = get_slug_from_name_and_id(
                    str(application_revision.slug),
                    application_revision.id,
                )

                step_key = "application-" + application_revision_slug

                application_invocation_steps_keys.append(step_key)

                application_references[step_key] = dict(
                    application=Reference(
                        id=application_ref.id,
                        slug=application.slug,
                    ),
                    application_variant=Reference(
                        id=application_variant_ref.id,
                        slug=application_variant.slug,
                    ),
                    application_revision=Reference(
                        id=application_revision_ref.id,
                        slug=application_revision.slug,
                        version=application_revision.version,
                    ),
                )

                application_origins[step_key] = origin

            # ------------------------------------------------------------------

            # fetch evaluators -------------------------------------------------
            evaluator_annotation_steps_keys: List[str] = list()
            evaluator_references: Dict[str, Dict[str, Reference]] = dict()
            evaluator_revisions: Dict[str, EvaluatorRevision] = dict()
            evaluator_origins: Dict[str, Origin] = dict()
            evaluator_metrics_keys: Dict[str, List[Dict[str, str]]] = dict()

            if isinstance(evaluator_steps, list):
                evaluator_steps = {
                    evaluator_revision_id: DEFAULT_ORIGIN_EVALUATORS
                    for evaluator_revision_id in evaluator_steps
                }

            for evaluator_revision_id, origin in (evaluator_steps or {}).items():
                evaluator_revision_ref = Reference(id=evaluator_revision_id)

                evaluator_revision = (
                    await self.evaluators_service.fetch_evaluator_revision(
                        project_id=project_id,
                        #
                        evaluator_revision_ref=evaluator_revision_ref,
                    )
                )

                if not evaluator_revision or not evaluator_revision.slug:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find evaluator revision",
                        id=evaluator_revision_ref.id,
                    )
                    return None

                if not evaluator_revision.data:
                    log.warn(
                        "[EVAL] [run] [make] [failure] invalid evaluator revision",
                        id=evaluator_revision_ref.id,
                    )
                    return None

                evaluator_variant_ref = Reference(id=evaluator_revision.variant_id)

                evaluator_variant = (
                    await self.evaluators_service.fetch_evaluator_variant(
                        project_id=project_id,
                        #
                        evaluator_variant_ref=evaluator_variant_ref,
                    )
                )

                if not evaluator_variant:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find evaluator variant",
                        id=evaluator_variant_ref.id,
                    )
                    return None

                evaluator_ref = Reference(id=evaluator_variant.evaluator_id)

                evaluator = await self.evaluators_service.fetch_evaluator(
                    project_id=project_id,
                    #
                    evaluator_ref=evaluator_ref,
                )

                if not evaluator:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find evaluator",
                        id=evaluator_ref.id,
                    )
                    return None

                step_key = "evaluator-" + evaluator_revision.slug

                evaluator_annotation_steps_keys.append(step_key)

                evaluator_references[step_key] = dict(
                    evaluator=Reference(
                        id=evaluator.id,
                        slug=evaluator.slug,
                    ),
                    evaluator_variant=Reference(
                        id=evaluator_variant.id,
                        slug=evaluator_variant.slug,
                    ),
                    evaluator_revision=Reference(
                        id=evaluator_revision.id,
                        slug=evaluator_revision.slug,
                        version=evaluator_revision.version,
                    ),
                )

                evaluator_revisions[step_key] = evaluator_revision

                evaluator_origins[step_key] = origin

                if evaluator_revision.data.schemas:
                    metrics_keys = get_metrics_keys_from_schema(
                        schema=evaluator_revision.data.schemas.outputs,
                    )

                    evaluator_metrics_keys[step_key] = [
                        {
                            "path": metric_key.get("path", ""),
                            "type": metric_key.get("type", ""),
                        }
                        for metric_key in metrics_keys
                    ]
                else:
                    evaluator_metrics_keys[step_key] = [
                        {
                            "path": "outputs",
                            "type": "json",
                        }
                    ]
            # ------------------------------------------------------------------

            # make run steps ---------------------------------------------------
            query_inputs_steps: List[EvaluationRunDataStep] = [
                EvaluationRunDataStep(
                    key=step_key,
                    type="input",
                    origin=query_origins[step_key],
                    # IMPLICIT FLAG: full_references=True
                    references=query_references[step_key],
                )
                for step_key in query_input_steps_keys
            ]

            testset_inputs_steps: List[EvaluationRunDataStep] = [
                EvaluationRunDataStep(
                    key=step_key,
                    type="input",
                    origin=testset_origins[step_key],
                    # IMPLICIT FLAG: full_references=True
                    references=testset_references[step_key],
                )
                for step_key in testset_input_steps_keys
            ]

            application_invocation_steps: List[EvaluationRunDataStep] = [
                EvaluationRunDataStep(
                    key=step_key,
                    type="invocation",
                    origin=application_origins[step_key],
                    references=application_references[step_key],
                    inputs=[
                        # IMPLICIT FLAG: all_inputs=True
                        EvaluationRunDataStepInput(key="__all_inputs__"),
                    ],
                )
                for step_key in application_invocation_steps_keys
            ]

            evaluator_annotation_steps: List[EvaluationRunDataStep] = [
                EvaluationRunDataStep(
                    key=step_key,
                    type="annotation",
                    origin=evaluator_origins[step_key],
                    references=evaluator_references[step_key],
                    inputs=(
                        [
                            # IMPLICIT FLAG: is_multivariate=False
                            EvaluationRunDataStepInput(key="__all_invocations__"),
                            # IMPLICIT FLAG: all_inputs=True
                            EvaluationRunDataStepInput(key="__all_inputs__"),
                        ]
                        if not query_steps
                        else [
                            # IMPLICIT FLAG: all_inputs=True
                            EvaluationRunDataStepInput(key="__all_inputs__"),
                        ]
                    ),
                )
                for step_key in evaluator_annotation_steps_keys
            ]

            steps: List[EvaluationRunDataStep] = (
                query_inputs_steps
                + testset_inputs_steps
                + application_invocation_steps
                + evaluator_annotation_steps
            )
            # ------------------------------------------------------------------

            # make run mappings ------------------------------------------------
            query_input_mappings: List[EvaluationRunDataMapping] = list(  # type: ignore
                EvaluationRunDataMapping(
                    column=EvaluationRunDataMappingColumn(
                        kind="query",
                        name="data",
                    ),
                    step=EvaluationRunDataMappingStep(
                        key=step_key,
                        path="attributes.ag.data",
                    ),
                )
                for step_key in query_input_steps_keys
            )

            testset_input_mappings: List[EvaluationRunDataMapping] = list(  # type: ignore
                EvaluationRunDataMapping(
                    column=EvaluationRunDataMappingColumn(
                        kind="testset",
                        name=key,
                    ),
                    step=EvaluationRunDataMappingStep(
                        key=step_key,
                        path=f"data.{key}",
                    ),
                )
                for step_key in testset_input_steps_keys
                for key in testcases[step_key][0].data.keys()  # type: ignore
            )

            application_invocation_mappings: List[EvaluationRunDataMapping] = list(  # type: ignore
                EvaluationRunDataMapping(
                    column=EvaluationRunDataMappingColumn(
                        kind="invocation",
                        name="outputs",
                    ),
                    step=EvaluationRunDataMappingStep(
                        key=step_key,
                        path="attributes.ag.data.outputs",
                    ),
                )
                for step_key in application_invocation_steps_keys
            )

            evaluator_annotation_mappings: List[EvaluationRunDataMapping] = list(  # type: ignore
                EvaluationRunDataMapping(
                    column=EvaluationRunDataMappingColumn(
                        kind="annotation",
                        name=metric_key.get("path", ""),
                    ),
                    step=EvaluationRunDataMappingStep(
                        key=step_key,
                        path=f"attributes.ag.data.outputs{('.' + metric_key.get('path', '')) if metric_key.get('path') else ''}",
                    ),
                )
                for step_key in evaluator_annotation_steps_keys
                for metric_key in evaluator_metrics_keys[step_key]
            )

            mappings: List[EvaluationRunDataMapping] = (
                query_input_mappings
                + testset_input_mappings
                + application_invocation_mappings
                + evaluator_annotation_mappings
            )
            # ------------------------------------------------------------------

            return EvaluationRunData(
                steps=steps,
                mappings=mappings,
                repeats=repeats or 1,
            )

        except Exception:  # pylint: disable=broad-exception-caught
            log.error("[EVAL] [run] [make] [failure]", exc_info=True)

            return None

    async def _make_evaluation_run_flags(
        self,
        *,
        is_closed: Optional[bool] = None,
        is_live: Optional[bool] = None,
        is_active: Optional[bool] = None,
    ) -> EvaluationRunFlags:
        return EvaluationRunFlags(
            is_closed=is_closed or False,
            is_live=is_live or False,
            is_active=is_active or False,
        )

    async def _make_evaluation_run_query(
        self,
        *,
        is_closed: Optional[bool] = None,
        is_live: Optional[bool] = None,
        is_active: Optional[bool] = None,
        #
        tags: Optional[Tags] = None,
        meta: Optional[Meta] = None,
    ):
        run_flags = await self._make_evaluation_run_flags(
            is_closed=is_closed,
            is_live=is_live,
            is_active=is_active,
        )

        run_query = EvaluationRunQuery(
            flags=run_flags,
            tags=tags,
            meta=meta,
        )

        return run_query

    async def _activate_evaluation_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        #
        just_created: Optional[bool] = None,
    ) -> Optional[EvaluationRun]:
        run = await self.evaluations_service.fetch_run(
            project_id=project_id,
            #
            run_id=run_id,
        )

        if not run or not run.id:
            log.error("[EVAL] [activate] [failure] could not find evaluation run")
            return None

        if not run.flags:
            run.flags = EvaluationRunFlags()

        run.flags.is_active = True

        run = await self.evaluations_service.edit_run(
            project_id=project_id,
            user_id=user_id,
            #
            run=EvaluationRunEdit(
                id=run.id,
                #
                name=run.name,
                description=run.description,
                #
                flags=run.flags,
                tags=run.tags,
                meta=run.meta,
                #
                status=EvaluationStatus.RUNNING if just_created else run.status,
                #
                data=run.data,
            ),
        )

        return run

    async def _deactivate_evaluation_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        run = await self.evaluations_service.fetch_run(
            project_id=project_id,
            #
            run_id=run_id,
        )

        if not run or not run.id:
            log.error("[EVAL] [deactivate] [failure] could not find evaluation run")
            return None

        if not run.flags:
            run.flags = EvaluationRunFlags()

        run.flags.is_active = False

        run = await self.evaluations_service.edit_run(
            project_id=project_id,
            user_id=user_id,
            #
            run=EvaluationRunEdit(
                id=run.id,
                #
                name=run.name,
                description=run.description,
                #
                flags=run.flags,
                tags=run.tags,
                meta=run.meta,
                #
                status=run.status,
                #
                data=run.data,
            ),
        )

        return run

    async def _parse_evaluation_run(
        self,
        *,
        run: EvaluationRun,
    ) -> Optional[SimpleEvaluation]:
        try:
            if not run:
                return None

            if not run.flags:
                run.flags = EvaluationRunFlags()

            if not run.data:
                run.data = EvaluationRunData()

            steps = run.data.steps if run.data.steps else []

            query_steps: Target = dict()
            testset_steps: Target = dict()
            application_steps: Target = dict()
            evaluator_steps: Target = dict()

            repeats = run.data.repeats if run.data and run.data.repeats else None

            for step in steps:
                step_type = step.type
                step_origin = step.origin
                step_references = step.references
                step_id = None

                if step_type == "input":
                    if "query_revision" in step_references:
                        step_ref = step_references["query_revision"]
                        if not isinstance(step_ref, Reference):
                            continue
                        step_id = step_ref.id
                        query_steps[step_id] = step_origin  # type: ignore
                    elif "testset_revision" in step_references:
                        step_ref = step_references["testset_revision"]
                        if not isinstance(step_ref, Reference):
                            continue
                        step_id = step_ref.id
                        testset_steps[step_id] = step_origin  # type: ignore
                elif step_type == "invocation":
                    if "application_revision" in step_references:
                        step_ref = step_references["application_revision"]
                        if not isinstance(step_ref, Reference):
                            continue
                        step_id = step_ref.id
                        application_steps[step_id] = step_origin  # type: ignore
                elif step_type == "annotation":
                    if "evaluator_revision" in step_references:
                        step_ref = step_references["evaluator_revision"]
                        if not isinstance(step_ref, Reference):
                            continue
                        step_id = step_ref.id
                        evaluator_steps[step_id] = step_origin  # type: ignore

            evaluation_flags = SimpleEvaluationFlags(**run.flags.model_dump())

            evaluation_status = SimpleEvaluationStatus(run.status)

            evaluation_data = SimpleEvaluationData(
                status=evaluation_status,
                #
                query_steps=query_steps,
                testset_steps=testset_steps,
                application_steps=application_steps,
                evaluator_steps=evaluator_steps,
                #
                repeats=repeats,
            )

            return SimpleEvaluation(
                id=run.id,
                #
                name=run.name,
                description=run.description,
                #
                created_at=run.created_at,
                updated_at=run.updated_at,
                deleted_at=run.deleted_at,
                created_by_id=run.created_by_id,
                updated_by_id=run.updated_by_id,
                deleted_by_id=run.deleted_by_id,
                #
                flags=evaluation_flags,
                tags=run.tags,
                meta=run.meta,
                #
                data=evaluation_data,
            )

        except Exception:  # pylint: disable=broad-exception-caught
            log.error("[EVAL] [run] [parse] [failure]", exc_info=True)
            return None
