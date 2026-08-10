from uuid import UUID

from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelAgentCreate,
    ChannelAgentData,
    ChannelAgentEdit,
    ChannelAgentFlags,
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelConnectionEdit,
    ChannelConnectionFlags,
    ChannelGrant,
    ChannelGrantCreate,
    ChannelGrantData,
    ChannelGrantEdit,
    ChannelGrantFlags,
    ChannelInboxEvent,
    ChannelInboxEventCreate,
    ChannelInboxEventData,
    ChannelInboxEventFlags,
    ChannelInboxTrigger,
    ChannelInboxTriggerCreate,
    ChannelInboxTriggerFlags,
    ChannelOutboxEvent,
    ChannelOutboxEventCreate,
    ChannelOutboxEventData,
    ChannelOutboxEventFlags,
    ChannelSpace,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceEdit,
    ChannelSpaceFlags,
    ChannelThread,
    ChannelThreadCreate,
    ChannelThreadData,
    ChannelThreadFlags,
)
from oss.src.core.shared.dtos import Status
from oss.src.dbs.postgres.channels.dbes import (
    ChannelAgentDBE,
    ChannelConnectionDBE,
    ChannelGrantDBE,
    ChannelInboxEventDBE,
    ChannelInboxTriggerDBE,
    ChannelOutboxEventDBE,
    ChannelSpaceDBE,
    ChannelThreadDBE,
)


# --- Connection ----------------------------------------------------------- #


def map_connection_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    connection: ChannelConnectionCreate,
) -> ChannelConnectionDBE:
    return ChannelConnectionDBE(
        project_id=project_id,
        #
        created_by_id=user_id,
        #
        channel=connection.channel,
        external_key=connection.external_key,
        slug=connection.slug,
        #
        name=connection.name,
        description=connection.description,
        tags=connection.tags,
        meta=connection.meta,
        #
        data=connection.data,
        flags=connection.flags.model_dump(),
    )


def map_connection_dbe_to_dto(
    *, connection_dbe: ChannelConnectionDBE
) -> ChannelConnection:
    return ChannelConnection(
        id=connection_dbe.id,
        #
        created_at=connection_dbe.created_at,
        updated_at=connection_dbe.updated_at,
        deleted_at=connection_dbe.deleted_at,
        created_by_id=connection_dbe.created_by_id,
        updated_by_id=connection_dbe.updated_by_id,
        deleted_by_id=connection_dbe.deleted_by_id,
        #
        channel=connection_dbe.channel,
        external_key=connection_dbe.external_key,
        slug=connection_dbe.slug,
        #
        name=connection_dbe.name,
        description=connection_dbe.description,
        #
        tags=connection_dbe.tags,
        meta=connection_dbe.meta,
        #
        data=connection_dbe.data,
        status=Status.model_validate(connection_dbe.status)
        if connection_dbe.status
        else None,
        flags=ChannelConnectionFlags(**(connection_dbe.flags or {})),
    )


def map_connection_dto_to_dbe_edit(
    *,
    connection_dbe: ChannelConnectionDBE,
    #
    user_id: UUID,
    #
    connection: ChannelConnectionEdit,
) -> None:
    connection_dbe.updated_by_id = user_id

    connection_dbe.name = connection.name
    connection_dbe.description = connection.description

    connection_dbe.tags = connection.tags
    connection_dbe.meta = connection.meta

    connection_dbe.data = connection.data
    connection_dbe.flags = connection.flags.model_dump()


# --- Agent -------------------------------------------------------------- #


def map_agent_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    agent: ChannelAgentCreate,
) -> ChannelAgentDBE:
    return ChannelAgentDBE(
        project_id=project_id,
        #
        created_by_id=user_id,
        #
        connection_id=agent.connection_id,
        slug=agent.slug,
        #
        name=agent.name,
        description=agent.description,
        tags=agent.tags,
        meta=agent.meta,
        #
        data=agent.data.model_dump(mode="json", exclude_none=True),
        flags=agent.flags.model_dump(),
    )


