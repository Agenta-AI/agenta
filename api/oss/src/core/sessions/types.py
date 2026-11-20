from enum import Enum
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator

from oss.src.core.shared.dtos import Reference


class ReferenceKey(str, Enum):
    """The workflow-family member a stored reference element points at."""

    workflow = "workflow"
    workflow_variant = "workflow_variant"
    workflow_revision = "workflow_revision"


class SessionReference(Reference):
    """A reference element that carries its own family.

    Sessions persist references as a flat list (`session_turns.references`,
    `session_streams.references`), so the map key that named the family upstream is
    gone by the time a reader sees the row — leaving "first UUID in the list" as the
    only way to guess which element is the workflow.

    ``key`` is the name `evaluation_runs.references` already uses for the same flat-list
    discriminator (`dbs/postgres/evaluations/utils.py`), and the same one tracing carries
    in `OTelReference.attributes["key"]`.

    It is a plain string rather than ``ReferenceKey`` on purpose: a turn append is
    fire-and-forget, so rejecting an unrecognized family would drop the whole turn, which
    is the failure this field exists to prevent. Producers inside the API use
    ``ReferenceKey``; readers treat anything else as untyped.
    """

    key: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _accept_plain_reference(cls, value):
        # Most producers build the shared `Reference`; pydantic rejects a parent-class
        # instance where a subclass is declared, so accept one as the untagged element it
        # is rather than making every caller change type.
        if isinstance(value, Reference):
            return value.model_dump()
        return value


class SessionOrigin(str, Enum):
    """How the session was created. Written once, with the row, and never changed.

    `manual`: a person in the app, or not recorded (every session from before the
    other values existed reads `manual`). `trigger`: an automation fire. `channel`: a
    channel installation. `api`: an API key. `calling_session`: an agent in another
    session.
    """

    manual = "manual"
    trigger = "trigger"
    channel = "channel"
    api = "api"
    calling_session = "calling_session"


class SessionTriggerKind(str, Enum):
    schedule = "schedule"
    subscription = "subscription"


class SessionTriggerAttribution(BaseModel):
    configuration_id: UUID
    kind: SessionTriggerKind
    delivery_id: UUID


class SessionTrigger(BaseModel):
    id: UUID
    kind: SessionTriggerKind
    name: Optional[str] = None


class SessionDelivery(BaseModel):
    id: UUID


class SessionCallingSession(BaseModel):
    """The session whose agent created this session: the calling session, the calling
    turn, the calling agent and its revision. Set only when the origin is
    `calling_session`."""

    id: str
    turn_id: str
    agent_id: UUID
    revision_id: UUID


class SessionCallingSessionQuery(BaseModel):
    """List filter on the calling session record. `ids` are calling session ids, not
    the listed sessions' own ids (that is `session_ids`)."""

    model_config = ConfigDict(extra="forbid")

    ids: Optional[List[str]] = None
    agent_ids: Optional[List[UUID]] = None
