from typing import Dict, List, Union, Literal
from uuid import UUID

from fastapi import Request, Depends, Query, status, HTTPException
from fastapi.responses import JSONResponse, Response

from oss.src.utils.logging import get_module_logger
from oss.src.core.observability.service import ObservabilityService
from oss.src.core.observability.dtos import (
    QueryDTO,
    AnalyticsDTO,
    TreeDTO,
    RootDTO,
    GroupingDTO,
    FilteringDTO,
    ConditionDTO,
    Focus,
)

from oss.src.core.observability.utils import FilteringException

from oss.src.apis.fastapi.shared.utils import handle_exceptions
from oss.src.apis.fastapi.observability.opentelemetry.otlp import (
    parse_otlp_stream,
)
from oss.src.apis.fastapi.observability.utils.processing import (
    parse_query_request,
    parse_analytics_dto,
    parse_from_otel_span_dto,
    parse_to_otel_span_dto,
    parse_to_agenta_span_dto,
    parse_legacy_analytics_dto,
    parse_legacy_analytics,
)
from oss.src.apis.fastapi.observability.models import (
    CollectStatusResponse,
    OTelTracingResponse,
    AgentaNodesResponse,
    AgentaTreesResponse,
    AgentaRootsResponse,
    AgentaNodeDTO,
    AgentaTreeDTO,
    AgentaRootDTO,
    LegacyAnalyticsResponse,
    AnalyticsResponse,
)

from oss.src.utils.common import APIRouter, is_ee

if is_ee():
    from ee.src.utils.entitlements import (
        check_entitlements,
        Tracker,
        Counter,
        NOT_ENTITLED_RESPONSE,
    )

# OTLP Protobuf response message for full success
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceResponse,
)

# Protobuf Status for error responses
from google.rpc.status_pb2 import Status as ProtoStatus

log = get_module_logger(__name__)