def map_agent_dbe_to_dto(*, agent_dbe: ChannelAgentDBE) -> ChannelAgent:
    return ChannelAgent(
        id=agent_dbe.id,
        #
        created_at=agent_dbe.created_at,
        updated_at=agent_dbe.updated_at,
        deleted_at=agent_dbe.deleted_at,
        created_by_id=agent_dbe.created_by_id,
        updated_by_id=agent_dbe.updated_by_id,
        deleted_by_id=agent_dbe.deleted_by_id,
        #
        connection_id=agent_dbe.connection_id,
        slug=agent_dbe.slug,
        #
        name=agent_dbe.name,
        description=agent_dbe.description,
        #
        tags=agent_dbe.tags,
        meta=agent_dbe.meta,
        #
        data=ChannelAgentData.model_validate(agent_dbe.data),
        flags=ChannelAgentFlags(**(agent_dbe.flags or {})),
    )


def map_agent_dto_to_dbe_edit(
    *,
    agent_dbe: ChannelAgentDBE,
    #
    user_id: UUID,
    #
    agent: ChannelAgentEdit,
) -> None:
    agent_dbe.updated_by_id = user_id

    agent_dbe.name = agent.name
    agent_dbe.description = agent.description

    agent_dbe.tags = agent.tags
    agent_dbe.meta = agent.meta

    agent_dbe.data = agent.data.model_dump(mode="json", exclude_none=True)
    agent_dbe.flags = agent.flags.model_dump()


# --- Space ---------------------------------------------------------------- #


def map_space_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    space: ChannelSpaceCreate,
) -> ChannelSpaceDBE:
    return ChannelSpaceDBE(
        project_id=project_id,
        #
        created_by_id=user_id,
        #
        connection_id=space.connection_id,
        kind=space.kind,
        external_key=space.external_key,
        #
        name=space.name,
        description=space.description,
        tags=space.tags,
        meta=space.meta,
        #
        data=space.data.model_dump(mode="json", exclude_none=True),
        flags=space.flags.model_dump(),
    )


def map_space_dbe_to_dto(*, space_dbe: ChannelSpaceDBE) -> ChannelSpace:
    return ChannelSpace(
        id=space_dbe.id,
        #
        created_at=space_dbe.created_at,
        updated_at=space_dbe.updated_at,
        deleted_at=space_dbe.deleted_at,
        created_by_id=space_dbe.created_by_id,
        updated_by_id=space_dbe.updated_by_id,
        deleted_by_id=space_dbe.deleted_by_id,
        #
        connection_id=space_dbe.connection_id,
        kind=space_dbe.kind,
        external_key=space_dbe.external_key,
        #
        name=space_dbe.name,
        description=space_dbe.description,
        #
        tags=space_dbe.tags,
        meta=space_dbe.meta,
        #
        data=ChannelSpaceData.model_validate(space_dbe.data),
        flags=ChannelSpaceFlags(**(space_dbe.flags or {})),
    )


def map_space_dto_to_dbe_edit(
    *,
    space_dbe: ChannelSpaceDBE,
    #
    user_id: UUID,
    #
    space: ChannelSpaceEdit,
) -> None:
    space_dbe.updated_by_id = user_id

    space_dbe.name = space.name
    space_dbe.description = space.description

    space_dbe.tags = space.tags
    space_dbe.meta = space.meta

    space_dbe.data = space.data.model_dump(mode="json", exclude_none=True)
    space_dbe.flags = space.flags.model_dump()


# --- Grant ---------------------------------------------------------------- #


def map_grant_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    grant: ChannelGrantCreate,
) -> ChannelGrantDBE:
    return ChannelGrantDBE(
        project_id=project_id,
        #
        created_by_id=user_id,
        #
        agent_id=grant.agent_id,
        effect=grant.effect,
        kind=grant.kind,
        space_id=grant.space_id,
        #
        name=grant.name,
        description=grant.description,
        tags=grant.tags,
        meta=grant.meta,
        #
        data=grant.data.model_dump(mode="json", exclude_none=True),
        flags=grant.flags.model_dump(),
    )


