from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class CredentialStatus(str, Enum):
    """Did the provider accept this credential?

    `unknown` is an honest answer, not a failure: it means Agenta found no free,
    read-only endpoint that proves the credential works. A public catalog endpoint
    answering successfully never raises the status above `unknown`.
    """

    VALID = "valid"
    INVALID = "invalid"
    UNKNOWN = "unknown"


class DiscoveryStatus(str, Enum):
    """Which model identifiers did the provider return?

    `unsupported` means the provider offers no model-list endpoint; `failed` means one
    exists but this attempt did not get an answer. Either way the caller keeps the
    shipped catalog rather than narrowing the user's model choice.
    """

    FETCHED = "fetched"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"


class ProviderCredentials(BaseModel):
    """Credentials in transit only. Never persisted here, never logged, never echoed."""

    key: Optional[str] = None
    url: Optional[str] = None
    version: Optional[str] = None
    extras: Optional[Dict[str, Any]] = None


class CredentialResult(BaseModel):
    status: CredentialStatus
    message: str


class DiscoveryResult(BaseModel):
    status: DiscoveryStatus
    models: List[str] = Field(default_factory=list)


class ProbeOutcome(BaseModel):
    """What one adapter concluded, before the service timestamps it."""

    credential: CredentialResult
    discovery: DiscoveryResult


class ProviderProbeResult(BaseModel):
    credential: CredentialResult
    discovery: DiscoveryResult
    fetched_at: datetime
