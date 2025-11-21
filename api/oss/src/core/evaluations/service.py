from typing import List, Optional, Tuple, Dict, Any
from uuid import UUID
from asyncio import sleep
from copy import deepcopy
from datetime import datetime, timedelta

from celery import current_app as celery_dispatch

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
    # EVALUATION QUEUE
    EvaluationQueue,
    EvaluationQueueCreate,
    EvaluationQueueEdit,
    EvaluationQueueQuery,
)
from oss.src.core.evaluations.utils import determine_evaluation_kind
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
from oss.src.core.testsets.service import SimpleTestsetsService
from oss.src.core.evaluators.service import SimpleEvaluatorsService

from oss.src.core.evaluations.utils import filter_scenario_ids

from oss.src.models.db_models import AppVariantRevisionsDB

from oss.src.services.db_manager import (
    fetch_app_by_id,
    fetch_app_variant_by_id,
    fetch_app_variant_revision_by_id,
)
from oss.src.utils.helpers import get_slug_from_name_and_id
from oss.src.core.evaluations.utils import get_metrics_keys_from_schema


log = get_module_logger(__name__)


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
    ):
        self.evaluations_dao = evaluations_dao

        self.tracing_service = tracing_service
        self.queries_service = queries_service
        self.testsets_service = testsets_service
        self.evaluators_service = evaluators_service

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

                celery_dispatch.send_task(  # type: ignore
                    "src.tasks.evaluations.live.evaluate",
                    kwargs=dict(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        run_id=run.id,
                        #
                        newest=newest,
                        oldest=oldest,
                    ),
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
        required_kinds: Optional[set[str]] = None
        if run is not None:
            kinds: set[str] = set()
            if getattr(run, "evaluation_kind", None):
                kinds.add(str(run.evaluation_kind).lower())
            if getattr(run, "evaluation_kinds", None):
                kinds.update(str(kind).lower() for kind in run.evaluation_kinds or [])
            required_kinds = kinds if kinds else None

        limit = windowing.limit if windowing else None
        limit_is_positive = bool(limit and limit > 0)

        if required_kinds and windowing and limit_is_positive:
            _runs, _ = await self._query_runs_with_kind_windowing(
                project_id=project_id,
                run=run,
                windowing=windowing,
                required_kinds=required_kinds,
            )

            return _runs

        runs = await self.evaluations_dao.query_runs(
            project_id=project_id,
            #
            run=run,
            #
            windowing=windowing,
        )

        filtered_runs: List[EvaluationRun] = []
        for dto in runs:
            if self._include_run(dto=dto, required_kinds=required_kinds):
                filtered_runs.append(dto)

        return filtered_runs

    def _include_run(
        self,
        *,
        dto: EvaluationRun,
        required_kinds: Optional[set[str]],
    ) -> bool:
        kind = determine_evaluation_kind(dto)
        if required_kinds and kind not in required_kinds:
            return False

        try:
            if isinstance(dto.meta, dict):
                meta = dto.meta
            elif dto.meta is None:
                meta = {}
            elif hasattr(dto.meta, "model_dump"):
                meta = dto.meta.model_dump()  # type: ignore[attr-defined]
            elif hasattr(dto.meta, "dict"):
                meta = dto.meta.dict()  # type: ignore[attr-defined]
            else:
                meta = dict(dto.meta)  # type: ignore[arg-type]
        except Exception:  # pragma: no cover - defensive fallback
            meta = {}

        if isinstance(meta, dict) and meta.get("evaluation_kind") != kind:
            meta = {**meta, "evaluation_kind": kind}
            try:
                dto.meta = meta  # type: ignore[assignment]
            except Exception:  # pragma: no cover - best effort
                pass

        return True

    async def _query_runs_with_kind_windowing(
        self,
        *,
        project_id: UUID,
        run: Optional[EvaluationRunQuery],
        windowing: Windowing,
        required_kinds: set[str],
    ) -> List[EvaluationRun]:
        collected: List[EvaluationRun] = []

        current_window = windowing

        last_cursor: Optional[UUID] = windowing.next
        has_more = False
        limit_value = windowing.limit or 0

        while True:
            batch = await self.evaluations_dao.query_runs(
                project_id=project_id,
                run=run,
                windowing=current_window,
            )

            if not batch:
                last_cursor = None
                has_more = False
                break

            for dto in batch:
                if self._include_run(dto=dto, required_kinds=required_kinds):
                    collected.append(dto)
                    if limit_value and len(collected) >= limit_value:
                        break

            last_cursor = getattr(batch[-1], "id", None)

            fetch_limit = current_window.limit or len(batch)
            limit_reached = bool(fetch_limit and len(batch) >= fetch_limit)

            if not limit_value or len(collected) >= limit_value:
                has_more = bool(limit_reached and last_cursor)
                break

            if not limit_reached or not last_cursor:
                has_more = False
                break

            current_window.next = last_cursor

        trimmed = collected if not limit_value else collected[:limit_value]

        return trimmed

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
        metrics = await self.evaluations_dao.query_metrics(
            project_id=project_id,
            #
            metric=metric,
            #
            windowing=windowing,
        )

        if metric:
            scenario_null = getattr(metric, "scenario_null", None)

            run_filters = set()
            if getattr(metric, "run_id", None):
                run_filters.add(metric.run_id)
            if getattr(metric, "run_ids", None):
                run_filters.update(metric.run_ids)

            scenario_filters = set()
            include_null_scenarios = bool(scenario_null)
            if scenario_null:
                metrics = [
                    m for m in metrics if getattr(m, "scenario_id", None) is None
                ]

            if not scenario_null:
                fields_set = getattr(metric, "__fields_set__", None)
                if fields_set is None:
                    fields_set = getattr(metric, "model_fields_set", set())

                if fields_set and "scenario_id" in fields_set:
                    if metric.scenario_id is None:
                        include_null_scenarios = True
                    else:
                        scenario_filters.add(metric.scenario_id)

                scenario_ids = getattr(metric, "scenario_ids", None)
                if scenario_ids is not None:
                    for sid in scenario_ids:
                        if sid is None:
                            include_null_scenarios = True
                        else:
                            scenario_filters.add(sid)

            if run_filters:
                metrics = [m for m in metrics if m.run_id in run_filters]

            if scenario_filters or include_null_scenarios:
                metrics = [
                    m
                    for m in metrics
                    if (
                        (scenario_filters and m.scenario_id in scenario_filters)
                        or (
                            include_null_scenarios
                            and getattr(m, "scenario_id", None) is None
                        )
                    )
                ]

            log.info(
                "[EvaluationsService] query_metrics filters applied",
                run_filters=[str(r) for r in run_filters],
                scenario_filters=[
                    "null" if s is None else str(s) for s in scenario_filters
                ],
                scenario_null=scenario_null,
                include_null_scenarios=include_null_scenarios,
                returned=len(metrics),
            )

        return metrics

    @staticmethod
    def _normalize_metric_path(raw_path: Optional[str]) -> Optional[str]:
        if not raw_path or not isinstance(raw_path, str):
            return None
        path = raw_path.lstrip(".")
        prefixes = (
            "attributes.ag.data.outputs.",
            "ag.data.outputs.",
            "data.outputs.",
            "outputs.",
        )
        for prefix in prefixes:
            if path.startswith(prefix):
                path = path[len(prefix) :]
                break
        return path or None

    @staticmethod
    def _to_dict(value: Any) -> Dict[str, Any]:
        if value is None:
            return {}
        if hasattr(value, "model_dump"):
            return value.model_dump()
        if isinstance(value, dict):
            return value
        return {}

    async def _build_step_metric_specs(
        self,
        *,
        project_id: UUID,
        run: EvaluationRun,
    ) -> Dict[str, List[Dict[str, str]]]:
        steps_metrics_keys: Dict[str, List[Dict[str, str]]] = {}

        run_data = getattr(run, "data", None)
        if not run_data or not getattr(run_data, "steps", None):
            return steps_metrics_keys

        mappings_by_step: Dict[str, List[str]] = {}
        for mapping in run_data.mappings or []:
            if not mapping:
                continue
            step = getattr(mapping, "step", None) or {}
            column = getattr(mapping, "column", None) or {}
            step_key = (
                getattr(step, "key", None)
                if not isinstance(step, dict)
                else step.get("key")
            )
            raw_path = (
                getattr(step, "path", None)
                if not isinstance(step, dict)
                else step.get("path")
            )
            kind_value = (
                getattr(column, "kind", None)
                if not isinstance(column, dict)
                else column.get("kind")
            )
            kind = (kind_value or "").lower()
            if not step_key or not raw_path or kind not in {"annotation", "evaluator"}:
                continue
            normalized = self._normalize_metric_path(raw_path)
            if normalized:
                mappings_by_step.setdefault(step_key, []).append(normalized)

        for step in run_data.steps:
            step_key = getattr(step, "key", None)
            if not step_key:
                continue

            steps_metrics_keys[step_key] = [dict(metric) for metric in DEFAULT_METRICS]

            if getattr(step, "type", None) != "annotation":
                continue

            references = getattr(step, "references", {}) or {}
            evaluator_revision_ref = references.get("evaluator_revision")

            if not evaluator_revision_ref:
                log.warning("[WARN] Evaluator revision reference not found")
                continue

            evaluator_revision = await self.evaluators_service.fetch_evaluator_revision(
                project_id=project_id,
                evaluator_revision_ref=evaluator_revision_ref,
            )

            if not evaluator_revision:
                log.warning("[WARN] Evaluator revision not found")
                continue

            metrics_keys: List[Dict[str, str]] = []
            evaluator_data = self._to_dict(getattr(evaluator_revision, "data", None))

            if evaluator_data:
                schemas = self._to_dict(evaluator_data.get("schemas")).get("outputs")
                if schemas:
                    metrics_keys.extend(
                        get_metrics_keys_from_schema(schema=schemas),
                    )

                service_format = self._to_dict(evaluator_data.get("service")).get(
                    "format"
                )
                if service_format:
                    metrics_keys.extend(
                        get_metrics_keys_from_schema(schema=service_format),
                    )

            if not metrics_keys and step_key in mappings_by_step:
                for mapped_path in mappings_by_step[step_key]:
                    metrics_keys.append({"path": mapped_path, "type": "string"})

            sanitized_metrics = []
            for metric_key in metrics_keys:
                normalized = self._normalize_metric_path(
                    metric_key.get("path")
                    if isinstance(metric_key, dict)
                    else getattr(metric_key, "path", None)
                )
                if not normalized:
                    continue
                metric_type = (
                    metric_key.get("type")
                    if isinstance(metric_key, dict)
                    else getattr(metric_key, "type", None)
                ) or "string"
                sanitized_metrics.append(
                    {
                        "path": f"attributes.ag.data.outputs.{normalized}",
                        "type": metric_type,
                    }
                )

            if sanitized_metrics:
                steps_metrics_keys[step_key] += sanitized_metrics

        return steps_metrics_keys

    async def _collect_metrics_snapshot(
        self,
        *,
        project_id: UUID,
        run_id: UUID,
        scenario_id: Optional[UUID],
        timestamp: Optional[datetime],
        interval: Optional[int],
        step_metric_specs: Dict[str, List[Dict[str, str]]],
    ) -> Dict[str, Any]:
        metrics_data: Dict[str, Any] = {}
        steps_trace_ids: Dict[str, List[str]] = {}

        if not step_metric_specs:
            return metrics_data

        for step_key in step_metric_specs.keys():
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
                continue

            trace_ids = [result.trace_id for result in results if result.trace_id]
            if trace_ids:
                steps_trace_ids[step_key] = trace_ids

        for step_key, step_trace_ids in steps_trace_ids.items():
            try:
                query = TracingQuery(
                    filtering=Filtering(
                        conditions=[
                            Condition(
                                field="trace_id",
                                operator=ListOperator.IN,
                                value=step_trace_ids,
                            )
                        ]
                    )
                )

                specs = [
                    MetricSpec(
                        type=MetricType(metric.get("type")),
                        path=metric.get("path") or "*",
                    )
                    for metric in step_metric_specs.get(step_key, [])
                ] + [
                    MetricSpec(
                        type=MetricType.JSON,
                        path="atttributes.ag",
                    )
                ]

                buckets = await self.tracing_service.analytics(
                    project_id=project_id,
                    query=query,
                    specs=specs,
                )

                if len(buckets) != 1:
                    log.warning("[WARN] There should be one and only one bucket")
                    log.warning("[WARN] Buckets:", buckets)
                    continue

                bucket = buckets[0]

                if not bucket.metrics:
                    log.warning("[WARN] Bucket metrics should not be empty")
                    log.warning("[WARN] Bucket:", bucket)
                    continue

                metrics_data[step_key] = bucket.metrics

            except Exception as e:  # pylint: disable=broad-except
                log.error(e, exc_info=True)

        return metrics_data

    async def _upsert_metric_record(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run_id: UUID,
        scenario_id: Optional[UUID],
        timestamp: Optional[datetime],
        interval: Optional[int],
        data: Dict[str, Any],
    ) -> List[EvaluationMetrics]:
        if not data:
            return []

        filter_kwargs: Dict[str, Any] = {"run_id": run_id}
        if scenario_id is None:
            filter_kwargs["scenario_ids"] = False
        else:
            filter_kwargs["scenario_id"] = scenario_id

        if timestamp is None:
            filter_kwargs["timestamps"] = False
        else:
            filter_kwargs["timestamp"] = timestamp

        existing = await self.query_metrics(
            project_id=project_id,
            metric=EvaluationMetricsQuery(**filter_kwargs),
        )

        if existing:
            edits = [
                EvaluationMetricsEdit(
                    id=existing[0].id,
                    data=data,
                    status=EvaluationStatus.SUCCESS,
                )
            ]
            return await self.edit_metrics(
                project_id=project_id,
                user_id=user_id,
                metrics=edits,
            )

        creates = [
            EvaluationMetricsCreate(
                run_id=run_id,
                scenario_id=scenario_id,
                timestamp=timestamp,
                interval=interval,
                status=EvaluationStatus.SUCCESS,
                data=data,
            )
        ]
        return await self.create_metrics(
            project_id=project_id,
            user_id=user_id,
            metrics=creates,
        )

    async def refresh_metrics(
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
        run = await self.fetch_run(
            project_id=project_id,
            #
            run_id=run_id,
        )

        if not run or not run.data or not run.data.steps:
            log.warning("[WARN] run or run.data or run.data.steps not found")
            return []

        step_metric_specs = await self._build_step_metric_specs(
            project_id=project_id,
            run=run,
        )

        if not step_metric_specs:
            log.warning("[WARN] No steps metrics keys found")
            return []

        metrics_data = await self._collect_metrics_snapshot(
            project_id=project_id,
            run_id=run_id,
            scenario_id=scenario_id,
            timestamp=timestamp,
            interval=interval,
            step_metric_specs=step_metric_specs,
        )

        if not metrics_data:
            return []

        metrics: List[EvaluationMetrics] = []
        metrics.extend(
            await self._upsert_metric_record(
                project_id=project_id,
                user_id=user_id,
                run_id=run_id,
                scenario_id=scenario_id,
                timestamp=timestamp,
                interval=interval,
                data=metrics_data,
            )
        )

        if timestamp is not None:
            aggregate_data = await self._collect_metrics_snapshot(
                project_id=project_id,
                run_id=run_id,
                scenario_id=scenario_id,
                timestamp=None,
                interval=None,
                step_metric_specs=step_metric_specs,
            )

            if aggregate_data:
                metrics.extend(
                    await self._upsert_metric_record(
                        project_id=project_id,
                        user_id=user_id,
                        run_id=run_id,
                        scenario_id=scenario_id,
                        timestamp=None,
                        interval=None,
                        data=aggregate_data,
                    )
                )

        return metrics

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
        queries_service: QueriesService,
        testsets_service: TestsetsService,
        evaluators_service: EvaluatorsService,
        evaluations_service: EvaluationsService,
        simple_testsets_service: SimpleTestsetsService,
        simple_evaluators_service: SimpleEvaluatorsService,
    ):
        self.queries_service = queries_service
        self.testsets_service = testsets_service
        self.evaluators_service = evaluators_service
        self.evaluations_service = evaluations_service
        self.simple_testsets_service = simple_testsets_service
        self.simple_evaluators_service = simple_evaluators_service

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

            evaluation_jit = evaluation.jit or {"testsets": True, "evaluators": True}

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
                #
                jit=evaluation_jit,
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

        except:  # pylint: disable=bare-except
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

        except:  # pylint: disable=bare-except
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

        runs, _ = await self.evaluations_service.query_runs(
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

                if _evaluation.data.query_steps:
                    celery_dispatch.send_task(  # type: ignore
                        "src.tasks.evaluations.batch.evaluate_queries",
                        kwargs=dict(
                            project_id=project_id,
                            user_id=user_id,
                            #
                            run_id=run.id,
                        ),
                    )

                elif _evaluation.data.testset_steps:
                    celery_dispatch.send_task(  # type: ignore
                        "src.tasks.evaluations.batch.evaluate_testsets",
                        kwargs=dict(
                            project_id=project_id,
                            user_id=user_id,
                            #
                            run_id=run.id,
                        ),
                    )

                return _evaluation

            log.info("[EVAL] [start] [success]")

            return _evaluation

        except:  # pylint: disable=bare-except
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
        #
        jit: Optional[Dict[str, bool]] = None,
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

            # JIT MIGRATION ================================================== #
            if jit and jit.get("testsets"):
                _testset_steps = deepcopy(testset_steps or {})
                testset_steps = dict()

                for testset_id, origin in _testset_steps.items():
                    testset_ref = Reference(id=testset_id)

                    simple_testset = await self.simple_testsets_service.transfer(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        testset_id=testset_id,
                    )

                    if (
                        not simple_testset
                        or not simple_testset.id
                        or not simple_testset.slug
                    ):
                        log.warn(
                            "[EVAL] [run] [make] [failure] could not transfer simple testset",
                            id=testset_ref.id,
                        )
                        return None

                    testset_revision = (
                        await self.testsets_service.fetch_testset_revision(
                            project_id=project_id,
                            #
                            testset_ref=testset_ref,
                        )
                    )

                    if (
                        not testset_revision
                        or not testset_revision.id
                        or not testset_revision.slug
                    ):
                        log.warn(
                            "[EVAL] [run] [make] [failure] could not find testset revision",
                            id=testset_ref.id,
                        )
                        return None

                    testset_steps[testset_revision.id] = origin
            # ================================================================ #

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
            application_revisions: Dict[str, AppVariantRevisionsDB] = dict()
            application_origins: Dict[str, Origin] = dict()

            if isinstance(application_steps, list):
                application_steps = {
                    application_revision_id: DEFAULT_ORIGIN_APPLICATIONS
                    for application_revision_id in application_steps
                }

            for application_revision_id, origin in (application_steps or {}).items():
                application_revision_ref = Reference(id=application_revision_id)

                application_revision = await fetch_app_variant_revision_by_id(
                    variant_revision_id=str(application_revision_ref.id),
                )

                if not application_revision:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find application revision",
                        id=application_revision_ref.id,
                    )
                    return None

                application_variant_ref = Reference(
                    id=UUID(str(application_revision.variant_id))
                )

                application_variant = await fetch_app_variant_by_id(
                    app_variant_id=str(application_variant_ref.id),
                )

                if not application_variant:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find application variant",
                        id=application_variant_ref.id,
                    )
                    return None

                application_ref = Reference(id=UUID(str(application_variant.app_id)))

                application = await fetch_app_by_id(
                    app_id=str(application_ref.id),
                )

                if not application:
                    log.warn(
                        "[EVAL] [run] [make] [failure] could not find application",
                        id=application_ref.id,
                    )
                    return None

                application_revision_slug = get_slug_from_name_and_id(
                    str(application_revision.config_name),
                    UUID(str(application_revision.id)),
                )

                step_key = "application-" + application_revision_slug

                application_invocation_steps_keys.append(step_key)

                application_references[step_key] = dict(
                    application=Reference(
                        id=application_ref.id,
                        slug=str(application.app_name),
                    ),
                    application_variant=Reference(
                        id=application_variant_ref.id,
                        slug=str(application_variant.variant_name),
                    ),
                    application_revision=Reference(
                        id=application_revision_ref.id,
                        slug=str(application_revision.config_name),
                        version=str(application_revision.revision),
                    ),
                )

                application_revisions[step_key] = application_revision

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

            # JIT MIGRATION ================================================== #
            if jit and jit.get("evaluators"):
                _evaluator_steps = deepcopy(evaluator_steps or {})
                evaluator_steps = dict()

                for evaluator_id, origin in _evaluator_steps.items():
                    evaluator_ref = Reference(id=evaluator_id)

                    simple_evaluator = await self.simple_evaluators_service.transfer(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        evaluator_id=evaluator_id,
                    )

                    if (
                        not simple_evaluator
                        or not simple_evaluator.id
                        or not simple_evaluator.slug
                    ):
                        log.warn(
                            "[EVAL] [run] [make] [failure] could not transfer simple evaluator",
                            id=evaluator_ref.id,
                        )
                        return None

                    evaluator_revision = (
                        await self.evaluators_service.fetch_evaluator_revision(
                            project_id=project_id,
                            #
                            evaluator_ref=evaluator_ref,
                        )
                    )

                    if (
                        not evaluator_revision
                        or not evaluator_revision.id
                        or not evaluator_revision.slug
                    ):
                        log.warn(
                            "[EVAL] [run] [make] [failure] could not find evaluator revision",
                            id=evaluator_ref.id,
                        )
                        return None

                    evaluator_steps[evaluator_revision.id] = origin
            # ================================================================ #

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
                        schema=(evaluator_revision.data.schemas.get("outputs")),
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

            evaluator_annotation_mappings: List[EvaluationRunDataMapping] = []
            for step_key in evaluator_annotation_steps_keys:
                for metric_key in evaluator_metrics_keys[step_key]:
                    metric_path_value = (
                        metric_key.get("path")
                        if isinstance(metric_key, dict)
                        else getattr(metric_key, "path", "")
                    ) or ""
                    column_name = metric_path_value
                    mapping_path = (
                        f"attributes.ag.data.outputs.{metric_path_value}"
                        if metric_path_value
                        else "attributes.ag.data.outputs"
                    )
                    evaluator_annotation_mappings.append(
                        EvaluationRunDataMapping(
                            column=EvaluationRunDataMappingColumn(
                                kind="annotation",
                                name=column_name,
                            ),
                            step=EvaluationRunDataMappingStep(
                                key=step_key,
                                path=mapping_path,
                            ),
                        )
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

        except:  # pylint: disable=bare-except
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
            is_closed=is_closed,
            is_live=is_live,
            is_active=is_active,
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

        except:  # pylint: disable=bare-except
            log.error("[EVAL] [run] [parse] [failure]", exc_info=True)
            return None
