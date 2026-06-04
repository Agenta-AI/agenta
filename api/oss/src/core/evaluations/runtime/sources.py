from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.evaluations.runtime.types import (
    ResolvedSourceBatch,
    ResolvedSourceItem,
    ResolvedTestsetInputSpec,
)
from oss.src.core.evaluations.types import EvaluationRun, EvaluationRunDataStep
from oss.src.core.evaluations.utils import TraceFetcher
from oss.src.core.queries.service import QueriesService
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.tracing.service import TracingService
from oss.src.core.shared.dtos import Reference
from oss.src.core.tracing.dtos import (
    Filtering,
    Windowing,
    Formatting,
    Format,
    Focus,
    TracingQuery,
    LogicalOperator,
)


def _extract_root_span(trace: Any) -> Optional[Any]:
    spans = (
        trace.get("spans") if isinstance(trace, dict) else getattr(trace, "spans", None)
    )
    if not isinstance(spans, dict) or not spans:
        return None

    for span in spans.values():
        if isinstance(span, list):
            continue
        if _extract_span_id(span):
            return span

    return None


def _extract_span_id(span: Any) -> Optional[str]:
    span_id = (
        span.get("span_id")
        if isinstance(span, dict)
        else getattr(span, "span_id", None)
    )
    return str(span_id) if span_id else None


def _extract_ag_data(trace: Any) -> Dict[str, Any]:
    root_span = _extract_root_span(trace)
    if root_span is None:
        return {}

    attributes = (
        root_span.get("attributes", {})
        if isinstance(root_span, dict)
        else getattr(root_span, "attributes", {})
    )
    if hasattr(attributes, "model_dump"):
        attributes = attributes.model_dump(mode="json", exclude_none=True)
    if not isinstance(attributes, dict):
        return {}

    ag = attributes.get("ag") or {}
    data = ag.get("data") if isinstance(ag, dict) else {}
    return data if isinstance(data, dict) else {}


class SourceResolutionError(Exception):
    """An input step does not carry exactly one recognized source reference."""

    pass


class SourceResolver:
    # The exact reference key this resolver handles. The dispatch loop selects a
    # resolver by which key the step carries, not by which one happens to return
    # a non-empty batch.
    source_reference_key: str = ""

    def applies(self, step: EvaluationRunDataStep) -> bool:
        refs = step.references or {}
        return self.source_reference_key in refs

    async def resolve(
        self,
        *,
        project_id: UUID,
        step: EvaluationRunDataStep,
    ) -> Optional[ResolvedSourceBatch]:
        raise NotImplementedError


class QueryRevisionTraceResolver(SourceResolver):
    source_reference_key = "query_revision"

    def __init__(
        self,
        *,
        queries_service: QueriesService,
    ):
        self.queries_service = queries_service

    async def resolve(
        self,
        *,
        project_id: UUID,
        step: EvaluationRunDataStep,
    ) -> Optional[ResolvedSourceBatch]:
        refs = step.references or {}
        query_revision_ref = refs.get("query_revision")

        if not step.key or not query_revision_ref or not query_revision_ref.id:
            return None

        query_revision = await self.queries_service.fetch_query_revision(
            project_id=project_id,
            #
            query_revision_ref=query_revision_ref,
            #
            include_trace_ids=True,
        )
        trace_ids = (
            query_revision.data.trace_ids
            if query_revision and query_revision.data and query_revision.data.trace_ids
            else []
        )

        if not trace_ids:
            return None

        return ResolvedSourceBatch(
            kind="traces",
            step_key=step.key,
            #
            trace_ids=trace_ids,
        )


class TestsetRevisionTestcaseResolver(SourceResolver):
    source_reference_key = "testset_revision"

    def __init__(
        self,
        *,
        testsets_service: TestsetsService,
    ):
        self.testsets_service = testsets_service

    async def resolve(
        self,
        *,
        project_id: UUID,
        step: EvaluationRunDataStep,
    ) -> Optional[ResolvedSourceBatch]:
        refs = step.references or {}
        testset_revision_ref = refs.get("testset_revision")

        if not step.key or not testset_revision_ref or not testset_revision_ref.id:
            return None

        testset_revision = await self.testsets_service.fetch_testset_revision(
            project_id=project_id,
            #
            testset_revision_ref=testset_revision_ref,
            #
            include_testcase_ids=True,
        )
        testcase_ids = (
            testset_revision.data.testcase_ids
            if testset_revision
            and testset_revision.data
            and testset_revision.data.testcase_ids
            else []
        )

        if not testcase_ids:
            return None

        return ResolvedSourceBatch(
            kind="testcases",
            step_key=step.key,
            #
            testcase_ids=testcase_ids,
        )