def map_grant_dbe_to_dto(*, grant_dbe: ChannelGrantDBE) -> ChannelGrant:
    return ChannelGrant(
        id=grant_dbe.id,
        #
        created_at=grant_dbe.created_at,
        updated_at=grant_dbe.updated_at,
        deleted_at=grant_dbe.deleted_at,
        created_by_id=grant_dbe.created_by_id,
        updated_by_id=grant_dbe.updated_by_id,
        deleted_by_id=grant_dbe.deleted_by_id,
        #
        agent_id=grant_dbe.agent_id,
        effect=grant_dbe.effect,
        kind=grant_dbe.kind,
        space_id=grant_dbe.space_id,
        #
        name=grant_dbe.name,
        description=grant_dbe.description,
        #
        tags=grant_dbe.tags,
        meta=grant_dbe.meta,
        #
        data=ChannelGrantData.model_validate(grant_dbe.data),
        flags=ChannelGrantFlags(**(grant_dbe.flags or {})),
    )


def map_grant_dto_to_dbe_edit(
    *,
    grant_dbe: ChannelGrantDBE,
    #
    user_id: UUID,
    #
    grant: ChannelGrantEdit,
) -> None:
    grant_dbe.updated_by_id = user_id

    grant_dbe.name = grant.name
    grant_dbe.description = grant.description

    grant_dbe.tags = grant.tags
    grant_dbe.meta = grant.meta

    grant_dbe.data = grant.data.model_dump(mode="json", exclude_none=True)
    grant_dbe.flags = grant.flags.model_dump()


# --- Thread (no edit mapper: append-only) ---------------------------------- #


def map_thread_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: UUID | None,
    #
    thread: ChannelThreadCreate,
) -> ChannelThreadDBE:
    return ChannelThreadDBE(
        project_id=project_id,
        #
        created_by_id=user_id,
        #
        space_id=thread.space_id,
        agent_id=thread.agent_id,
        external_key=thread.external_key,
        session_id=thread.session_id,
        #
        data=thread.data.model_dump(mode="json", exclude_none=True),
        flags=thread.flags.model_dump(),
    )


def map_thread_dbe_to_dto(*, thread_dbe: ChannelThreadDBE) -> ChannelThread:
    return ChannelThread(
        id=thread_dbe.id,
        #
        created_at=thread_dbe.created_at,
        updated_at=thread_dbe.updated_at,
        deleted_at=thread_dbe.deleted_at,
        created_by_id=thread_dbe.created_by_id,
        updated_by_id=thread_dbe.updated_by_id,
        deleted_by_id=thread_dbe.deleted_by_id,
        #
        space_id=thread_dbe.space_id,
        agent_id=thread_dbe.agent_id,
        external_key=thread_dbe.external_key,
        session_id=thread_dbe.session_id,
        #
        data=ChannelThreadData.model_validate(thread_dbe.data or {}),
        flags=ChannelThreadFlags(**(thread_dbe.flags or {})),
    )


# --- Inbox event (no edit mapper: append-only log) ------------------------- #


def map_inbox_event_dto_to_dbe_create(
    *,
    project_id: UUID,
    #
    event: ChannelInboxEventCreate,
) -> ChannelInboxEventDBE:
    return ChannelInboxEventDBE(
        project_id=project_id,
        #
        connection_id=event.connection_id,
        external_id=event.external_id,
        kind=event.kind,
        origin=event.origin,
        space_id=event.space_id,
        #
        data=event.data.model_dump(mode="json", exclude_none=True),
        flags=ChannelInboxEventFlags().model_dump(),
    )


