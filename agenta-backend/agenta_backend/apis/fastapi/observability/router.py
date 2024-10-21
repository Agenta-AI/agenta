from typing import Dict, List, Union, Optional, Callable

from fastapi import (
    APIRouter,
    Request,
    Depends,
    Query,
    status,
    HTTPException,
)

from agenta_backend.core.observability.service import ObservabilityService
from agenta_backend.core.observability.dtos import QueryDTO

from agenta_backend.apis.fastapi.shared.utils import handle_exceptions
from agenta_backend.apis.fastapi.observability.opentelemetry.otlp import (
    parse_otlp_stream,
)
from agenta_backend.apis.fastapi.observability.utils import (
    parse_query_dto,
    parse_from_otel_span_dto,
    parse_to_otel_span_dto,
    parse_to_agenta_span_dto,
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
    SpanDTO,
    TreeDTO,
    RootDTO,
)

VERSION = "1.0.0"


class ObservabilityRouter:
    VERSION = "1.0.0"

    def __init__(
        self,
        observability_service: ObservabilityService,
        observability_legacy_receiver: Optional[Callable] = None,
    ):
        self.service = observability_service

        self.legacy_receiver = observability_legacy_receiver

        self.router = APIRouter()

        ### STATUS

        self.router.add_api_route(
            "/traces",
            self.otlp_status,
            methods=["GET"],
            operation_id="otlp_status",
            summary="Status of OTLP endpoint",
            status_code=status.HTTP_200_OK,
            response_model=CollectStatusResponse,
        )

        ### QUERIES

        self.router.add_api_route(
            "/{project_id}/traces",
            self.query_traces,
            methods=["GET"],
            operation_id="query_traces",
            summary="Query traces, with optional grouping, filtering, (sorting,) and pagination.",
            status_code=status.HTTP_200_OK,
            response_model=Union[
                OTelSpansResponse,
                AgentaNodesResponse,
                AgentaTreesResponse,
                AgentaRootsResponse,
            ],
            response_model_exclude_none=True,
        )

        ### MUTATIONS

        self.router.add_api_route(
            "/traces",
            self.otlp_collect_traces,
            methods=["POST"],
            operation_id="otlp_collect_traces",
            summary="Collect traces via OTLP",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=CollectStatusResponse,
        )

    ### STATUS

    @handle_exceptions()
    async def otlp_status(self):
        """
        Status of OTLP endpoint.
        """

        return CollectStatusResponse(version=self.VERSION, status="ready")

    ### QUERIES

    @handle_exceptions()
    async def query_traces(
        self,
        project_id: str,
        query_dto: QueryDTO = Depends(parse_query_dto),
        format: str = Query("agenta"),
    ):
        """
        Query traces, with optional grouping, filtering, (sorting,) and pagination.
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

        span_dtos = await self.service.query(
            project_id=project_id,
            query_dto=query_dto,
        )

        spans = []

        if format == "opentelemetry":
            spans = [parse_to_otel_span_dto(span_dto) for span_dto in span_dtos]

            return OTelSpansResponse(
                version=self.VERSION,
                spans=spans,
            )

        elif format == "agenta":
            spans = [parse_to_agenta_span_dto(span_dto) for span_dto in span_dtos]

            if query_dto.grouping:
                if query_dto.grouping.focus.value in ["tree", "root"]:
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

                    if query_dto.grouping.focus.value == "tree":
                        return AgentaTreesResponse(
                            version=VERSION,
                            trees=[
                                AgentaTreeDTO(
                                    tree=TreeDTO(
                                        id=tree_id,
                                        type=_types_by_tree[tree_id],
                                    ),
                                    nodes=[
                                        AgentaNodeDTO(**span.model_dump())
                                        for span in nodes
                                    ],
                                )
                                for tree_id, nodes in _nodes_by_tree.items()
                            ],
                        )

                    _nodes_by_root: Dict[str, List[AgentaTreeDTO]] = dict()
                    _types_by_root: Dict[str, str] = dict()

                    for tree_id, nodes in _nodes_by_tree.items():
                        if nodes[0].root.id not in _nodes_by_root:
                            _nodes_by_root[nodes[0].root.id] = list()
                            _types_by_root[nodes[0].root.id] = None

                        _nodes_by_root[nodes[0].root.id].append(
                            AgentaTreeDTO(
                                version=VERSION,
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
                        version=VERSION,
                        roots=[
                            AgentaRootDTO(
                                root=RootDTO(id=root_id),
                                trees=trees,
                            )
                            for root_id, trees in _nodes_by_root.items()
                        ],
                    )

            return AgentaNodesResponse(
                version=VERSION,
                nodes=[AgentaNodeDTO(**span.model_dump()) for span in spans],
            )

    ### MUTATIONS

    @handle_exceptions()
    async def otlp_collect_traces(
        self,
        request: Request,
    ):
        """
        Collect traces via OTLP.
        """

        otlp_stream = await request.body()

        project_id = request.headers.get("AG-PROJECT-ID") or request.state.project_id
        app_id = request.headers.get("AG-APP-ID")

        ### LEGACY ###
        if self.legacy_receiver:
            await self.legacy_receiver(
                project_id=project_id,
                otlp_stream=otlp_stream,
            )
        ### LEGACY ###

        otel_span_dtos = parse_otlp_stream(otlp_stream)

        span_dtos = [
            parse_from_otel_span_dto(project_id or app_id, otel_span_dto)
            for otel_span_dto in otel_span_dtos
        ]

        await self.service.ingest(span_dtos=span_dtos)

        return CollectStatusResponse(version=self.VERSION, status="processing")
