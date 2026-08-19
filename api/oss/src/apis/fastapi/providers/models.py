from datetime import datetime

from pydantic import BaseModel, Field

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
    """

    kind: str = Field(description="Provider kind, e.g. 'openai', 'azure', 'custom'.")
    provider: ProviderCredentials


class ProbeProviderResponse(BaseModel):
    credential: CredentialResult
    discovery: DiscoveryResult
    fetched_at: datetime
