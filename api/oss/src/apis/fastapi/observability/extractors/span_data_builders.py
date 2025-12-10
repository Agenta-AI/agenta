from typing import Any
from abc import ABC, abstractmethod
from uuid import UUID


from oss.src.core.tracing.dtos import OTelSpan, OTelFlatSpan, OTelEvent, OTelLink
from oss.src.core.tracing.utils import (
    parse_trace_id_to_uuid,
    parse_span_id_to_uuid,
    parse_timestamp_to_datetime,
    parse_span_kind_to_enum,
    parse_status_code_to_enum,
)

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

from oss.src.apis.fastapi.tracing.utils import _parse_span_from_request


log = get_module_logger(__name__)


def _transform_legacy_references(attributes: dict[str, Any]) -> dict[str, Any]:
    if not attributes:
        return attributes

    # Mapping of old keys to new keys
    ref_mappings = {
        "ag.references.variant.id": "ag.references.application_variant.id",
        "ag.references.variant.slug": "ag.references.application_variant.slug",
        "ag.references.variant.version": "ag.references.application_revision.version",
        "ag.references.environment.version": "ag.references.environment_revision.version",
    }

    for old_key, new_key in list(ref_mappings.items()):
        if old_key in attributes:
            attributes[new_key] = attributes[old_key]
            del attributes[old_key]

    return attributes


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

        data = features.data

        metrics = features.metrics
        metrics["acc.duration.total"] = duration

        meta = features.meta

        refs = features.refs

        # links = features.links
        links = []

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


