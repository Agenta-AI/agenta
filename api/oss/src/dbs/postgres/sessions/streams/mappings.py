from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import ValidationError

from oss.src.core.sessions.types import (
    SessionDelivery,
    SessionOrigin,
    SessionTrigger,
    SessionTriggerAttribution,
)
from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamCreate,
    SessionStreamEdit,
    SessionStreamFlags,
    SessionStreamHeaderEdit,
    SessionStreamQueryResult,
)
from oss.src.dbs.postgres.sessions.references import (
    references_from_json,
    references_to_json,
)
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE


SESSION_ORIGIN_TAG_KEY = "ag.origin"
SESSION_TRIGGER_ID_TAG_KEY = "ag.trigger.id"
SESSION_TRIGGER_KIND_TAG_KEY = "ag.trigger.kind"
SESSION_TRIGGER_DELIVERY_ID_TAG_KEY = "ag.trigger.delivery_id"
# Legacy: no current writer, but rows stamped before this diff may still carry it.
SESSION_TRIGGER_NAME_TAG_KEY = "ag.trigger.name"

# Single source of truth for "which exact tag keys the writer stamps" — used by
# the writer-side subset assert (P1-7's test) so a future fifth attribution key
# is caught if it isn't inside the reserved namespace below.
SESSION_RESERVED_TAG_KEYS = frozenset(
    {
        SESSION_ORIGIN_TAG_KEY,
        SESSION_TRIGGER_ID_TAG_KEY,
        SESSION_TRIGGER_KIND_TAG_KEY,
        SESSION_TRIGGER_DELIVERY_ID_TAG_KEY,
        SESSION_TRIGGER_NAME_TAG_KEY,
    }
)

# The reserved namespace (P3-7): the whole "ag." prefix is reserved, not just
# these five exact names — a future "ag.custom" read as caller-owned today,
# which contradicts what the names promise. There is no tag write path yet, so
# this closes the door before one exists rather than patching a live hole.
# Exact semantics, deliberately simple: `key.startswith("ag.")` — no case
# folding, no whitespace trimming.
SESSION_RESERVED_TAG_NAMESPACE = "ag."


def trigger_attribution_tags(
    attribution: SessionTriggerAttribution,
) -> Dict[str, str]:
    return {
        SESSION_ORIGIN_TAG_KEY: SessionOrigin.trigger.value,
        SESSION_TRIGGER_ID_TAG_KEY: str(attribution.configuration_id),
        SESSION_TRIGGER_KIND_TAG_KEY: attribution.kind.value,
        SESSION_TRIGGER_DELIVERY_ID_TAG_KEY: str(attribution.delivery_id),
    }


def _strip_reserved_tags(
    tags: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """The sanitization chokepoint (P1-6): every read path constructs its
    `SessionStream` through `map_stream_dbe_to_dto`, so stripping here — rather
    than in each of the API's seven hand-copied router call sites — is the one
    place a future eighth read path automatically inherits the guarantee."""
    if not tags:
        return None
    sanitized = {
        key: value
        for key, value in tags.items()
        if not key.startswith(SESSION_RESERVED_TAG_NAMESPACE)
    }
    # All-reserved tags must read back as absent, not `{}` (P3-8).
    return sanitized or None


def decode_session_attribution(
    tags: Optional[Dict[str, Any]],
) -> tuple[
    Optional[SessionOrigin], Optional[SessionTrigger], Optional[SessionDelivery]
]:
    # A malformed JSONB value (e.g. a list) must not 500 every list containing the
    # row (P3-10) — treat anything but a dict as untagged.
    tags = tags if isinstance(tags, dict) else {}

    origin_value = tags.get(SESSION_ORIGIN_TAG_KEY)
    if origin_value is None:
        # No stamp at all means a human session — every writer of `ag.origin` sets
        # "trigger"; nothing ever stamped "manual" (P1-1). Default it here so a
        # human session reports an origin instead of null.
        origin = SessionOrigin.manual
    else:
        try:
            origin = SessionOrigin(origin_value)
        except (TypeError, ValueError):
            origin = None

    try:
        trigger = SessionTrigger(
            id=tags.get(SESSION_TRIGGER_ID_TAG_KEY),
            kind=tags.get(SESSION_TRIGGER_KIND_TAG_KEY),
        )
    except ValidationError:
        trigger = None

    try:
        delivery = SessionDelivery(id=tags.get(SESSION_TRIGGER_DELIVERY_ID_TAG_KEY))
    except ValidationError:
        delivery = None

    return origin, trigger, delivery


def map_stream_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: Optional[UUID],
    stream: SessionStreamCreate,
) -> SessionStreamDBE:
    return SessionStreamDBE(
        project_id=project_id,
        created_by_id=user_id,
        session_id=stream.session_id,
        name=stream.name,
        description=stream.description,
        flags=stream.flags.model_dump(mode="json") if stream.flags else None,
        tags=stream.tags,
        meta=stream.meta,
        turn_id=stream.turn_id,
        references=references_to_json(stream.references),
    )


