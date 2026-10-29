"""Gateway policy DTOs.

Principal-adjacent shapes shared by both planes: what the resolver is asked for, what
policy decides, and what audit records.
"""

from enum import Enum
from typing import Optional, Union
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.access.permissions.types import Permission
from oss.src.core.gateways.dtos import GatewayEndpointNamespace

# One owner type for the vault and both gateway planes (CONTRACT section 8). `SecretOwner`
# is whose stored secret answered the lookup; audit cannot reconstruct it later, which is
# why it travels with the secret (`secrets.md`).
from oss.src.core.secrets.dtos import SecretOwner, SecretResponseDTO
from oss.src.core.secrets.enums import SecretOwnerKind


class GatewayPlane(str, Enum):
    LLM = "llm"
    MCP = "mcp"


class SecretOrigin(str, Enum):
    """Whose money the call spends — the payer. `vault` is the customer's own
    secret; `local` is platform-funded. Vocabulary fixed by `secrets.md`;
    coordinate values with the parallel bring-your-own-secrets work, which uses
    the same axis to zero-rate customer-funded usage."""

    VAULT = "vault"
    LOCAL = "local"


# --- what the resolver is asked for ---------------------------------------- #


class ProviderKeyRef(BaseModel):
    """A built-in LLM endpoint resolved by provider key."""

    provider_key: str


class BoundSecretRef(BaseModel):
    """A custom endpoint: the row already names its secret (§2.1).

    `owner_kind` says whose row the id names. A project reference keeps the project-scoped
    read by id; an organization reference answers only an organization row available to the
    project. Neither ever substitutes another row (M5)."""

    secret_id: UUID
    owner_kind: SecretOwnerKind = SecretOwnerKind.PROJECT


SecretRef = Union[ProviderKeyRef, BoundSecretRef]


class ResolvedSecret(BaseModel):
    """The (secret, owner, payer) triple (`secrets.md`). Never serialized
    outward: it exists between the resolver and an adapter, in process, and no
    wire model embeds it."""

    secret: SecretResponseDTO  # decrypted, from VaultService
    owner: Optional[
        SecretOwner
    ]  # None for the platform's own credential, which no one owns
    origin: SecretOrigin


# --- what policy decides, and what audit records ---------------------------- #


class GatewayTarget(BaseModel):
    """The plane-neutral description of what a call is trying to reach."""

    plane: GatewayPlane
    namespace: GatewayEndpointNamespace
    name: str  # last path component: a slug, a provider key, or a connection slug
    #
    provider: Optional[str] = None  # MCP built-in provider segment.
    integration: Optional[str] = None  # MCP built-in integration segment.
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
    both; recorded from day one even while nothing is charged (`policy.md`).

    One field per distinct price, not per provider spelling: `input_tokens` is fresh
    input only, and the cached slices are carried apart because they are priced apart
    and cannot be split again later. `input_tokens + cache_read_tokens +
    cache_write_tokens` is the prompt. None means the upstream did not say, never zero."""

    calls: int = 1
    input_tokens: Optional[int] = None
    cache_read_tokens: Optional[int] = None
    cache_write_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cost: Optional[float] = None


class SpendAdmission(BaseModel):
    """The spend answer, asked before a platform-funded call is dispatched. Distinct from
    `PolicyDecision`, which answers the permission question.

    `ceiling_musd` is carried and never enforced: nothing sets it today, and nothing may
    read it as a budget (wallets open-design item 17)."""

    allowed: bool
    # Set when refused: a stable code the caller can act on, and the sentence for the
    # person who sent the call.
    reason: Optional[str] = None
    message: Optional[str] = None
    ceiling_musd: Optional[int] = None


class GatewayOutcome(BaseModel):
    """How the call ended, for the audit event (§2.7)."""

    status_code: Optional[int] = None
    # Wall-clock milliseconds the gateway spent on this call, measured from the moment
    # the relay was entered — so it covers target resolution, the authorization check and
    # the credential read as well as the upstream round trip, which is the whole of what
    # the gateway is answerable for. Recorded on every ending, including a denial and an
    # upstream failure, because the slow endings are the ones worth having a number for.
    duration_ms: Optional[int] = None
    #
    usage: Optional[GatewayUsage] = None
    owner: Optional[SecretOwner] = None  # None when no secret was resolved
    origin: Optional[SecretOrigin] = None
