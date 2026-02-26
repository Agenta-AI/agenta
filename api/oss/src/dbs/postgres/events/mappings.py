from oss.src.core.events.dtos import Event
from oss.src.core.events.types import EventType
from oss.src.dbs.postgres.events.dbes import EventDBE


def map_event_dto_to_dbe(*, event: Event, project_id) -> EventDBE:
    return EventDBE(
        project_id=project_id,
        #
        created_by_id=None,
        #
        request_id=event.request_id,
        event_id=event.event_id,
        #
        request_type=event.request_type,
        event_type=event.event_type.value,
        #
        timestamp=event.timestamp,
        #
        status_code=event.status_code,
        status_message=event.status_message,
        #
        attributes=event.attributes,
    )


def map_event_dbe_to_dto(*, event_dbe: EventDBE) -> Event:
    return Event(
        created_at=event_dbe.created_at,
        updated_at=event_dbe.updated_at,
        deleted_at=event_dbe.deleted_at,
        created_by_id=event_dbe.created_by_id,
        updated_by_id=event_dbe.updated_by_id,
        deleted_by_id=event_dbe.deleted_by_id,
        #
        request_id=event_dbe.request_id,
        event_id=event_dbe.event_id,
        #
        request_type=event_dbe.request_type,
        event_type=EventType(event_dbe.event_type),
        #
        timestamp=event_dbe.timestamp,
        #
        status_code=event_dbe.status_code,
        status_message=event_dbe.status_message,
        #
        attributes=event_dbe.attributes,
    )