def map_inbox_event_dbe_to_dto(*, event_dbe: ChannelInboxEventDBE) -> ChannelInboxEvent:
    return ChannelInboxEvent(
        id=event_dbe.id,
        #
        created_at=event_dbe.created_at,
        updated_at=event_dbe.updated_at,
        deleted_at=event_dbe.deleted_at,
        created_by_id=event_dbe.created_by_id,
        updated_by_id=event_dbe.updated_by_id,
        deleted_by_id=event_dbe.deleted_by_id,
        #
        connection_id=event_dbe.connection_id,
        external_id=event_dbe.external_id,
        kind=event_dbe.kind,
        origin=event_dbe.origin,
        space_id=event_dbe.space_id,
        #
        status=Status.model_validate(event_dbe.status) if event_dbe.status else None,
        data=ChannelInboxEventData.model_validate(event_dbe.data),
        flags=ChannelInboxEventFlags(**(event_dbe.flags or {})),
    )


# --- Inbox trigger (no edit mapper: transition_inbox_trigger writes direct) # #


def map_inbox_trigger_dto_to_dbe_create(
    *,
    project_id: UUID,
    #
    trigger: ChannelInboxTriggerCreate,
) -> ChannelInboxTriggerDBE:
    return ChannelInboxTriggerDBE(
        project_id=project_id,
        #
        thread_id=trigger.thread_id,
        event_id=trigger.event_id,
        turn_id=trigger.turn_id,
        state=trigger.state,
        #
        flags=trigger.flags.model_dump(),
    )


def map_inbox_trigger_dbe_to_dto(
    *, trigger_dbe: ChannelInboxTriggerDBE
) -> ChannelInboxTrigger:
    return ChannelInboxTrigger(
        id=trigger_dbe.id,
        #
        created_at=trigger_dbe.created_at,
        updated_at=trigger_dbe.updated_at,
        deleted_at=trigger_dbe.deleted_at,
        created_by_id=trigger_dbe.created_by_id,
        updated_by_id=trigger_dbe.updated_by_id,
        deleted_by_id=trigger_dbe.deleted_by_id,
        #
        thread_id=trigger_dbe.thread_id,
        event_id=trigger_dbe.event_id,
        turn_id=trigger_dbe.turn_id,
        state=trigger_dbe.state,
        #
        status=Status.model_validate(trigger_dbe.status)
        if trigger_dbe.status
        else None,
        flags=ChannelInboxTriggerFlags(**(trigger_dbe.flags or {})),
    )


# --- Outbox event (no edit mapper: transition_outbox_event writes direct) - #


def map_outbox_event_dto_to_dbe_create(
    *,
    project_id: UUID,
    #
    event: ChannelOutboxEventCreate,
) -> ChannelOutboxEventDBE:
    return ChannelOutboxEventDBE(
        project_id=project_id,
        #
        connection_id=event.connection_id,
        thread_id=event.thread_id,
        turn_id=event.turn_id,
        key=event.key,
        state=event.state,
        #
        data=event.data.model_dump(mode="json", exclude_none=True),
        flags=ChannelOutboxEventFlags().model_dump(),
    )


def map_outbox_event_dbe_to_dto(
    *, event_dbe: ChannelOutboxEventDBE
) -> ChannelOutboxEvent:
    return ChannelOutboxEvent(
        id=event_dbe.id,
        #
        created_at=event_dbe.created_at,
        updated_at=event_dbe.updated_at,
        deleted_at=event_dbe.deleted_at,
        created_by_id=event_dbe.created_by_id,
        updated_by_id=event_dbe.updated_by_id,
        deleted_by_id=event_dbe.deleted_by_id,
        #
        connection_id=event_dbe.connection_id,
        thread_id=event_dbe.thread_id,
        turn_id=event_dbe.turn_id,
        key=event_dbe.key,
        state=event_dbe.state,
        #
        status=Status.model_validate(event_dbe.status) if event_dbe.status else None,
        data=ChannelOutboxEventData.model_validate(event_dbe.data or {}),
        flags=ChannelOutboxEventFlags(**(event_dbe.flags or {})),
    )