class TestsetRevisionPayloadResolver:
    def __init__(
        self,
        *,
        testsets_service: TestsetsService,
    ):
        self.testsets_service = testsets_service

    async def resolve(
        self,
        *,
        project_id: UUID,
        step: EvaluationRunDataStep,
    ) -> ResolvedTestsetInputSpec:
        refs = step.references or {}
        testset_revision_ref = refs.get("testset_revision")

        if not testset_revision_ref or not isinstance(testset_revision_ref.id, UUID):
            raise ValueError(
                f"Evaluation input step {step.key} missing testset_revision reference."
            )

        testset_revision = await self.testsets_service.fetch_testset_revision(
            project_id=project_id,
            #
            testset_revision_ref=testset_revision_ref,
        )
        if not testset_revision:
            raise ValueError(
                f"Testset revision with id {testset_revision_ref.id} not found!"
            )
        if not testset_revision.data or not testset_revision.data.testcases:
            raise ValueError(
                f"Testset revision with id {testset_revision_ref.id} has no testcases!"
            )

        testset_variant = await self.testsets_service.fetch_testset_variant(
            project_id=project_id,
            #
            testset_variant_ref=Reference(id=testset_revision.variant_id),
        )
        if not testset_variant:
            raise ValueError(
                f"Testset variant with id {testset_revision.variant_id} not found!"
            )

        testset = await self.testsets_service.fetch_testset(
            project_id=project_id,
            #
            testset_ref=Reference(id=testset_variant.testset_id),
        )
        if not testset:
            raise ValueError(f"Testset with id {testset_variant.testset_id} not found!")

        testcases = testset_revision.data.testcases
        # `testset` is fetched above only to validate the
        # revision -> variant -> testset chain; the spec carries just the
        # revision (which exposes testset_id/variant_id) plus the testcases.
        return ResolvedTestsetInputSpec(
            step_key=step.key,
            #
            testset_revision=testset_revision,
            testcases=testcases,
        )


