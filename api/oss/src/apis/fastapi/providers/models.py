from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from oss.src.core.providers.dtos import (
    CredentialResult,
    DiscoveryResult,
    ProviderCredentials,
)


class ProbeProviderRequest(BaseModel):
    """The credential to test. It is spent on one read and never persisted.

    `kind` is a StandardProviderKind or CustomProviderKind value; `provider` carries the
    same field vocabulary the vault stores, so a card can probe what it is about to save
    without reshaping it.

    `secret_id` names a connection already stored in the caller's project, and is how a
    write-only connection is testable at all: its value never comes back to the browser,
    so there is nothing for the card to send. The stored kind and credentials are the
    base; anything typed in this request replaces the stored value for that field, which
    is what lets a card test an edit — a new base URL, say — before saving it.
    """

    kind: Optional[str] = Field(
        default=None,
        description=(
            "Provider kind, e.g. 'openai', 'azure', 'custom'. Optional when `secret_id` "
            "is given: the stored kind is used unless this overrides it."
        ),
    )
    provider: ProviderCredentials = Field(default_factory=ProviderCredentials)
    secret_id: Optional[UUID] = Field(
        default=None,
        description=(
            "Test the credential stored under this secret, in the caller's project. "
            "Fields sent in `provider` override the stored ones."
        ),
    )

    @model_validator(mode="after")
    def require_something_to_probe(self):
        """A probe needs a subject: a kind to test against, or a stored secret to load."""
        if self.kind is None and self.secret_id is None:
            raise ValueError("provide `kind`, `secret_id`, or both")

        return self


class ProbeProviderResponse(BaseModel):
    credential: CredentialResult
    discovery: DiscoveryResult
    fetched_at: datetime
