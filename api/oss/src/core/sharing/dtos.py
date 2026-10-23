from enum import Enum
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, model_validator


class Visibility(str, Enum):
    PRIVATE = "private"
    PROJECT = "project"


class SessionRole(str, Enum):
    VIEWER = "viewer"
    PARTICIPANT = "participant"


class AccessPolicy(BaseModel):
    visibility: Visibility
    # Explicit default: the cache serializer drops None fields (`exclude_none=True`).
    owner_user_id: Optional[UUID] = None

    @model_validator(mode="after")
    def _private_needs_an_owner(self) -> "AccessPolicy":
        if self.visibility == Visibility.PRIVATE and self.owner_user_id is None:
            raise ValueError("A private item needs an owner.")
        return self


# The policy of every ownerless item: API keys, installations, subscriptions, child and
# evaluation runs, and every channel session.
OWNERLESS_PROJECT_POLICY = AccessPolicy(
    visibility=Visibility.PROJECT, owner_user_id=None
)
