from abc import ABC, abstractmethod
from typing import Any
from uuid import UUID

from oss.src.core.observability.dtos import (
    OTelSpanDTO,
    SpanDTO,
    RootDTO,
    TreeDTO,
    NodeDTO,
    ParentDTO,
    TimeDTO,
    StatusDTO,
    ExceptionDTO,
    OTelExtraDTO,
)
from oss.src.apis.fastapi.observability.extractors.canonical_attributes import (
    SpanFeatures,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__file__)


class SpanDataBuilder(ABC):
    """
    Abstract base class for span data builders.
    Each builder transforms an OTelSpanDTO and SpanFeatures into a specific output format.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """
        Returns a unique name for the builder (e.g., 'node_builder', 'default_span_builder').
        This name will be used as a key in the SpanProcessor's output dictionary.
        """
        pass

    @abstractmethod
    def build(self, otel_span_dto: OTelSpanDTO, features: SpanFeatures) -> Any:
        """
        Builds the target span representation.

        Args:
            otel_span_dto: The original OpenTelemetry span.
            features: The extracted features.

        Returns:
            The processed span data (e.g., a SpanDTO, a dict, etc.).
        """
        pass


class NodeBuilder(SpanDataBuilder):
    """
    Concrete implementation that builds a SpanDTO.
    This encapsulates the logic from the original SpanProcessor._build_span_dto.
    """

    @property
    def name(self) -> str:
        return "node_builder"

    def build(self, otel_span_dto: OTelSpanDTO, features: SpanFeatures) -> SpanDTO:
        trace_id = otel_span_dto.context.trace_id[2:]
        span_id = otel_span_dto.context.span_id[2:]
        tree_id = UUID(trace_id)

        node_id_hex = tree_id.hex[16:] + span_id
        try:
            node_id = UUID(node_id_hex)
        except ValueError as e:
            log.error(
                f"NodeBuilder: Error creating node_id UUID from hex '{node_id_hex}'. OTelSpan: {otel_span_dto}. SpanFeatures: {features}. Error: {e}"
            )
            raise ValueError(f"Invalid hex string for node_id: {node_id_hex}") from e

        tree_type = features.type.get("tree")

        node_type = features.type.get("node")
        if node_type not in [
            "agent",
            "workflow",
            "chain",
            "task",
            "tool",
            "embedding",
            "query",
            "completion",
            "chat",
            "rerank",
        ]:
            node_type = "task"

        root_id_str = features.refs.get("scenario", {}).get("id", str(tree_id))
        root = RootDTO(id=UUID(root_id_str))

        tree = TreeDTO(id=tree_id, type=tree_type)

        node = NodeDTO(id=node_id, type=node_type, name=otel_span_dto.name)

        parent = None
        if otel_span_dto.parent:
            parent_id_hex = (
                otel_span_dto.parent.trace_id[2 + 16 :]
                + otel_span_dto.parent.span_id[2:]
            )
            try:
                parent_id = UUID(parent_id_hex)
                parent = ParentDTO(id=parent_id)
            except ValueError as e:
                log.error(
                    f"NodeBuilder: Error creating parent_id UUID from hex '{parent_id_hex}'. OTelSpan: {otel_span_dto}. SpanFeatures: {features}. Error: {e}"
                )
                raise ValueError(
                    f"Invalid hex string for parent_id: {parent_id_hex}"
                ) from e

        time_dto = TimeDTO(start=otel_span_dto.start_time, end=otel_span_dto.end_time)
        duration = round(
            (time_dto.end - time_dto.start).total_seconds() * 1_000, 3
        )  # milliseconds

        status = StatusDTO(
            code=(
                otel_span_dto.status_code.value.replace("STATUS_CODE_", "")
                if otel_span_dto.status_code
                else None
            ),
            message=otel_span_dto.status_message,
        )

        exception = None
        if features.exception:
            exception = ExceptionDTO(
                timestamp=features.exception.get("timestamp"),
                type=features.exception.get("type"),
                message=features.exception.get("message"),
                stacktrace=features.exception.get("stacktrace"),
                attributes=features.exception.get("attributes"),
            )

        data = features.mdata

        metrics = features.metrics
        metrics["acc.duration.total"] = duration

        meta = features.meta

        refs = features.refs

        links = features.links

        otel = OTelExtraDTO(
            kind=(otel_span_dto.kind.value if otel_span_dto.kind else None),
            attributes=otel_span_dto.attributes,
            events=otel_span_dto.events,
            links=otel_span_dto.links,
        )

        try:
            span_dto = SpanDTO(
                trace_id=trace_id,
                span_id=span_id,
                root=root,
                tree=tree,
                node=node,
                parent=parent,
                time=time_dto,
                status=status,
                exception=exception,
                data=data,
                metrics=metrics,
                meta=meta,
                refs=refs,
                links=links,
                otel=otel,
            )
        except Exception as e:
            log.error(
                "NodeBuilder: Failed to create SpanDTO from span: %s. SpanFeatures: %s. Error: %s",
                otel_span_dto,
                features,
                str(e),
            )
            raise e
        return span_dto
