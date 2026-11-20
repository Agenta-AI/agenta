from datetime import datetime, timezone
from typing import Any, Dict, Optional, Union
from uuid import UUID

from pydantic import ValidationError

from oss.src.core.access.dtos import RunEnvelope, RunOrigin
from oss.src.core.sharing.dtos import Visibility
from oss.src.core.sessions.types import (
    SessionCallingSession,
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
# The calling session record of a session that an agent in another session created.
SESSION_CALLING_SESSION_ID_TAG_KEY = "ag.calling_session.id"
SESSION_CALLING_SESSION_TURN_ID_TAG_KEY = "ag.calling_session.turn_id"
SESSION_CALLING_SESSION_AGENT_ID_TAG_KEY = "ag.calling_session.agent_id"
SESSION_CALLING_SESSION_REVISION_ID_TAG_KEY = "ag.calling_session.revision_id"

# Where the session's CURRENT name came from. Stamped "manual" by a header edit a person
# authored, and left alone by an automatic one, so the row always answers "does a person
# control this name?". A reserved tag rather than a column: it needs no migration, and
# `_strip_reserved_tags` already keeps the whole `ag.` namespace out of every client read.
SESSION_NAME_SOURCE_TAG_KEY = "ag.name.source"

# How many times this row's name has changed. It counts from 1 and only ever goes up, which
# is what lets an authorization to replace one particular name be spent: restoring an earlier
# name brings back the string, never the revision it was written at.
SESSION_NAME_REVISION_TAG_KEY = "ag.name.rev"

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
        SESSION_CALLING_SESSION_ID_TAG_KEY,
        SESSION_CALLING_SESSION_TURN_ID_TAG_KEY,
        SESSION_CALLING_SESSION_AGENT_ID_TAG_KEY,
        SESSION_CALLING_SESSION_REVISION_ID_TAG_KEY,
        SESSION_NAME_SOURCE_TAG_KEY,
        SESSION_NAME_REVISION_TAG_KEY,
    }
)

# The reserved namespace (P3-7): the whole "ag." prefix is reserved, not just
# these five exact names — a future "ag.custom" read as caller-owned today,
# which contradicts what the names promise. There is no tag write path yet, so
# this closes the door before one exists rather than patching a live hole.
# Exact semantics, deliberately simple: `key.startswith("ag.")` — no case
# folding, no whitespace trimming.
SESSION_RESERVED_TAG_NAMESPACE = "ag."


# The session origin of a row, by the run origin of the run that creates it. Every
# `RunOrigin` has a row. None writes no `ag.origin` tag, so the row reads `manual`:
# `web` is a person; `evaluation` gets no value of its own until an evaluation is seen
# to create session rows; `child` (a blocking workflow call) has no session.
_SESSION_ORIGIN_BY_RUN_ORIGIN: Dict[RunOrigin, Optional[SessionOrigin]] = {
    RunOrigin.WEB: None,
    RunOrigin.EVALUATION: None,
    RunOrigin.CHILD: None,
    RunOrigin.API: SessionOrigin.api,
    RunOrigin.INSTALLATION: SessionOrigin.channel,
    RunOrigin.SCHEDULE: SessionOrigin.trigger,
    RunOrigin.SUBSCRIPTION: SessionOrigin.trigger,
    RunOrigin.CALLING_SESSION: SessionOrigin.calling_session,
}


def session_origin_tags(
    envelope: Optional[RunEnvelope],
    attribution: Union[SessionTriggerAttribution, SessionCallingSession, None] = None,
) -> Dict[str, str]:
    """The creation record of a new session row, as reserved tags. The only writer of
    `ag.origin`.

    `envelope` is the run that creates the row. `attribution` is the identity of the
    creator, when it has one: the `SessionTriggerAttribution` of a fire, or the
    `SessionCallingSession` of a start from another session. A fire's attribution is
    enough on its own (a refused fire claims its session before any envelope exists);
    any other attribution must match the envelope's run origin."""
    run_origin = envelope.context.origin if envelope is not None else None
    if isinstance(attribution, SessionTriggerAttribution):
        if run_origin not in (None, RunOrigin.SCHEDULE, RunOrigin.SUBSCRIPTION):
            raise ValueError(f"a trigger attribution with run origin {run_origin}")
        return {
            SESSION_ORIGIN_TAG_KEY: SessionOrigin.trigger.value,
            **_trigger_attribution_tags(attribution),
        }
    if isinstance(attribution, SessionCallingSession):
        if run_origin != RunOrigin.CALLING_SESSION:
            raise ValueError(f"a calling session record with run origin {run_origin}")
        return {
            SESSION_ORIGIN_TAG_KEY: SessionOrigin.calling_session.value,
            **_calling_session_tags(attribution),
        }
    origin = (
        _SESSION_ORIGIN_BY_RUN_ORIGIN[run_origin] if run_origin is not None else None
    )
    return {SESSION_ORIGIN_TAG_KEY: origin.value} if origin is not None else {}


