from typing import Dict, List, Union, Optional, Callable, Literal
from uuid import UUID

from fastapi import APIRouter, Request, Depends, Query, status, HTTPException

from agenta_backend.core.observability.service import ObservabilityService
from agenta_backend.core.observability.dtos import (
    QueryDTO,
    AnalyticsDTO,
    TreeDTO,
    RootDTO,
)
from agenta_backend.core.observability.utils import FilteringException

from agenta_backend.apis.fastapi.shared.utils import handle_exceptions
from agenta_backend.apis.fastapi.observability.opentelemetry.otlp import (
    parse_otlp_stream,
)
from agenta_backend.apis.fastapi.observability.utils import (
    parse_query_dto,
    parse_analytics_dto,
    parse_from_otel_span_dto,
    parse_to_otel_span_dto,
    parse_to_agenta_span_dto,
    parse_legacy_analytics_dto,
    parse_legacy_analytics,
)
from agenta_backend.apis.fastapi.observability.models import (
    CollectStatusResponse,
    OTelSpansResponse,
    AgentaNodesResponse,
    AgentaTreesResponse,
    AgentaRootsResponse,
    AgentaNodeDTO,
    AgentaTreeDTO,
    AgentaRootDTO,
    LegacyAnalyticsResponse,
    AnalyticsResponse,
)


class ObservabilityRouter:
    VERSION = "1.0.0"

    def __init__(
        self,
        observability_service: ObservabilityService,
    ):
        self.service = observability_service

        self.router = APIRouter()

        ### OTLP

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
            status_code=status.HTTP_202_ACCEPTED,
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
                OTelSpansResponse,
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

        otlp_stream = await request.body()

        otel_span_dtos = parse_otlp_stream(otlp_stream)

        span_dtos = [
            parse_from_otel_span_dto(otel_span_dto) for otel_span_dto in otel_span_dtos
        ]

        await self.service.ingest(
            project_id=UUID(request.state.project_id),
            span_dtos=span_dtos,
        )

        return CollectStatusResponse(version=self.VERSION, status="processing")

    ### QUERIES

    @handle_exceptions()
    async def query_traces(
        self,
        request: Request,
        query_dto: QueryDTO = Depends(parse_query_dto),
        format: Literal[  # pylint: disable=W0622
            "opentelemetry",
            "agenta",
        ] = Query("agenta"),
    ):
        """
        Query traces, with optional grouping, windowing, filtering, and pagination.
        """

        if (
            format == "opentelemetry"
            and query_dto.grouping
            and query_dto.grouping.focus.value != "node"
        ):
            raise HTTPException(
                status_code=400,
                detail="Grouping is not supported in OpenTelemetry format.",
            )

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

            return OTelSpansResponse(
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