def map_stream_dbe_to_dto(
    *,
    stream_dbe: SessionStreamDBE,
) -> SessionStream:
    origin, trigger, delivery = decode_session_attribution(stream_dbe.tags)
    return SessionStream(
        id=stream_dbe.id,
        created_at=stream_dbe.created_at,
        updated_at=stream_dbe.updated_at,
        deleted_at=stream_dbe.deleted_at,
        created_by_id=stream_dbe.created_by_id,
        updated_by_id=stream_dbe.updated_by_id,
        deleted_by_id=stream_dbe.deleted_by_id,
        project_id=stream_dbe.project_id,
        session_id=stream_dbe.session_id,
        name=stream_dbe.name,
        description=stream_dbe.description,
        turn_id=stream_dbe.turn_id,
        references=references_from_json(stream_dbe.references),
        archived_at=stream_dbe.archived_at,
        history_incomplete=stream_dbe.history_incomplete,
        flags=SessionStreamFlags.model_validate(stream_dbe.flags)
        if stream_dbe.flags
        else SessionStreamFlags(),
        tags=_strip_reserved_tags(stream_dbe.tags),
        meta=stream_dbe.meta,
        origin=origin,
        trigger=trigger,
        delivery=delivery,
    )


def map_stream_query_result(
    *,
    stream_dbe: SessionStreamDBE,
    trigger_name: Optional[str] = None,
) -> SessionStreamQueryResult:
    return SessionStreamQueryResult(
        stream=map_stream_dbe_to_dto(stream_dbe=stream_dbe),
        trigger_name=trigger_name,
    )


def map_stream_dto_to_dbe_edit(
    *,
    stream_dbe: SessionStreamDBE,
    user_id: Optional[UUID],
    stream: SessionStreamEdit,
) -> None:
    stream_dbe.updated_by_id = user_id
    if stream.name is not None:
        stream_dbe.name = stream.name
    if stream.description is not None:
        stream_dbe.description = stream.description
    if stream.flags is not None:
        stream_dbe.flags = stream.flags.model_dump(mode="json")
    if stream.tags is not None:
        stream_dbe.tags = stream.tags
    if stream.meta is not None:
        stream_dbe.meta = stream.meta
    if stream.turn_id is not None:
        stream_dbe.turn_id = stream.turn_id


def map_stream_dto_to_dbe_header_edit(
    *,
    stream_dbe: SessionStreamDBE,
    user_id: Optional[UUID],
    header: SessionStreamHeaderEdit,
) -> None:
    """The rename edit: only ever touches name/description — never flags/turn_id."""
    stream_dbe.updated_by_id = user_id
    if header.name is not None:
        stream_dbe.name = header.name
    if header.description is not None:
        stream_dbe.description = header.description