class OTelFlatSpanBuilder(SpanDataBuilder):
    """
    Concrete implementation that builds a OTelFlatSpan.
    """

    @property
    def name(self) -> str:
        return "otel_flat_span_builder"

    def build(
        self,
        otel_span_dto: OTelSpanDTO,
        features: SpanFeatures,
    ) -> OTelFlatSpan:
        # IDS ------------------------------------------------------------------
        trace_id = otel_span_dto.context.trace_id[2:]
        span_id = otel_span_dto.context.span_id[2:]
        parent_id = otel_span_dto.parent.span_id[2:] if otel_span_dto.parent else None

        try:
            trace_id = parse_trace_id_to_uuid(trace_id)
            span_id = parse_span_id_to_uuid(span_id)
            parent_id = parse_span_id_to_uuid(parent_id) if parent_id else None
        except ValueError as e:
            log.error(
                f"OTelFlatSpanBuilder: Error creating UUIDs from trace_id '{trace_id}', span_id '{span_id}', parent_id '{parent_id}'. Error: {e}."
            )
            raise ValueError(
                f"Invalid hex string for trace_id: {trace_id} or span_id: {span_id} or parent_id: {parent_id}."
            ) from e
        # ----------------------------------------------------------------------

        # KIND ----------------------------------------------------------------
        span_kind = otel_span_dto.kind.value

        try:
            span_kind = parse_span_kind_to_enum(span_kind)
        except ValueError as e:
            log.error(
                f"OTelFlatSpanBuilder: Error parsing span kind '{span_kind}'. Error: {e}."
            )
            raise ValueError(f"Invalid span kind: {span_kind}") from e
        # ----------------------------------------------------------------------

        # NAME -----------------------------------------------------------------
        span_name = otel_span_dto.name
        # ----------------------------------------------------------------------

        # TIME -----------------------------------------------------------------
        start_time = parse_timestamp_to_datetime(otel_span_dto.start_time)
        end_time = parse_timestamp_to_datetime(otel_span_dto.end_time)
        # ----------------------------------------------------------------------

        # STATUS ---------------------------------------------------------------
        status_code = otel_span_dto.status_code.value
        status_message = otel_span_dto.status_message or None

        try:
            status_code = parse_status_code_to_enum(status_code)
        except ValueError as e:
            log.error(
                f"OTelFlatSpanBuilder: Error parsing status code '{status_code}'. Error: {e}."
            )
            raise ValueError(f"Invalid status code: {status_code}") from e
        # ----------------------------------------------------------------------

        # ATTRIBUTES -----------------------------------------------------------
        attributes = dict(otel_span_dto.attributes or {})

        attributes.update(**{f"ag.data.{k}": v for k, v in features.data.items()})

        attributes.update(**{f"ag.flags.{k}": v for k, v in features.flags.items()})
        attributes.update(**{f"ag.tags.{k}": v for k, v in features.tags.items()})
        attributes.update(**{f"ag.meta.{k}": v for k, v in features.meta.items()})

        attributes.update(**{f"ag.references.{k}": v for k, v in features.refs.items()})

        # Transform legacy reference keys to new naming convention
        attributes = _transform_legacy_references(attributes)

        ## TYPES ---------------------------------------------------------------
        attributes.update(**{f"ag.type.{k}": v for k, v in features.type.items()})

        for k, v in features.type.items():
            del attributes[f"ag.type.{k}"]

            if k == "tree":
                attributes["ag.type.trace"] = v.lower() if v else None
            elif k == "node":
                attributes["ag.type.span"] = v.lower() if v else None
        ## ---------------------------------------------------------------------

        ## METRICS -------------------------------------------------------------
        attributes.update(**{f"ag.metrics.{k}": v for k, v in features.metrics.items()})

        for k, v in features.metrics.items():
            del attributes[f"ag.metrics.{k}"]

            k = k.replace("acc.costs.", "costs.cumulative.")
            k = k.replace("unit.costs.", "costs.incremental.")
            k = k.replace("acc.tokens.", "tokens.cumulative.")
            k = k.replace("unit.tokens.", "tokens.incremental.")

            attributes[f"ag.metrics.{k}"] = v

        if "acc.duration.total" in features.metrics:
            del attributes["ag.metrics.acc.duration.total"]
        ## ---------------------------------------------------------------------

        # ----------------------------------------------------------------------

        # LINKS ----------------------------------------------------------------
        links = []

        if features.links:
            for link in features.links:
                try:
                    links.append(
                        OTelLink(
                            trace_id=link.trace_id,
                            span_id=link.span_id,
                            attributes=link.attributes,
                        )
                    )
                except Exception as e:
                    log.warn(
                        f"OTelFlatSpanBuilder: Error creating OTelLink from link: {link}. Error: {e}."
                    )

        # ----------------------------------------------------------------------

        # EVENTS ---------------------------------------------------------------
        events = []

        if otel_span_dto.events:
            for event in otel_span_dto.events:
                try:
                    events.append(
                        OTelEvent(
                            name=event.name,
                            timestamp=parse_timestamp_to_datetime(event.timestamp),
                            attributes=event.attributes,
                        )
                    )
                except Exception as e:
                    log.warn(
                        f"OTelFlatSpanBuilder: Error creating OTelEvent from event: {event}. Error: {e}."
                    )

        # ----------------------------------------------------------------------

        try:
            span_dto = OTelSpan(
                # IDS
                trace_id=trace_id,
                span_id=span_id,
                parent_id=parent_id,
                # KIND
                span_kind=span_kind,
                # NAME
                span_name=span_name,
                # TIME
                start_time=start_time,
                end_time=end_time,
                # STATUS
                status_code=status_code,
                status_message=status_message,
                # ATTRIBUTES
                attributes=attributes,
                # LINKS
                links=links,
                # EVENTS
                events=events,
            )

            span_dtos = _parse_span_from_request(span_dto)

            otel_flat_span = span_dtos[0] if span_dtos else None

        except Exception as e:
            log.error(
                "OTelFlatSpanBuilder: Failed to create OTelFlatSpan from span. Error: %s. SpanFeatures: %s. Span: %s.",
                str(e),
                features,
                otel_span_dto,
            )
            raise e

        return otel_flat_span