class SourceResolution:
    """Resolves a run's input steps into source batches / hydrated source items.

    The services are injected ONCE here instead of threaded through every
    resolve call. Each service is Optional because a given flow only needs the
    subset its sources require (e.g. the direct-ingest path needs
    testcases/tracing; the queue-probe path needs queries/testsets).
    """

    def __init__(
        self,
        *,
        queries_service: Optional[QueriesService] = None,
        testsets_service: Optional[TestsetsService] = None,
        testcases_service: Optional[TestcasesService] = None,
        tracing_service: Optional[TracingService] = None,
    ):
        self.queries_service = queries_service
        self.testsets_service = testsets_service
        self.testcases_service = testcases_service
        self.tracing_service = tracing_service
        self._traces = TraceFetcher(tracing_service=tracing_service)

    async def resolve_queue_source_batches(
        self,
        *,
        project_id: UUID,
        run: EvaluationRun,
    ) -> List[ResolvedSourceBatch]:
        if not run.data or not run.data.steps:
            return []

        resolvers: List[SourceResolver] = [
            QueryRevisionTraceResolver(
                queries_service=self.queries_service,
            ),
            TestsetRevisionTestcaseResolver(
                testsets_service=self.testsets_service,
            ),
        ]
        batches: List[ResolvedSourceBatch] = []

        for step in run.data.steps:
            if step.type != "input" or not step.key:
                continue

            # Exactly one recognized source reference per input step. Selecting
            # by the applicable key (not by first non-empty result) means an
            # empty result — a query with zero traces — stays an empty batch
            # instead of falling through to the wrong resolver.
            applicable = [resolver for resolver in resolvers if resolver.applies(step)]

            if not applicable:
                continue

            if len(applicable) > 1:
                raise SourceResolutionError(
                    f"Input step '{step.key}' carries multiple source references "
                    f"({', '.join(r.source_reference_key for r in applicable)}); "
                    "exactly one is allowed."
                )

            batch = await applicable[0].resolve(
                project_id=project_id,
                #
                step=step,
            )
            if batch:
                batches.append(batch)

        return batches

    async def resolve_testset_input_specs(
        self,
        *,
        project_id: UUID,
        #
        input_steps: List[EvaluationRunDataStep],
    ) -> List[ResolvedTestsetInputSpec]:
        resolver = TestsetRevisionPayloadResolver(
            testsets_service=self.testsets_service
        )
        return [
            await resolver.resolve(
                project_id=project_id,
                #
                step=input_step,
            )
            for input_step in input_steps
        ]

    async def resolve_direct_source_items(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: Optional[List[str]] = None,
        testcase_ids: Optional[List[UUID]] = None,
    ) -> List[ResolvedSourceItem]:
        source_items: List[ResolvedSourceItem] = []
        testcase_ids = testcase_ids or []
        trace_ids = trace_ids or []

        testcases = (
            await self.testcases_service.fetch_testcases(
                project_id=project_id,
                #
                testcase_ids=testcase_ids,
            )
            if testcase_ids and self.testcases_service is not None
            else []
        )
        testcases_by_id = {
            testcase.id: testcase
            for testcase in testcases
            if getattr(testcase, "id", None)
        }
        traces_by_id: Dict[str, Any] = {}

        if trace_ids and self.tracing_service is not None:
            for trace_id in trace_ids:
                trace = await self._traces.fetch_trace(
                    project_id=project_id,
                    #
                    trace_id=trace_id,
                    #
                    max_retries=1,
                    delay=0,
                )
                if trace is not None:
                    traces_by_id[trace_id] = trace

        source_items.extend(
            ResolvedSourceItem(
                kind="testcase",
                step_key="",
                #
                testcase_id=testcase_id,
                testcase=testcases_by_id.get(testcase_id),
            )
            for testcase_id in testcase_ids
        )
        for trace_id in trace_ids:
            trace = traces_by_id.get(trace_id)
            ag_data = _extract_ag_data(trace) if trace is not None else {}
            root_span = _extract_root_span(trace) if trace is not None else None
            source_items.append(
                ResolvedSourceItem(
                    kind="trace",
                    step_key="",
                    #
                    trace_id=trace_id,
                    span_id=_extract_span_id(root_span),
                    trace=trace,
                    #
                    inputs=ag_data.get("inputs"),
                    outputs=ag_data.get("outputs"),
                )
            )

        return source_items

    async def resolve_live_query_traces(
        self,
        *,
        project_id: UUID,
        #
        query_revisions: Dict[str, Any],
        #
        newest: Optional[datetime] = None,
        oldest: Optional[datetime] = None,
        #
        use_windowing: bool = False,
    ) -> Dict[str, List[Any]]:
        query_traces: Dict[str, List[Any]] = {}

        for query_step_key, query_revision in query_revisions.items():
            formatting = Formatting(
                focus=Focus.TRACE,
                format=Format.AGENTA,
            )
            filtering = Filtering(
                operator=LogicalOperator.AND,
                conditions=[],
            )
            windowing = Windowing(
                oldest=oldest,
                newest=newest,
                next=None,
                limit=None,
                order="ascending",
                interval=None,
                rate=None,
            )

            query_revision_data = getattr(query_revision, "data", None)
            if query_revision_data:
                query_filtering = getattr(query_revision_data, "filtering", None)
                query_windowing = getattr(query_revision_data, "windowing", None)

                if query_filtering:
                    filtering = query_filtering

                if query_windowing and use_windowing:
                    windowing = Windowing(
                        oldest=query_windowing.oldest,
                        newest=query_windowing.newest,
                        limit=query_windowing.limit,
                        order=query_windowing.order,
                        rate=query_windowing.rate,
                    )
                elif query_windowing:
                    windowing.rate = query_windowing.rate

            query_traces[query_step_key] = (
                await self.tracing_service.query_traces(
                    project_id=project_id,
                    #
                    query=TracingQuery(
                        formatting=formatting,
                        filtering=filtering,
                        windowing=windowing,
                    ),
                )
                or []
            )

        return query_traces

    async def resolve_query_source_items(
        self,
        *,
        project_id: UUID,
        #
        run: EvaluationRun,
        #
        newest: Optional[datetime] = None,
        oldest: Optional[datetime] = None,
        #
        use_windowing: bool = False,
    ) -> Dict[str, List[ResolvedSourceItem]]:
        if not run.data or not run.data.steps:
            return {}

        query_revisions: Dict[str, Any] = {}
        for step in run.data.steps:
            if step.type != "input" or not step.key:
                continue

            query_revision_ref = (step.references or {}).get("query_revision")
            if not query_revision_ref:
                continue

            query_revision = await self.queries_service.fetch_query_revision(
                project_id=project_id,
                #
                query_revision_ref=query_revision_ref,
            )
            if (
                not query_revision
                or not getattr(query_revision, "id", None)
                or not getattr(query_revision, "slug", None)
            ):
                continue

            query_revisions[step.key] = query_revision

        query_traces = await self.resolve_live_query_traces(
            project_id=project_id,
            #
            query_revisions=query_revisions,
            #
            newest=newest,
            oldest=oldest,
            #
            use_windowing=use_windowing,
        )

        return {
            query_step_key: [
                ResolvedSourceItem(
                    kind="trace",
                    step_key=query_step_key,
                    #
                    trace_id=trace.trace_id,
                    trace=trace,
                )
                for trace in traces
                if trace and trace.trace_id
            ]
            for query_step_key, traces in query_traces.items()
        }