def _trigger_attribution_tags(
    attribution: SessionTriggerAttribution,
) -> Dict[str, str]:
    return {
        SESSION_TRIGGER_ID_TAG_KEY: str(attribution.configuration_id),
        SESSION_TRIGGER_KIND_TAG_KEY: attribution.kind.value,
        SESSION_TRIGGER_DELIVERY_ID_TAG_KEY: str(attribution.delivery_id),
    }


def _calling_session_tags(
    calling_session: SessionCallingSession,
) -> Dict[str, str]:
    return {
        SESSION_CALLING_SESSION_ID_TAG_KEY: calling_session.id,
        SESSION_CALLING_SESSION_TURN_ID_TAG_KEY: calling_session.turn_id,
        SESSION_CALLING_SESSION_AGENT_ID_TAG_KEY: str(calling_session.agent_id),
        SESSION_CALLING_SESSION_REVISION_ID_TAG_KEY: str(calling_session.revision_id),
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
        # No stamp at all reads as `manual`: a person's session, or one created before
        # its origin was recorded. Nothing ever stamps "manual" (P1-1).
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


def decode_calling_session(
    tags: Optional[Dict[str, Any]],
) -> Optional[SessionCallingSession]:
    """The calling session record, or None when the row has none or a broken one."""
    tags = tags if isinstance(tags, dict) else {}
    if SESSION_CALLING_SESSION_ID_TAG_KEY not in tags:
        return None
    try:
        return SessionCallingSession(
            id=tags.get(SESSION_CALLING_SESSION_ID_TAG_KEY),
            turn_id=tags.get(SESSION_CALLING_SESSION_TURN_ID_TAG_KEY),
            agent_id=tags.get(SESSION_CALLING_SESSION_AGENT_ID_TAG_KEY),
            revision_id=tags.get(SESSION_CALLING_SESSION_REVISION_ID_TAG_KEY),
        )
    except ValidationError:
        return None


def encode_name_state(
    *,
    tags: Optional[Dict[str, Any]],
    name_source: Optional[SessionNameSource],
    name: Optional[str],
    current_name: Optional[str] = None,
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
    if name is None:
        return tags
    current = dict(tags) if isinstance(tags, dict) else {}
    # The revision counts name CHANGES, from either source, so it is the one value that
    # separates two visits to the same name.
    if name != current_name:
        current[SESSION_NAME_REVISION_TAG_KEY] = decode_name_revision(tags) + 1
    if name_source is SessionNameSource.manual:
        if name:
            current[SESSION_NAME_SOURCE_TAG_KEY] = SessionNameSource.manual.value
        else:
            current.pop(SESSION_NAME_SOURCE_TAG_KEY, None)
    return current or None


def decode_name_revision(tags: Optional[Dict[str, Any]]) -> int:
    """The row's name revision, or 0 for a row written before the counter existed.

    0 is a real answer, not a missing one: a legacy row has no revision, so no precondition
    can match it. It also cannot be protected, because it carries no source stamp either.
    """
    if not isinstance(tags, dict):
        return 0
    value = tags.get(SESSION_NAME_REVISION_TAG_KEY)
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


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
        tags=encode_name_state(
            tags={
                **(stream.tags or {}),
                **session_origin_tags(stream.run_envelope, stream.calling_session),
            }
            or None,
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
        visibility=stream.access.visibility.value,
        owner_user_id=stream.access.owner_user_id,
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
        calling_session=decode_calling_session(stream_dbe.tags),
        # NULL is a row written by pre-sharing code: project-visible until assigned.
        visibility=Visibility(stream_dbe.visibility)
        if stream_dbe.visibility
        else Visibility.PROJECT,
        owner_user_id=stream_dbe.owner_user_id,
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
        stream_dbe.tags = encode_name_state(
            tags=stream_dbe.tags,
            name_source=name_source,
            name=header.name,
            current_name=stream_dbe.name,
        )
        stream_dbe.name = header.name
    if header.description is not None:
        stream_dbe.description = header.description
