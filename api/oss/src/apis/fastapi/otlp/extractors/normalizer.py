from typing import List, Optional
from copy import copy
from datetime import datetime, timezone

from oss.src.core.otel.dtos import (
    OTelSpanDTO,
    OTelStatusCode,
)
from oss.src.apis.fastapi.otlp.extractors.canonical_attributes import (
    CanonicalAttributes,
    EventData,
    LinkData,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class Normalizer:
    """Normalizes OpenTelemetry spans into a canonical attribute bag.

    This class handles:
    1. Applying semantic convention mappings
    2. Populating a structured CanonicalAttributes with span metadata, attributes, events, and links.
    """

    def normalize(self, otel_span_dto: OTelSpanDTO) -> CanonicalAttributes:
        """Normalize an OpenTelemetry span into a canonical attribute bag.

        Args:
            otel_span_dto: The OpenTelemetry span to normalize

        Returns:
            A CanonicalAttributes containing all normalized attributes and metadata.
        """

        events_data: List[EventData] = []
        if otel_span_dto.events:
            for event_dto in otel_span_dto.events:
                try:
                    # Attempt to parse ISO format timestamp, assuming UTC if no tzinfo
                    # OTel spec usually means UTC for timestamps.
                    dt_timestamp = datetime.fromisoformat(
                        event_dto.timestamp.replace("Z", "+00:00")
                    )
                    if dt_timestamp.tzinfo is None:
                        dt_timestamp = dt_timestamp.replace(tzinfo=timezone.utc)
                except ValueError:
                    # Fallback or error handling for non-ISO timestamps if necessary
                    # For now, let's assume UTC now as a fallback, or log an error
                    # log.warn(f"Could not parse event timestamp: {event_dto.timestamp}")
                    dt_timestamp = datetime.now(timezone.utc)

                events_data.append(
                    EventData(
                        name=event_dto.name,
                        timestamp=dt_timestamp,
                        attributes=(
                            copy(event_dto.attributes) if event_dto.attributes else {}
                        ),
                    )
                )

        links_data: List[LinkData] = []
        if otel_span_dto.links:
            for link_dto in otel_span_dto.links:
                links_data.append(
                    LinkData(
                        trace_id=link_dto.context.trace_id,
                        span_id=link_dto.context.span_id,
                        attributes=(
                            copy(link_dto.attributes) if link_dto.attributes else {}
                        ),
                    )
                )

        parent_span_id_val: Optional[str] = None
        if otel_span_dto.parent:
            parent_span_id_val = otel_span_dto.parent.span_id

        # Create the structured CanonicalAttributes
        attributes = CanonicalAttributes(
            span_name=otel_span_dto.name,
            trace_id=otel_span_dto.context.trace_id,
            span_id=otel_span_dto.context.span_id,
            parent_span_id=parent_span_id_val,
            span_kind=otel_span_dto.kind,
            start_time=otel_span_dto.start_time,
            end_time=otel_span_dto.end_time,
            status_code=(
                otel_span_dto.status_code
                if otel_span_dto.status_code
                else OTelStatusCode.STATUS_CODE_UNSET
            ),  # Ensure default
            status_message=otel_span_dto.status_message,
            span_attributes=copy(otel_span_dto.attributes),
            events=copy(events_data),
            links=copy(links_data),
        )

        return attributes
