from typing import Any, Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field

from oss.src.core.observability.dtos import (
    OTelStatusCode,
    OTelSpanKind,
)  # For type hints


class SpanFeatures(BaseModel):
    data: Dict[str, Any] = Field(
        default_factory=dict
    )  # unmarshalled data to be used with tracing
    mdata: Dict[str, Any] = Field(
        default_factory=dict
    )  # marshalled data to be used with nodes
    metrics: Dict[str, Any] = Field(default_factory=dict)
    meta: Dict[str, Any] = Field(default_factory=dict)
    refs: Dict[str, Any] = Field(default_factory=dict)
    references: Dict[str, Any] = Field(
        default_factory=dict
    )  # references, to be used with tracing
    links: List[Any] = Field(default_factory=list)
    exception: Dict[str, Any] = Field(default_factory=dict)
    type: Dict[str, Any] = Field(default_factory=dict)
    tags: Dict[str, Any] = Field(default_factory=dict)


class EventData(BaseModel):
    name: str
    timestamp: datetime
    attributes: Dict[str, Any] = Field(default_factory=dict)


class LinkData(BaseModel):
    trace_id: str
    span_id: str
    attributes: Dict[str, Any] = Field(default_factory=dict)


class CanonicalAttributes(BaseModel):
    """A normalized and structured container for all attributes and metadata from an OpenTelemetry span."""

    # Core span identifiers and metadata
    span_name: str
    trace_id: str
    span_id: str
    parent_span_id: Optional[str] = None
    span_kind: OTelSpanKind
    start_time: datetime
    end_time: datetime
    status_code: OTelStatusCode
    status_message: Optional[str] = None

    # Attributes from different sources
    span_attributes: Dict[str, Any] = Field(default_factory=dict)
    resource_attributes: Dict[str, Any] = Field(
        default_factory=dict
    )  # Assuming these might be populated
    # scope_attributes: Dict[str, Any] = Field(default_factory=dict) # Placeholder if needed later

    # Structured events and links
    events: List[EventData] = Field(default_factory=list)
    links: List[LinkData] = Field(default_factory=list)

    # Helper methods (can be added if common access patterns emerge for adapters)
    # For example, a method to get all 'ag.*' prefixed attributes from span_attributes
    # or resource_attributes. For now, adapters will access these dicts directly.

    class Config:
        arbitrary_types_allowed = True  # For OTelSpanKind and OTelStatusCode enums

    def get_attributes_in_namespace(
        self, prefix: str, source: str = "span"
    ) -> Dict[str, Any]:
        """Get attributes from the specified source that match the given prefix.

        Args:
            prefix: The prefix to match (e.g., "ag.data").
            source: The attribute source to search ('span' or 'resource'). Defaults to 'span'.

        Returns:
            A dictionary of matching attributes with the prefix (and dot) removed from keys.
        """
        attributes_to_search: Dict[str, Any]
        if source == "span":
            attributes_to_search = self.span_attributes
        elif source == "resource":
            attributes_to_search = self.resource_attributes
        # Add other sources like 'scope' if they become relevant
        else:
            return {}  # Or raise an error for unsupported source

        result = {}
        for key, value in attributes_to_search.items():
            if key.startswith(prefix):
                # Remove the prefix and the dot if present
                new_key = key[len(prefix) :]
                if new_key.startswith("."):
                    new_key = new_key[1:]
                result[new_key] = value
        return result

    def has_attributes_in_namespace(self, prefix: str, source: str = "span") -> bool:
        """Check if any attributes from the specified source match the given prefix.

        Args:
            prefix: The prefix to match.
            source: The attribute source to search ('span' or 'resource'). Defaults to 'span'.

        Returns:
            True if a matching attribute is found, False otherwise.
        """
        attributes_to_search: Dict[str, Any]
        if source == "span":
            attributes_to_search = self.span_attributes
        elif source == "resource":
            attributes_to_search = self.resource_attributes
        else:
            return False  # Or raise an error

        return any(key.startswith(prefix) for key in attributes_to_search)

    def get_events_by_name(self, event_name: str) -> List[EventData]:
        """Get all events that match the given event name.

        Args:
            event_name: The name of the event to filter by.

        Returns:
            A list of EventData objects that match the name, preserving original order.
        """
        return [event for event in self.events if event.name == event_name]

    def __str__(self) -> str:
        return (
            f"CanonicalAttributes(name='{self.name}', span_id='{self.span_id}', trace_id='{self.trace_id}', "
            f"attributes_count={len(self.span_attributes)}, events_count={len(self.events)})"
        )
