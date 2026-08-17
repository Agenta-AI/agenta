from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, model_validator

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
    manual = "manual"
    trigger = "trigger"


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
