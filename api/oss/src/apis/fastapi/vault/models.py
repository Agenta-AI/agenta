"""Request and response shapes of the secrets routes that take more than a secret."""

from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from oss.src.core.secrets.enums import SecretAvailability


class SecretProjectsRequest(BaseModel):
    """Which projects may use an organization connection."""

    model_config = ConfigDict(extra="forbid")

    availability: SecretAvailability
    project_ids: List[UUID] = Field(default_factory=list)


class SubscriptionTokenRequest(BaseModel):
    """A token pasted from `claude setup-token`."""

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    token: str = Field(min_length=1)


class SubscriptionLoginAttemptResponse(BaseModel):
    """One device login attempt, as a browser sees it. Never carries the credential."""

    attempt_id: str
    state: str
    user_code: Optional[str] = None
    verification_uri: Optional[str] = None
    expires_at: Optional[str] = None
    poll_after_ms: Optional[int] = None
    error: Optional[str] = None


class SubscriptionLoginOutcomeRequest(BaseModel):
    """How a device login ended, as the runner pod that ran its provider poll reports it.

    The runner holds no project credential for a device login, so the ids that scope the
    row ride the body, and the route accepts the shared runner token only.
    """

    model_config = ConfigDict(extra="forbid")

    # Exactly one owner: the project's row, or the organization's (M5).
    project_id: Optional[UUID] = None
    organization_id: Optional[UUID] = None
    secret_id: UUID
    state: Literal["succeeded", "failed", "expired"]
    # The credential, on `succeeded` only.
    login: Optional[Dict[str, Any]] = None
    # The runner's short reason word, on `failed` and `expired`. The service clips it.
    error: Optional[str] = None

    @model_validator(mode="after")
    def _one_owner(self) -> "SubscriptionLoginOutcomeRequest":
        if (self.project_id is None) == (self.organization_id is None):
            raise ValueError("name exactly one of project_id and organization_id")
        return self


class SubscriptionLoginPushRequest(BaseModel):
    """A refreshed login a run pushes back, with the lineage it was given."""

    model_config = ConfigDict(extra="forbid")

    login: Dict[str, Any]
    version: int
    generation: int

    @field_validator("login")
    @classmethod
    def login_is_not_empty(cls, value: Dict[str, Any]) -> Dict[str, Any]:
        if not value:
            raise ValueError("login cannot be empty")
        return value


class SubscriptionLoginPushResponse(BaseModel):
    """The push outcome, plus the current login when the run was on an old generation.

    Handing the login back on a stale answer is what lets the runner recover in one hop
    instead of asking for the connection again.
    """

    version: int
    generation: int
    updated: bool
    stale: bool = False
    login: Optional[Dict[str, Any]] = None
    # Why the push was not stored. `same_login` says the row already holds this exact
    # credential, so the run's own login is current and `version` describes it. Every other
    # slug says the row kept something else, so `version` describes a credential this run
    # does not hold: `invalid_login` (unusable shape), `older_login` (an earlier expiry on
    # the same lineage), `other_account` (a different ChatGPT account), `wrong_generation`
    # (a lineage this row never issued), `no_login` (the row holds none). An accepted push
    # and a stale answer carry no reason, because `updated` and `stale` already say it.
    reason: Optional[str] = None


class SubscriptionLoginFailureRequest(BaseModel):
    """A run reporting that the login it was given no longer works."""

    model_config = ConfigDict(extra="forbid")

    version: int
    generation: int
    reason: str = Field(max_length=200)


class SubscriptionLoginFailureResponse(BaseModel):
    stale: bool
    version: int
    generation: int
    login: Optional[Dict[str, Any]] = None
