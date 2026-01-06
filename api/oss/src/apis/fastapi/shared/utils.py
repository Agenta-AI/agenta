from typing import Optional, Tuple, List, Any
from json import loads

from oss.src.core.shared.dtos import (
    Flags,
    Tags,
    Meta,
    Windowing,
)


def parse_metadata(
    flags: Optional[str] = None,
    tags: Optional[str] = None,
    meta: Optional[str] = None,
) -> Tuple[
    Optional[Flags],
    Optional[Tags],
    Optional[Meta],
]:
    _flags = None
    try:
        _flags = loads(flags) if flags else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    _tags = None
    try:
        _tags = loads(tags) if tags else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    _meta = None
    try:
        _meta = loads(meta) if meta else None
    except Exception:  # pylint: disable=broad-exception-caught
        pass

    return _flags, _tags, _meta


def compute_next_windowing(
    *,
    entities: List[Any],
    attribute: str,
    windowing: Optional[Windowing],
    order: str = "ascending",
) -> Optional[Windowing]:
    if not windowing or not windowing.limit or not entities:
        return None

    # If we got fewer entities than the limit, there's no next page
    if len(entities) < windowing.limit:
        return None

    # Get the last record from the list
    last_record = entities[-1]

    id_attributes = ["id", "span_id"]
    time_attributes = ["created_at", "start_time"]

    # Extract attributes from the last record
    entity_id_attribute = getattr(last_record, "id", None)
    span_id_attribute = getattr(last_record, "span_id", None)
    id_attribute_value = span_id_attribute or entity_id_attribute or None
    created_at_attribute = getattr(last_record, "created_at", None)
    start_time_attribute = getattr(last_record, "start_time", None)
    time_attribute_value = start_time_attribute or created_at_attribute or None

    order_attribute_name = attribute.lower()

    if not id_attribute_value:
        return None

    # Determine effective order (windowing.order overrides default)
    effective_order = (windowing.order or order).lower()

    # For ID-based ordering (UUID7), just use the ID as cursor
    if order_attribute_name in id_attributes:
        return Windowing(
            newest=windowing.newest,
            oldest=windowing.oldest,
            next=id_attribute_value,
            limit=windowing.limit,
            order=windowing.order,
        )

    # For time-based ordering (UUID5/content-hashed IDs), we need both:
    # - next: the ID for tie-breaking when timestamps are equal
    # - oldest/newest: the timestamp boundary for the cursor
    if order_attribute_name in time_attributes:
        if not time_attribute_value:
            return None

        if effective_order == "ascending":
            # Ascending: set oldest to last record's timestamp
            return Windowing(
                newest=windowing.newest,
                oldest=time_attribute_value,
                next=id_attribute_value,
                limit=windowing.limit,
                order=windowing.order,
            )
        else:
            # Descending: set newest to last record's timestamp
            return Windowing(
                newest=time_attribute_value,
                oldest=windowing.oldest,
                next=id_attribute_value,
                limit=windowing.limit,
                order=windowing.order,
            )

    return None
