from oss.src.core.events.dtos import EventIngestDTO, EventDTO
from oss.src.dbs.postgres.events.dbes import EventDBE


def map_event_dto_to_dbe(*, event_dto: EventIngestDTO) -> EventDBE:
    return EventDBE(
        project_id=event_dto.project_id,
        created_by_id=event_dto.created_by_id,
        flow_id=event_dto.flow_id,
        event_id=event_dto.event_id,
        flow_type=event_dto.flow_type,
        event_type=event_dto.event_type,
        event_name=event_dto.event_name,
        timestamp=event_dto.timestamp,
        status_code=event_dto.status_code,
        status_message=event_dto.status_message,
        attributes=event_dto.attributes,
    )


def map_event_dbe_to_dto(*, event_dbe: EventDBE) -> EventDTO:
    return EventDTO(
        project_id=event_dbe.project_id,
        created_at=event_dbe.created_at,
        updated_at=event_dbe.updated_at,
        deleted_at=event_dbe.deleted_at,
        created_by_id=event_dbe.created_by_id,
        updated_by_id=event_dbe.updated_by_id,
        deleted_by_id=event_dbe.deleted_by_id,
        flow_id=event_dbe.flow_id,
        event_id=event_dbe.event_id,
        flow_type=event_dbe.flow_type,
        event_type=event_dbe.event_type,
        event_name=event_dbe.event_name,
        timestamp=event_dbe.timestamp,
        status_code=event_dbe.status_code,
        status_message=event_dbe.status_message,
        attributes=event_dbe.attributes,
    )
