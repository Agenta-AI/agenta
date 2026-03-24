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
    EvaluationRunQueryFlags,
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
    EvaluationQueueFlags,
    EvaluationQueueQueryFlags,
    EvaluationQueueCreate,
    EvaluationQueueData,
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
    #
    SimpleQueue,
    SimpleQueueCreate,
    SimpleQueueQuery,
    SimpleQueueScenariosQuery,
    SimpleQueueData,
    SimpleQueueKind,
    SimpleQueueSettings,
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
from oss.src.core.applications.service import ApplicationsService

from oss.src.core.evaluations.utils import (
    filter_scenario_ids,
    paginate_ids,
    next_windowing_from_ids,
    flatten_dedup_ids,
)

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

METRICS_STEP_TYPES = {"invocation", "annotation"}

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

    async def query_scenario_ids(
        self,
        *,
        project_id: UUID,
        #
        scenario: Optional[EvaluationScenarioQuery] = None,
    ) -> List[UUID]:
        return await self.evaluations_dao.query_scenario_ids(
            project_id=project_id,
            #
            scenario=scenario,
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

        step_types_by_key: Dict[str, str] = {
            step.key: step.type
            for step in run.data.steps
            if step.type in METRICS_STEP_TYPES
        }

        steps_metrics_keys: Dict[str, List[Dict[str, str]]] = {
            step_key: [] for step_key in step_types_by_key
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
            if step.type not in METRICS_STEP_TYPES:
                continue

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
        use_queue_scenario_ids: bool = True,
        #
    ) -> List[List[UUID]]:
        queue = await self.fetch_queue(
            project_id=project_id,
            queue_id=queue_id,
        )

        if not queue:
            return []

        queue_scenario_ids = (
            queue.data.scenario_ids if queue.data and use_queue_scenario_ids else None
        )

        run_scenario_ids = await self.query_scenario_ids(
            project_id=project_id,
            scenario=EvaluationScenarioQuery(
                run_id=queue.run_id,
                ids=queue_scenario_ids,
            ),
        )

        queue_user_ids = queue.data.user_ids if queue.data else None

        if not queue_user_ids:
            return [run_scenario_ids]

        if user_id is None:
            return [run_scenario_ids]

        is_sequential = queue.flags and queue.flags.is_sequential or False
        batch_size = queue.data.batch_size if queue.data else None
        batch_offset = queue.data.batch_offset if queue.data else None

        user_scenario_ids = filter_scenario_ids(
            user_id,
            queue_user_ids,
            run_scenario_ids,
            is_sequential,
            batch_offset=batch_offset,
            batch_size=batch_size,
        )

        return user_scenario_ids

    async def query_queue_scenarios(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID] = None,
        #
        queue_id: UUID,
        #
        scenario: Optional[EvaluationScenarioQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> Tuple[List[EvaluationScenario], Optional[Windowing]]:
        assigned_by_repeat = await self.fetch_queue_scenarios(
            project_id=project_id,
            user_id=user_id,
            #
            queue_id=queue_id,
        )

        all_ids = flatten_dedup_ids(assigned_by_repeat)

        if scenario and (scenario.status or scenario.statuses):
            # Filter IDs by status after resolving assignment — fetch IDs for status match
            status_filtered_ids = await self.query_scenario_ids(
                project_id=project_id,
                scenario=EvaluationScenarioQuery(
                    ids=all_ids,
                    status=scenario.status,
                    statuses=scenario.statuses,
                ),
            )
            status_set = set(status_filtered_ids)
            all_ids = [id_ for id_ in all_ids if id_ in status_set]

        paged_ids, has_more = paginate_ids(ids=all_ids, windowing=windowing)

        if not paged_ids:
            return [], None

        scenarios = await self.fetch_scenarios(
            project_id=project_id,
            scenario_ids=paged_ids,
        )

        next_windowing = next_windowing_from_ids(
            paged_ids=paged_ids,
            windowing=windowing,
            has_more=has_more,
        )

        return scenarios, next_windowing


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
            is_queue=False,
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
                is_queue=evaluation.flags.is_queue,
                is_cached=evaluation.flags.is_cached,
                is_split=evaluation.flags.is_split,
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
            is_queue=False,
        )

        if not evaluation.id:
            log.info("[EVAL] [failure] missing simple evaluation id")
            return None

        if not evaluation.flags:
            log.info("[EVAL] [failure] missing simple evaluation flags")
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
                is_queue=_evaluation.flags.is_queue,
                is_cached=_evaluation.flags.is_cached,
                is_split=_evaluation.flags.is_split,
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
        flags = (
            query.flags.model_dump(
                exclude_none=True,
                mode="json",
            )
            if query and query.flags
            else {}
        )

        run_query = await self._make_evaluation_run_query(
            is_closed=flags.get("is_closed"),
            is_live=flags.get("is_live"),
            is_active=flags.get("is_active"),
            is_queue=flags.get("is_queue"),
            is_cached=flags.get("is_cached"),
            is_split=flags.get("is_split"),
            #
            has_queries=flags.get("has_queries"),
            has_testsets=flags.get("has_testsets"),
            has_evaluators=flags.get("has_evaluators"),
            has_custom=flags.get("has_custom"),
            has_human=flags.get("has_human"),
            has_auto=flags.get("has_auto"),
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

            elif not _evaluation.flags.is_live:
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

                has_query_steps = bool(_evaluation.data.query_steps)
                has_testset_steps = bool(_evaluation.data.testset_steps)
                has_application_steps = bool(_evaluation.data.application_steps)
                has_evaluator_steps = bool(_evaluation.data.evaluator_steps)

                if has_query_steps and has_evaluator_steps:
                    await self.evaluations_worker.evaluate_batch_query.kiq(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        run_id=run.id,
                    )

                elif (
                    has_testset_steps and has_application_steps and has_evaluator_steps
                ):
                    await self.evaluations_worker.evaluate_batch_testset.kiq(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        run_id=run.id,
                    )

                elif (
                    has_testset_steps
                    and has_application_steps
                    and not has_evaluator_steps
                    and not has_query_steps
                ):
                    await self.evaluations_worker.evaluate_batch_invocation.kiq(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        run_id=run.id,
                    )

                else:
                    log.warning(
                        "[EVAL] [start] [skip] unsupported non-live run topology",
                        run_id=run.id,
                        has_query_steps=has_query_steps,
                        has_testset_steps=has_testset_steps,
                        has_application_steps=has_application_steps,
                        has_evaluator_steps=has_evaluator_steps,
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

    async def _ensure_human_annotation_queue(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run: EvaluationRun,
    ) -> None:
        """Create an EvaluationQueue for human annotation steps if none exists for this run.

        Queue creation is the service's responsibility — tasks must not create structural
        objects. This is called before dispatching batch evaluation tasks so that any
        human annotation steps are immediately queryable as a queue.
        """
        if not run.id or not run.data or not run.data.steps:
            return

        human_step_keys = [
            step.key
            for step in run.data.steps
            if step.type == "annotation" and step.origin == "human" and step.key
        ]

        if not human_step_keys:
            return

        existing_queues = await self.evaluations_service.query_queues(
            project_id=project_id,
            queue=EvaluationQueueQuery(run_id=run.id),
        )
        if any(q.run_id == run.id for q in existing_queues):
            return

        await self.evaluations_service.create_queue(
            project_id=project_id,
            user_id=user_id,
            queue=EvaluationQueueCreate(
                run_id=run.id,
                status=EvaluationStatus.RUNNING,
                data=EvaluationQueueData(step_keys=human_step_keys),
            ),
        )

    async def evaluate_batch_traces(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        trace_ids: List[str],
    ) -> bool:
        if not trace_ids:
            return False
        if self.evaluations_worker is None:
            log.warning(
                "[EVAL] Taskiq client missing; cannot dispatch trace batch",
                run_id=run_id,
            )
            return False

        run = await self.evaluations_service.fetch_run(
            project_id=project_id,
            run_id=run_id,
        )
        if not run or not run.flags or not run.flags.is_queue:
            log.warning(
                "[EVAL] trace batch dispatch requires a queue evaluation run",
                run_id=run_id,
            )
            return False

        await self._ensure_human_annotation_queue(
            project_id=project_id,
            user_id=user_id,
            run=run,
        )

        await self.evaluations_worker.evaluate_batch_traces.kiq(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=run_id,
            trace_ids=trace_ids,
        )
        return True

    async def evaluate_batch_testcases(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        testcase_ids: List[UUID],
    ) -> bool:
        if not testcase_ids:
            return False
        if self.evaluations_worker is None:
            log.warning(
                "[EVAL] Taskiq client missing; cannot dispatch testcase batch",
                run_id=run_id,
            )
            return False

        run = await self.evaluations_service.fetch_run(
            project_id=project_id,
            run_id=run_id,
        )
        if not run or not run.flags or not run.flags.is_queue:
            log.warning(
                "[EVAL] testcase batch dispatch requires a queue evaluation run",
                run_id=run_id,
            )
            return False

        await self._ensure_human_annotation_queue(
            project_id=project_id,
            user_id=user_id,
            run=run,
        )

        await self.evaluations_worker.evaluate_batch_testcases.kiq(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=run_id,
            testcase_ids=testcase_ids,
        )
        return True

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
                    log.warning(
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
                    log.warning(
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
                    log.warning(
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
                    log.warning(
                        "[EVAL] [run] [make] [failure] could not find testset revision",
                        id=testset_revision_ref.id,
                    )
                    return None

                if not testset_revision.data or not testset_revision.data.testcases:
                    log.warning(
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
                    log.warning(
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
                    log.warning(
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
                    log.warning(
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
                    log.warning(
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
                    log.warning(
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
                    log.warning(
                        "[EVAL] [run] [make] [failure] could not find application",
                        id=application_ref.id,
                    )
                    return None

                if not application_revision.slug:
                    log.warn(
                        "[EVAL] [run] [make] [failure] application revision is missing slug",
                        id=application_revision.id,
                    )
                    return None

                step_key = "application-" + application_revision.slug

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
                    log.warning(
                        "[EVAL] [run] [make] [failure] could not find evaluator revision",
                        id=evaluator_revision_ref.id,
                    )
                    return None

                if not evaluator_revision.data:
                    log.warning(
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
                    log.warning(
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
                    log.warning(
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
                            *(
                                [
                                    EvaluationRunDataStepInput(
                                        key="__all_invocations__"
                                    ),
                                ]
                                if application_invocation_steps_keys
                                else []
                            ),
                            *(
                                [
                                    EvaluationRunDataStepInput(key="__all_inputs__"),
                                ]
                                if (query_input_steps_keys or testset_input_steps_keys)
                                else []
                            ),
                        ]
                        or None
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
        is_queue: Optional[bool] = None,
        is_cached: Optional[bool] = None,
        is_split: Optional[bool] = None,
        has_queries: Optional[bool] = None,
        has_testsets: Optional[bool] = None,
        has_evaluators: Optional[bool] = None,
        has_custom: Optional[bool] = None,
        has_human: Optional[bool] = None,
        has_auto: Optional[bool] = None,
    ) -> EvaluationRunFlags:
        return EvaluationRunFlags(
            is_closed=is_closed or False,
            is_live=is_live or False,
            is_active=is_active or False,
            is_queue=is_queue or False,
            is_cached=is_cached or False,
            is_split=is_split or False,
            has_queries=has_queries or False,
            has_testsets=has_testsets or False,
            has_evaluators=has_evaluators or False,
            has_custom=has_custom or False,
            has_human=has_human or False,
            has_auto=has_auto or False,
        )

    async def _make_evaluation_run_query(
        self,
        *,
        is_closed: Optional[bool] = None,
        is_live: Optional[bool] = None,
        is_active: Optional[bool] = None,
        is_queue: Optional[bool] = None,
        is_cached: Optional[bool] = None,
        is_split: Optional[bool] = None,
        has_queries: Optional[bool] = None,
        has_testsets: Optional[bool] = None,
        has_evaluators: Optional[bool] = None,
        has_custom: Optional[bool] = None,
        has_human: Optional[bool] = None,
        has_auto: Optional[bool] = None,
        #
        tags: Optional[Tags] = None,
        meta: Optional[Meta] = None,
    ):
        run_flags = EvaluationRunQueryFlags(
            is_closed=is_closed,
            is_live=is_live,
            is_active=is_active,
            is_queue=is_queue,
            is_cached=is_cached,
            is_split=is_split,
            has_queries=has_queries,
            has_testsets=has_testsets,
            has_evaluators=has_evaluators,
            has_custom=has_custom,
            has_human=has_human,
            has_auto=has_auto,
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
                step_references = step.references or {}
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


class SimpleQueuesService:
    def __init__(
        self,
        *,
        evaluations_service: EvaluationsService,
        simple_evaluations_service: SimpleEvaluationsService,
        evaluators_service: EvaluatorsService,
    ):
        self.evaluations_service = evaluations_service
        self.simple_evaluations_service = simple_evaluations_service
        self.evaluators_service = evaluators_service

    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        queue: SimpleQueueCreate,
    ) -> Optional[SimpleQueue]:
        if not queue.data:
            return None

        if not queue.data.evaluators:
            return None

        kind = queue.data.kind
        queue_user_ids = self._normalize_assignments(
            assignments=queue.data.assignments,
        )
        min_repeats = len(queue_user_ids) if queue_user_ids else 1
        repeats = (
            max(queue.data.repeats, min_repeats)
            if queue.data.repeats is not None
            else min_repeats
        )

        run_data_and_keys = await self._make_run_data(
            project_id=project_id,
            #
            kind=kind,
            #
            evaluator_steps=queue.data.evaluators,
            repeats=repeats,
        )

        if not run_data_and_keys:
            return None

        run_data, annotation_step_keys = run_data_and_keys

        run = await self.evaluations_service.create_run(
            project_id=project_id,
            user_id=user_id,
            #
            run=EvaluationRunCreate(
                name=queue.name,
                description=queue.description,
                #
                flags=EvaluationRunFlags(
                    is_live=False,
                    is_active=True,
                    is_closed=False,
                    is_queue=True,
                ),
                tags=queue.tags,
                meta=queue.meta,
                #
                status=queue.status or EvaluationStatus.RUNNING,
                #
                data=run_data,
            ),
        )

        if not run or not run.id:
            return None

        settings: Optional[SimpleQueueSettings] = (
            queue.data.settings if queue.data else None
        )
        is_sequential = bool(
            settings
            and (settings.batch_size is not None or settings.batch_offset is not None)
        )

        created_queue = await self.evaluations_service.create_queue(
            project_id=project_id,
            user_id=user_id,
            #
            queue=EvaluationQueueCreate(
                name=queue.name,
                description=queue.description,
                #
                flags=EvaluationQueueFlags(
                    is_sequential=is_sequential,
                ),
                tags=queue.tags,
                meta=queue.meta,
                #
                status=queue.status or EvaluationStatus.RUNNING,
                #
                data=EvaluationQueueData(
                    user_ids=queue_user_ids,
                    step_keys=annotation_step_keys,
                    batch_size=settings.batch_size if settings else None,
                    batch_offset=settings.batch_offset if settings else None,
                ),
                # is_queue
                run_id=run.id,
            ),
        )

        if not created_queue:
            await self.evaluations_service.delete_run(
                project_id=project_id,
                run_id=run.id,
            )
            return None

        return self._parse_queue(
            queue=created_queue,
            run=run,
        )

    async def fetch(
        self,
        *,
        project_id: UUID,
        queue_id: UUID,
    ) -> Optional[SimpleQueue]:
        queue = await self.evaluations_service.fetch_queue(
            project_id=project_id,
            queue_id=queue_id,
        )
        if not queue:
            return None

        run = await self.evaluations_service.fetch_run(
            project_id=project_id,
            run_id=queue.run_id,
        )
        if not run:
            return None

        return self._parse_queue(
            queue=queue,
            run=run,
        )

    async def query(
        self,
        *,
        project_id: UUID,
        query: Optional[SimpleQueueQuery] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[SimpleQueue]:
        run_ids_filter: Optional[List[UUID]] = None
        if query and (query.run_id is not None or query.run_ids is not None):
            requested_run_ids: List[UUID] = []

            if query.run_id is not None:
                requested_run_ids.append(query.run_id)

            if query.run_ids:
                requested_run_ids.extend(query.run_ids)

            run_ids_filter = list(dict.fromkeys(requested_run_ids))

        if query and query.kind is not None:
            run_query = EvaluationRunQuery(
                flags=EvaluationRunQueryFlags(
                    is_queue=True,
                    has_queries=query.kind == SimpleQueueKind.TRACES,
                    has_testsets=query.kind == SimpleQueueKind.TESTCASES,
                ),
            )
            runs = await self.evaluations_service.query_runs(
                project_id=project_id,
                run=run_query,
            )

            kind_run_ids = [run.id for run in runs if run and run.id]
            if not kind_run_ids:
                return []

            kind_run_ids_set = set(kind_run_ids)
            if run_ids_filter is None:
                run_ids_filter = kind_run_ids
            else:
                run_ids_filter = [
                    run_id for run_id in run_ids_filter if run_id in kind_run_ids_set
                ]
                if not run_ids_filter:
                    return []

        queues = await self.evaluations_service.query_queues(
            project_id=project_id,
            queue=EvaluationQueueQuery(
                name=query.name if query else None,
                description=query.description if query else None,
                #
                flags=EvaluationQueueQueryFlags(),
                tags=query.tags if query else None,
                meta=query.meta if query else None,
                #
                user_id=query.user_id if query else None,
                user_ids=query.user_ids if query else None,
                #
                run_id=None,
                run_ids=run_ids_filter,
                #
                ids=query.queue_ids if query else None,
            ),
            windowing=windowing,
        )

        if not queues:
            return []

        queue_run_ids = list(dict.fromkeys([queue.run_id for queue in queues if queue]))
        runs = await self.evaluations_service.fetch_runs(
            project_id=project_id,
            run_ids=queue_run_ids,
        )
        runs_by_id = {run.id: run for run in runs if run and run.id}

        return [
            parsed
            for parsed in [
                self._parse_queue(
                    queue=queue,
                    run=runs_by_id.get(queue.run_id),
                )
                for queue in queues
            ]
            if parsed
        ]

    async def add_traces(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        queue_id: UUID,
        #
        trace_ids: List[str],
    ) -> Optional[UUID]:
        queue = await self.evaluations_service.fetch_queue(
            project_id=project_id,
            queue_id=queue_id,
        )
        if not queue:
            return None

        run = await self.evaluations_service.fetch_run(
            project_id=project_id,
            run_id=queue.run_id,
        )
        if not run:
            return None

        if self._get_kind(run) != SimpleQueueKind.TRACES:
            return None

        ok = await self.simple_evaluations_service.evaluate_batch_traces(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=queue.run_id,
            #
            trace_ids=trace_ids,
        )
        if not ok:
            return None

        return queue.id

    async def add_testcases(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        queue_id: UUID,
        #
        testcase_ids: List[UUID],
    ) -> Optional[UUID]:
        queue = await self.evaluations_service.fetch_queue(
            project_id=project_id,
            queue_id=queue_id,
        )
        if not queue:
            return None

        run = await self.evaluations_service.fetch_run(
            project_id=project_id,
            run_id=queue.run_id,
        )
        if not run:
            return None

        if self._get_kind(run) != SimpleQueueKind.TESTCASES:
            return None

        ok = await self.simple_evaluations_service.evaluate_batch_testcases(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=queue.run_id,
            #
            testcase_ids=testcase_ids,
        )
        if not ok:
            return None

        return queue.id

    async def query_scenarios(
        self,
        *,
        project_id: UUID,
        #
        queue: Optional[SimpleQueueScenariosQuery] = None,
        #
        scenario: Optional[EvaluationScenarioQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> Tuple[List[EvaluationScenario], Optional[Windowing]]:
        if not queue or not queue.id:
            return [], None

        evaluation_queue = await self.evaluations_service.fetch_queue(
            project_id=project_id,
            queue_id=queue.id,
        )
        if not evaluation_queue:
            return [], None

        query_user_ids: List[UUID] = []
        if queue and queue.user_id:
            query_user_ids.append(queue.user_id)
        if queue and queue.user_ids:
            query_user_ids.extend(queue.user_ids)

        query_user_ids = list(dict.fromkeys(query_user_ids))

        assigned_scenario_ids_by_repeat: List[List[UUID]] = []
        if query_user_ids:
            for query_user_id in query_user_ids:
                user_assigned_scenario_ids_by_repeat = (
                    await self.evaluations_service.fetch_queue_scenarios(
                        project_id=project_id,
                        user_id=query_user_id,
                        #
                        queue_id=queue.id,
                        #
                        use_queue_scenario_ids=False,
                    )
                )

                for idx, repeat_ids in enumerate(user_assigned_scenario_ids_by_repeat):
                    while len(assigned_scenario_ids_by_repeat) <= idx:
                        assigned_scenario_ids_by_repeat.append([])

                    current_repeat_ids = assigned_scenario_ids_by_repeat[idx]
                    current_repeat_ids_set = set(current_repeat_ids)
                    for scenario_id in repeat_ids:
                        if scenario_id in current_repeat_ids_set:
                            continue
                        current_repeat_ids.append(scenario_id)
                        current_repeat_ids_set.add(scenario_id)
        else:
            assigned_scenario_ids_by_repeat = (
                await self.evaluations_service.fetch_queue_scenarios(
                    project_id=project_id,
                    user_id=None,
                    #
                    queue_id=queue.id,
                    #
                    use_queue_scenario_ids=False,
                )
            )

        all_ids = flatten_dedup_ids(assigned_scenario_ids_by_repeat)

        if not all_ids:
            return [], None

        # Apply status filtering after assignment (preserves assignment order)
        if scenario and (scenario.status or scenario.statuses):
            status_filtered_ids = await self.evaluations_service.query_scenario_ids(
                project_id=project_id,
                scenario=EvaluationScenarioQuery(
                    ids=all_ids,
                    status=scenario.status,
                    statuses=scenario.statuses,
                ),
            )
            status_set = set(status_filtered_ids)
            all_ids = [id_ for id_ in all_ids if id_ in status_set]

        if not all_ids:
            return [], None

        paged_ids, has_more = paginate_ids(ids=all_ids, windowing=windowing)

        if not paged_ids:
            return [], None

        scenarios = await self.evaluations_service.fetch_scenarios(
            project_id=project_id,
            scenario_ids=paged_ids,
        )

        next_windowing = next_windowing_from_ids(
            paged_ids=paged_ids,
            windowing=windowing,
            has_more=has_more,
        )

        return scenarios, next_windowing

    async def _make_run_data(
        self,
        *,
        project_id: UUID,
        kind: SimpleQueueKind,
        evaluator_steps: Target,
        repeats: int,
    ) -> Optional[Tuple[EvaluationRunData, List[str]]]:
        evaluator_step_origins: Dict[UUID, Origin]
        if isinstance(evaluator_steps, list):
            evaluator_step_origins = {
                evaluator_revision_id: "human"
                for evaluator_revision_id in evaluator_steps
            }
        else:
            evaluator_step_origins = evaluator_steps

        annotation_steps: List[EvaluationRunDataStep] = []
        annotation_mappings: List[EvaluationRunDataMapping] = []
        annotation_step_keys: List[str] = []

        source_step_key = (
            "query-direct" if kind == SimpleQueueKind.TRACES else "testset-direct"
        )
        source_step = EvaluationRunDataStep(
            key=source_step_key,
            type="input",
            origin="custom",
            references={},
        )

        source_mappings: List[EvaluationRunDataMapping] = []

        for evaluator_revision_id, origin in evaluator_step_origins.items():
            evaluator_revision_ref = Reference(id=evaluator_revision_id)
            evaluator_revision = await self.evaluators_service.fetch_evaluator_revision(
                project_id=project_id,
                evaluator_revision_ref=evaluator_revision_ref,
            )
            if not evaluator_revision or not evaluator_revision.slug:
                return None

            evaluator_variant = await self.evaluators_service.fetch_evaluator_variant(
                project_id=project_id,
                evaluator_variant_ref=Reference(id=evaluator_revision.variant_id),
            )
            if not evaluator_variant:
                return None

            evaluator = await self.evaluators_service.fetch_evaluator(
                project_id=project_id,
                evaluator_ref=Reference(id=evaluator_variant.evaluator_id),
            )
            if not evaluator:
                return None

            step_key = "evaluator-" + evaluator_revision.slug
            annotation_step_keys.append(step_key)

            step_inputs: List[EvaluationRunDataStepInput] = [
                EvaluationRunDataStepInput(key="__all_inputs__")
            ]

            annotation_steps.append(
                EvaluationRunDataStep(
                    key=step_key,
                    type="annotation",
                    origin=origin,
                    references={
                        "evaluator": Reference(
                            id=evaluator.id,
                            slug=evaluator.slug,
                        ),
                        "evaluator_variant": Reference(
                            id=evaluator_variant.id,
                            slug=evaluator_variant.slug,
                        ),
                        "evaluator_revision": Reference(
                            id=evaluator_revision.id,
                            slug=evaluator_revision.slug,
                            version=evaluator_revision.version,
                        ),
                    },
                    inputs=step_inputs,
                )
            )

            metrics_keys: List[Dict[str, str]]
            if evaluator_revision.data and evaluator_revision.data.schemas:
                metrics_keys = get_metrics_keys_from_schema(
                    schema=evaluator_revision.data.schemas.outputs,
                )
                metrics_keys = [
                    {
                        "path": metric_key.get("path", ""),
                        "type": metric_key.get("type", ""),
                    }
                    for metric_key in metrics_keys
                ]
            else:
                metrics_keys = [
                    {
                        "path": "outputs",
                        "type": "json",
                    }
                ]

            annotation_mappings.extend(
                [
                    EvaluationRunDataMapping(
                        column=EvaluationRunDataMappingColumn(
                            kind="annotation",
                            name=metric_key.get("path", ""),
                        ),
                        step=EvaluationRunDataMappingStep(
                            key=step_key,
                            path=(
                                "attributes.ag.data.outputs"
                                + (
                                    "." + metric_key.get("path", "")
                                    if metric_key.get("path")
                                    else ""
                                )
                            ),
                        ),
                    )
                    for metric_key in metrics_keys
                ]
            )

        run_data = EvaluationRunData(
            steps=[source_step] + annotation_steps,
            mappings=source_mappings + annotation_mappings,
            repeats=repeats,
        )

        return run_data, annotation_step_keys

    def _get_kind(self, run: EvaluationRun) -> Optional[SimpleQueueKind]:
        if not run.flags or not run.flags.is_queue:
            return None

        if run.flags.has_queries and not run.flags.has_testsets:
            return SimpleQueueKind.TRACES

        if run.flags.has_testsets and not run.flags.has_queries:
            return SimpleQueueKind.TESTCASES

        return None

    def _parse_queue(
        self,
        *,
        queue: EvaluationQueue,
        #
        run: Optional[EvaluationRun],
    ) -> Optional[SimpleQueue]:
        if run is None:
            return None

        kind = self._get_kind(run)
        if kind is None:
            return None

        assignments: Optional[List[List[UUID]]] = None
        repeats: Optional[int] = None
        if queue.data and queue.data.user_ids:
            assignments = [
                [UUID(str(user_id)) for user_id in repeat_user_ids]
                for repeat_user_ids in queue.data.user_ids
            ]

        run_repeats = (
            run.data.repeats if run and run.data and run.data.repeats else None
        )
        assignment_lanes = len(assignments) if assignments else 0
        if run_repeats and assignment_lanes:
            repeats = max(run_repeats, assignment_lanes)
        elif run_repeats and run_repeats > 1:
            repeats = run_repeats
        elif assignment_lanes > 1:
            repeats = assignment_lanes

        return SimpleQueue(
            id=queue.id,
            #
            name=queue.name,
            description=queue.description,
            #
            created_at=queue.created_at,
            updated_at=queue.updated_at,
            deleted_at=queue.deleted_at,
            created_by_id=queue.created_by_id,
            updated_by_id=queue.updated_by_id,
            deleted_by_id=queue.deleted_by_id,
            #
            flags=queue.flags.model_dump(
                mode="json",
                exclude_none=True,
            )
            if queue.flags
            else None,
            tags=queue.tags,
            meta=queue.meta,
            #
            status=queue.status,
            #
            data=SimpleQueueData(
                kind=kind,
                assignments=assignments,
                repeats=repeats,
                settings=SimpleQueueSettings(
                    batch_size=queue.data.batch_size if queue.data else None,
                    batch_offset=queue.data.batch_offset if queue.data else None,
                )
                if queue.data
                and (
                    queue.data.batch_size is not None
                    or queue.data.batch_offset is not None
                )
                else None,
            ),
            #
            run_id=queue.run_id,
        )

    def _normalize_assignments(
        self,
        *,
        assignments: Optional[List[List[UUID]]],
    ) -> Optional[List[List[UUID]]]:
        if assignments is None:
            return None

        if len(assignments) == 0:
            return None

        return [
            [UUID(str(user_id)) for user_id in repeat_user_ids]
            for repeat_user_ids in assignments
        ]
