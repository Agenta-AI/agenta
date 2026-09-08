from datetime import datetime, timezone
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
    SessionNameSource,
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

# Where the session's CURRENT name came from. Stamped "manual" by a header edit a person
# authored, and left alone by an automatic one, so the row always answers "does a person
# control this name?". A reserved tag rather than a column: it needs no migration, and
# `_strip_reserved_tags` already keeps the whole `ag.` namespace out of every client read.
SESSION_NAME_SOURCE_TAG_KEY = "ag.name.source"

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
        SESSION_NAME_SOURCE_TAG_KEY,
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


def encode_name_source(
    *,
    tags: Optional[Dict[str, Any]],
    name_source: Optional[SessionNameSource],
    name: Optional[str],
) -> Optional[Dict[str, Any]]:
    """`tags` with the name-source stamp brought in line with an edit that sets `name`.

    Only a manual edit ever moves the stamp. An automatic one returns the tags untouched,
    which is what keeps a person in control of their name through the two edits the guard
    lets an automatic caller make: repeating the name that is already stored, and applying a
    rename that same person asked for. Clearing the stamp on either would hand the next
    stale call a session with nothing left to protect it.

    An edit that sets no name is left alone too: changing only the description says nothing
    about who named the session. A cleared name removes the stamp, because a row with no
    name has no source.
    """
    if name is None or name_source is not SessionNameSource.manual:
        return tags
    current = dict(tags) if isinstance(tags, dict) else {}
    if name:
        current[SESSION_NAME_SOURCE_TAG_KEY] = SessionNameSource.manual.value
    else:
        current.pop(SESSION_NAME_SOURCE_TAG_KEY, None)
    return current or None


def decode_name_source(
    tags: Optional[Dict[str, Any]],
) -> Optional[SessionNameSource]:
    """The stamped source of the row's current name, or None when nothing stamped it.

    A junk value reads as None rather than raising. It fails open, which is the wrong
    direction for a guard, but the alternative is a corrupt tag making every read of the
    session 500, and a name is not worth that. `_strip_reserved_tags` has the same posture.
    """
    if not isinstance(tags, dict):
        return None
    try:
        return SessionNameSource(tags.get(SESSION_NAME_SOURCE_TAG_KEY))
    except (TypeError, ValueError):
        return None


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
        tags=encode_name_source(
            tags=stream.tags,
            name_source=stream.name_source,
            name=stream.name,
        ),
        meta=stream.meta,
        turn_id=stream.turn_id,
        # A create that already names a turn IS that turn's start. Without this, the first row a
        # `_start_turn` writes carries no start time and the stale-Stop guard cannot fire on the
        # very first turn of a session.
        turn_started_at=datetime.now(timezone.utc) if stream.turn_id else None,
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
        turn_started_at=stream_dbe.turn_started_at,
        stopping_turn_id=stream_dbe.stopping_turn_id,
        references=references_from_json(stream_dbe.references),
        archived_at=stream_dbe.archived_at,
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
        # Stamp the start time only when the id actually CHANGES. A heartbeat restamps the same
        # id every 30 seconds, and a start time that moved with each beat would make every Stop
        # look like it arrived before its own turn began.
        if stream_dbe.turn_id != stream.turn_id:
            stream_dbe.turn_started_at = datetime.now(timezone.utc)
        stream_dbe.turn_id = stream.turn_id


def map_stream_dto_to_dbe_header_edit(
    *,
    stream_dbe: SessionStreamDBE,
    user_id: Optional[UUID],
    header: SessionStreamHeaderEdit,
    name_source: SessionNameSource = SessionNameSource.manual,
) -> None:
    """The rename edit: only ever touches name/description and the name-source stamp —
    never flags/turn_id. The stamp is reassigned rather than mutated in place, because
    SQLAlchemy does not track a mutation inside a JSONB dict."""
    stream_dbe.updated_by_id = user_id
    if header.name is not None:
        stream_dbe.tags = encode_name_source(
            tags=stream_dbe.tags,
            name_source=name_source,
            name=header.name,
        )
        stream_dbe.name = header.name
    if header.description is not None:
        stream_dbe.description = header.description
