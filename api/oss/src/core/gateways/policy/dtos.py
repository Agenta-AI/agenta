"""The policy core's DTOs (entities.md §4.2).

Principal-adjacent shapes shared by both planes: what the resolver is asked for, what
policy decides, and what audit records.
"""

from enum import Enum
from typing import Optional, Union
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.secrets.dtos import SecretResponseDTO


class GatewayPlane(str, Enum):
    LLM = "llm"
    MCP = "mcp"


class SecretMode(str, Enum):
    """Declared per resolution site, not per call (`secrets.md`)."""

    USER_OPTIONAL = "user_optional"  # the user's if present, else the project's
    USER_REQUIRED = "user_required"  # the user's, or fail — never fall back
    PROJECT_ONLY = "project_only"  # always the project's; ignore user secrets


class SecretOwnerKind(str, Enum):
    PROJECT = "project"
    USER = "user"


class SecretOwner(BaseModel):
    """Whose stored secret answered the lookup. Audit cannot reconstruct this
    later, which is why it travels with the secret (`secrets.md`)."""

    kind: SecretOwnerKind
    user_id: Optional[UUID] = None  # set exactly when kind is USER


class SecretOrigin(str, Enum):
    """Whose money the call spends — the payer. `vault` is the customer's own
    secret; `local` is platform-funded. Vocabulary fixed by `secrets.md`;
    coordinate values with the parallel bring-your-own-secrets work, which uses
    the same axis to zero-rate customer-funded usage."""

    VAULT = "vault"
    LOCAL = "local"


# --- what the resolver is asked for ---------------------------------------- #


class ProviderKeyRef(BaseModel):
    """A builtin LLM endpoint — the standard-provider set (D27): find the
    provider_key secret for this provider."""

    provider_key: str


class BoundSecretRef(BaseModel):
    """A custom endpoint: the row already names its secret (§2.1)."""

    secret_id: UUID


SecretRef = Union[ProviderKeyRef, BoundSecretRef]


class ResolvedSecret(BaseModel):
    """The (secret, owner, payer) triple (`secrets.md`). Never serialized
    outward: it exists between the resolver and an adapter, in process, and no
    wire model embeds it."""

    secret: SecretResponseDTO  # decrypted, from VaultService
    owner: SecretOwner
    origin: SecretOrigin


# --- what policy decides, and what audit records ---------------------------- #


class GatewayTarget(BaseModel):
    """The plane-neutral description of what a call is trying to reach."""

    plane: GatewayPlane
    namespace: GatewayEndpointNamespace
    name: str  # last path component: a slug, a provider key, or a connection slug
    #
    provider: Optional[str] = None  # MCP builtin: the broker segment (D27)
    integration: Optional[str] = None  # MCP builtin: the integration segment (D27)
    endpoint_id: Optional[UUID] = None  # set when the target is a row
    model: Optional[str] = None  # LLM plane
    method: Optional[str] = None  # MCP plane: the protocol method
    tool: Optional[str] = None  # MCP plane: the target tool, when one is named


class PolicyDecision(BaseModel):
    allowed: bool
    permission: Permission  # the subject that was checked (§9)
    reason: Optional[str] = None  # denial cause, stable and terse; None when allowed


class GatewayUsage(BaseModel):
    """What the meter needs, plane-neutral. Tokens on the LLM plane, calls on
    both; recorded from day one even while nothing is charged (`policy.md`)."""

    calls: int = 1
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cost: Optional[float] = None


class GatewayOutcome(BaseModel):
    """How the call ended, for the audit event (§2.7)."""

    status_code: Optional[int] = None
    duration_ms: Optional[int] = None
    #
    usage: Optional[GatewayUsage] = None
    owner: Optional[SecretOwner] = None  # None when no secret was resolved
    origin: Optional[SecretOrigin] = None