class ObservabilityRouter:
    VERSION = "1.0.0"

    def __init__(
        self,
        observability_service: ObservabilityService,
    ):
        self.service = observability_service

        self.router = APIRouter()

        self.otlp = APIRouter()

        ### OTLP (Collector)

        self.otlp.add_api_route(
            "/v1/traces",
            self.otlp_receiver,
            methods=["POST"],
            operation_id="otlp_v1_traces",
            summary="Receive /v1/traces via OTLP",
            status_code=status.HTTP_200_OK,
            response_model=CollectStatusResponse,
        )

        ### OTLP (SDK)

        self.router.add_api_route(
            "/otlp/traces",
            self.otlp_status,
            methods=["GET"],
            operation_id="otlp_status",
            summary="Status of OTLP endpoint",
            status_code=status.HTTP_200_OK,
            response_model=CollectStatusResponse,
        )

        self.router.add_api_route(
            "/otlp/traces",
            self.otlp_receiver,
            methods=["POST"],
            operation_id="otlp_receiver",
            summary="Receive traces via OTLP",
            status_code=status.HTTP_200_OK,
            response_model=CollectStatusResponse,
        )

        ### QUERIES

        self.router.add_api_route(
            "/traces",
            self.query_traces,
            methods=["GET"],
            operation_id="query_traces",
            summary="Query traces, with optional grouping, windowing, filtering, and pagination.",
            status_code=status.HTTP_200_OK,
            response_model=Union[
                OTelTracingResponse,
                AgentaNodesResponse,
                AgentaTreesResponse,
                AgentaRootsResponse,
            ],
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/analytics",
            self.query_analytics,
            methods=["GET"],
            operation_id="query_analytics",
            summary="Query analytics, with optional grouping, windowing, filtering.",
            status_code=status.HTTP_200_OK,
            response_model=Union[
                LegacyAnalyticsResponse,
                AnalyticsResponse,
            ],
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/traces/{trace_id}",
            self.fetch_trace_by_id,
            methods=["GET"],
            operation_id="fetch_trace_by_id",
            summary="Fetch trace by ID.",
            status_code=status.HTTP_200_OK,
            response_model=Union[
                OTelTracingResponse,
                AgentaNodesResponse,
                AgentaTreesResponse,
                AgentaRootsResponse,
            ],
            response_model_exclude_none=True,
        )

        ### MUTATIONS

        self.router.add_api_route(
            "/traces",
            self.delete_traces,
            methods=["DELETE"],
            operation_id="delete_traces",
            summary="Delete traces",
            status_code=status.HTTP_200_OK,
            response_model=CollectStatusResponse,
        )

    ### OTLP

    @handle_exceptions()
    async def otlp_status(self):
        """
        Status of OTLP endpoint.
        """

        return CollectStatusResponse(version=self.VERSION, status="ready")

    @handle_exceptions()
    async def otlp_receiver(
        self,
        request: Request,
    ):
        """
        Receive traces via OTLP.
        """

        otlp_stream = None
        try:
            # ---------------------------------------------------------------- #
            otlp_stream = await request.body()
            # ---------------------------------------------------------------- #
        except Exception as e:
            log.error(
                "Failed to process OTLP stream from project %s with error %s",
                request.state.project_id,
                str(e),
            )
            err_status = ProtoStatus(
                message="Invalid request body: not a valid OTLP stream."
            )
            return Response(
                content=err_status.SerializeToString(),
                media_type="application/x-protobuf",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        otel_spans = None
        try:
            # ---------------------------------------------------------------- #
            otel_spans = parse_otlp_stream(otlp_stream)
            # ---------------------------------------------------------------- #
        except Exception as e:
            log.error(
                "Failed to parse OTLP stream from project %s with error %s",
                request.state.project_id,
                str(e),
            )
            log.error(
                "OTLP stream: %s",
                otlp_stream,
            )
            err_status = ProtoStatus(message="Failed to parse OTLP stream.")
            return Response(
                content=err_status.SerializeToString(),
                media_type="application/x-protobuf",
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        span_dtos = None
        try:
            # ---------------------------------------------------------------- #
            span_dtos = [
                parse_from_otel_span_dto(otel_span) for otel_span in otel_spans
            ]
            # ---------------------------------------------------------------- #
        except Exception as e:
            log.error(
                "Failed to parse spans from project %s with error %s",
                request.state.project_id,
                str(e),
            )
            for otel_span in otel_spans:
                log.error(
                    "Span: [%s] %s",
                    UUID(otel_span.context.trace_id[2:]),
                    otel_span,
                )
            err_status = ProtoStatus(message="Failed to parse OTEL span.")
            return Response(
                content=err_status.SerializeToString(),
                media_type="application/x-protobuf",
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # -------------------------------------------------------------------- #
        delta = sum([1 for span_dto in span_dtos if span_dto.parent is None])

        if is_ee():
            check, _, _ = await check_entitlements(
                organization_id=request.state.organization_id,
                key=Counter.TRACES,
                delta=delta,
            )

            if not check:
                err_status = ProtoStatus(
                    message="You have reached your quota limit. Please upgrade your plan to continue."
                )
                return Response(
                    content=err_status.SerializeToString(),
                    media_type="application/x-protobuf",
                    status_code=status.HTTP_403_FORBIDDEN,
                )
        # -------------------------------------------------------------------- #

        try:
            # ---------------------------------------------------------------- #
            await self.service.ingest(
                project_id=UUID(request.state.project_id),
                span_dtos=span_dtos,
            )
            # ---------------------------------------------------------------- #
        except Exception as e:
            log.error(
                "Failed to ingest spans from project %s with error %s",
                request.state.project_id,
                str(e),
            )
            for span_dto in span_dtos:
                log.error(
                    "Span: [%s] %s",
                    span_dto.tree.id,
                    span_dto,
                )
            err_status = ProtoStatus(message="Failed to ingest spans.")
            return Response(
                content=err_status.SerializeToString(),
                media_type="application/x-protobuf",
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # ------------------------------------------------------------------ #
        # According to the OTLP/HTTP spec a full-success response must be an
        # HTTP 200 with a serialized ExportTraceServiceResponse protobuf and
        # the same Content-Type that the client used (we only support binary
        # protobuf at the moment).
        # ------------------------------------------------------------------ #

        export_response = ExportTraceServiceResponse()  # empty == full success

        return Response(
            content=export_response.SerializeToString(),
            media_type="application/x-protobuf",
            status_code=status.HTTP_200_OK,
        )

    ### QUERIES

    @handle_exceptions()
    async def query_traces(
        self,
        request: Request,
        query_dto: QueryDTO = Depends(parse_query_request),
        format: Literal[  # pylint: disable=W0622
            "opentelemetry",
            "agenta",
        ] = Query("agenta"),
    ):
        """
        Query traces, with optional grouping, windowing, filtering, and pagination.
        """

        if format == "opentelemetry" and query_dto.grouping:
            query_dto.grouping.focus = Focus.NODE

        try:
            span_dtos, count = await self.service.query(
                project_id=UUID(request.state.project_id),
                query_dto=query_dto,
            )
        except FilteringException as e:
            raise HTTPException(
                status_code=400,
                detail=str(e),
            ) from e

        spans = []

        # format = opentelemetry -> focus = node
        if format == "opentelemetry":
            spans = [parse_to_otel_span_dto(span_dto) for span_dto in span_dtos]

            return OTelTracingResponse(
                version=self.VERSION,
                count=count,
                spans=spans,
            )

        # format = agenta
        elif format == "agenta":
            spans = [parse_to_agenta_span_dto(span_dto) for span_dto in span_dtos]

            # focus = tree | root
            if query_dto.grouping and query_dto.grouping.focus.value != "node":
                _nodes_by_tree: Dict[str, List[AgentaNodeDTO]] = dict()
                _types_by_tree: Dict[str, str] = dict()

                for span in spans:
                    if span.tree.id not in _nodes_by_tree:
                        _nodes_by_tree[span.tree.id] = list()
                        _types_by_tree[span.tree.id] = None

                    _nodes_by_tree[span.tree.id].append(
                        AgentaNodeDTO(**span.model_dump())
                    )
                    _types_by_tree[span.tree.id] = span.tree.type

                # focus = tree
                if query_dto.grouping.focus.value == "tree":
                    return AgentaTreesResponse(
                        version=self.VERSION,
                        count=count,
                        trees=[
                            AgentaTreeDTO(
                                tree=TreeDTO(
                                    id=tree_id,
                                    type=_types_by_tree[tree_id],
                                ),
                                nodes=[
                                    AgentaNodeDTO(**span.model_dump()) for span in nodes
                                ],
                            )
                            for tree_id, nodes in _nodes_by_tree.items()
                        ],
                    )

                # focus = root
                else:
                    _nodes_by_root: Dict[str, List[AgentaTreeDTO]] = dict()
                    _types_by_root: Dict[str, str] = dict()

                    for tree_id, nodes in _nodes_by_tree.items():
                        if nodes[0].root.id not in _nodes_by_root:
                            _nodes_by_root[nodes[0].root.id] = list()
                            _types_by_root[nodes[0].root.id] = None

                        _nodes_by_root[nodes[0].root.id].append(
                            AgentaTreeDTO(
                                version=self.VERSION,
                                tree=TreeDTO(
                                    id=tree_id,
                                    type=_types_by_tree[tree_id],
                                ),
                                nodes=[
                                    AgentaNodeDTO(**span.model_dump()) for span in nodes
                                ],
                            )
                        )

                    return AgentaRootsResponse(
                        version=self.VERSION,
                        count=count,
                        roots=[
                            AgentaRootDTO(
                                root=RootDTO(id=root_id),
                                trees=trees,
                            )
                            for root_id, trees in _nodes_by_root.items()
                        ],
                    )

            # focus = node
            return AgentaNodesResponse(
                version=self.VERSION,
                count=count,
                nodes=[AgentaNodeDTO(**span.model_dump()) for span in spans],
            )

    @handle_exceptions()
    async def query_analytics(
        self,
        request: Request,
        analytics_dto: AnalyticsDTO = Depends(parse_analytics_dto),
        legacy_analytics_dto: AnalyticsDTO = Depends(parse_legacy_analytics_dto),
        format: Literal[  # pylint: disable=W0622
            "legacy",
            "agenta",
        ] = Query("agenta"),
    ):
        try:
            if legacy_analytics_dto is not None:
                analytics_dto = legacy_analytics_dto

            bucket_dtos, count = await self.service.analytics(
                project_id=UUID(request.state.project_id),
                analytics_dto=analytics_dto,
            )

            if format == "legacy":
                data, summary = parse_legacy_analytics(bucket_dtos)

                return LegacyAnalyticsResponse(
                    data=data,
                    **summary.model_dump(),
                )

            return AnalyticsResponse(
                version=self.VERSION,
                count=count,
                buckets=bucket_dtos,
            )

        except FilteringException as e:
            raise HTTPException(
                status_code=400,
                detail=str(e),
            ) from e

    @handle_exceptions()
    async def fetch_trace_by_id(
        self,
        request: Request,
        trace_id: Union[str, int],
        format: Literal[  # pylint: disable=W0622
            "opentelemetry",
            "agenta",
        ] = Query("openetelemetry"),
    ):
        """
        Fetch trace by ID.
        """

        tree_id = None

        if not trace_id:
            raise HTTPException(status_code=400, detail="trace_id is required.")

        # INT  # 66247539550469235673292373222060196016
        try:
            trace_id = hex(int(trace_id))
        except:  # pylint: disable=bare-except
            pass

        if not isinstance(trace_id, str):
            raise HTTPException(status_code=400, detail="trace_id is invalid.")

        # HEX   # 0x31d6cfe04b9011ec800142010a8000b0
        if trace_id.startswith("0x") and len(trace_id) > 2:
            trace_id = trace_id[2:]

        # UUID # 31d6cfe0-4b90-11ec-8001-42010a8000b0
        # HEX  # 31d6cfe04b9011ec800142010a8000b0
        try:
            tree_id = str(UUID(trace_id))
        except Exception as e:
            raise HTTPException(status_code=400, detail="trace_id is invalid.") from e

        return await self.query_traces(
            request=request,
            format=format,
            query_dto=QueryDTO(
                grouping=GroupingDTO(
                    focus="node" if format == "opentelemetry" else "tree",
                ),
                filtering=FilteringDTO(
                    conditions=[
                        ConditionDTO(
                            key="tree.id",
                            value=tree_id,
                        )
                    ]
                ),
            ),
        )

    ### MUTATIONS

    @handle_exceptions()
    async def delete_traces(
        self,
        request: Request,
        node_id: UUID = Query(None),
        node_ids: List[UUID] = Query(None),
    ):
        """
        Delete trace.
        """

        await self.service.delete(
            project_id=UUID(request.state.project_id),
            node_id=node_id,
            node_ids=node_ids,
        )

        return CollectStatusResponse(version=self.VERSION, status="deleted")
