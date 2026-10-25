from datetime import datetime
from enum import Enum
from typing import Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator

from oss.src.core.access.permissions.types import Permission


class RoleRequirement(BaseModel):
    role: str  # slug; the legacy `role=...` check


Action = Union[Permission, RoleRequirement]


class DecisionReason(str, Enum):
    ROLE = "role"
    PROJECT_OWNER = "project_owner"
    ORGANIZATION_OWNER = "organization_owner"
    RBAC_NOT_ENTITLED = "rbac_not_entitled"
    NOT_MEMBER = "not_member"
    MISSING_CAPABILITY = "missing_capability"
    PRINCIPAL_INACTIVE = "principal_inactive"
    RESTRICTED_BY_AUTHORITY = "restricted_by_authority"
    # The allow reason of `check_eligibility`, which checks no capability.
    ELIGIBLE = "eligible"
    # M3 adds RESOURCE_DENIED.


class Decision(BaseModel):
    allowed: bool
    reason: DecisionReason


# -- run principal (M2) -------------------------------------------------------------
#
# One shape for token claims and the stored `run_envelope` jsonb. Every model is frozen
# and refuses unknown keys, so an older pod fails closed on a claim or a stored envelope
# that a later change extended. Every `Optional` field has a `None` default: the cache
# serializer drops `None` fields, and a required field missing on read turns every cache
# read into a miss.

_FROZEN = ConfigDict(frozen=True, extra="forbid")


class PrincipalKind(str, Enum):
    HUMAN = "human"
    API_KEY = "api_key"
    INSTALLATION = "installation"


class PrincipalRef(BaseModel):
    model_config = _FROZEN

    kind: PrincipalKind
    id: UUID  # users.id | api_keys.id | channel_agents.id


class AgentRef(BaseModel):
    model_config = _FROZEN

    id: UUID  # workflow artifact id


class RunRestrictions(BaseModel):
    model_config = _FROZEN

    # Unsupported in M2: `AccessService.decide` denies any non-null value.
    agent: Optional[AgentRef] = None


class RunAuthority(BaseModel):
    model_config = _FROZEN

    principal: PrincipalRef
    organization_id: UUID
    project_id: UUID
    restrictions: RunRestrictions = RunRestrictions()
    # Installation only: the linked channel user whose role the run uses. None: the
    # binding creator's role.
    linked_user_id: Optional[UUID] = None

    @model_validator(mode="after")
    def _linked_user_only_for_installation(self) -> "RunAuthority":
        if (
            self.linked_user_id is not None
            and self.principal.kind != PrincipalKind.INSTALLATION
        ):
            raise ValueError("linked_user_id is set only for an installation principal")
        return self


class RunOrigin(str, Enum):
    WEB = "web"
    API = "api"
    INSTALLATION = "installation"
    SCHEDULE = "schedule"
    SUBSCRIPTION = "subscription"
    EVALUATION = "evaluation"
    CHILD = "child"


class RunContext(BaseModel):
    model_config = _FROZEN

    run_id: Optional[str] = None  # runner turn id; None for web, direct-API, batch runs
    parent_run_id: Optional[str] = None
    origin: RunOrigin
    # api: key id; installation: binding id; schedule/subscription: trigger id;
    # evaluation: evaluation run id; web, child: None
    origin_id: Optional[str] = None


class RunSender(BaseModel):
    model_config = _FROZEN

    user_id: Optional[UUID] = None
    external_key: Optional[str] = None

    @model_validator(mode="after")
    def _one_field(self) -> "RunSender":
        if self.user_id is None and self.external_key is None:
            raise ValueError("a sender needs a user id or an external key")
        return self


class RunApproval(BaseModel):
    model_config = _FROZEN

    principal: PrincipalRef  # the approving principal
    user_id: Optional[UUID] = None  # acting user of the approver
    external_key: Optional[str] = None  # channel answer only


class RunEnvelope(BaseModel):
    model_config = _FROZEN

    authority: RunAuthority
    context: RunContext
    sender: Optional[RunSender] = None
    approved_by: Optional[RunApproval] = None


class RequestCredentialKind(str, Enum):
    BEARER_SESSION = "bearer_session"
    API_KEY = "api_key"
    RUN_CREDENTIAL = "run_credential"


class ResourceKind(str, Enum):
    AGENT = "agent"
    SESSION = "session"


class ResourceRef(BaseModel):
    model_config = _FROZEN

    kind: ResourceKind
    id: str  # agent: artifact id; session: session id


class PrincipalRecord(BaseModel):
    """What `PrincipalsDAO.fetch_principal` returns. Cached."""

    model_config = _FROZEN

    principal: PrincipalRef
    project_id: Optional[UUID] = None  # None for a human
    # human: itself; api_key: created_by_id; installation: channel_agents.created_by_id
    acting_user_id: Optional[UUID] = None
    is_active: bool
    expires_at: Optional[datetime] = None  # api_key: expiration_date


class RequestAccess(BaseModel):
    """The principal of the current request, set by the auth middleware."""

    model_config = _FROZEN

    principal: PrincipalRef
    authority: RunAuthority
    credential_kind: RequestCredentialKind
    acting_user_id: UUID  # == request.state.user_id
    envelope: Optional[RunEnvelope] = None  # run_credential only


class UserPrincipals(BaseModel):
    """What a user deletion must invalidate, read before the delete: the user's API
    keys, the channel bindings they created, and the projects where their membership
    can be cached (member projects and the projects of their keys)."""

    model_config = _FROZEN

    user_id: UUID
    api_key_ids: list[UUID] = []
    binding_ids: list[UUID] = []
    project_ids: list[UUID] = []


class ScopePrincipals(BaseModel):
    """What deleting organizations, workspaces or projects must invalidate, read
    before the delete: the projects that go, and the API keys and channel bindings in
    them (removed by the cascade)."""

    model_config = _FROZEN

    project_ids: list[UUID] = []
    api_key_ids: list[UUID] = []
    binding_ids: list[UUID] = []
