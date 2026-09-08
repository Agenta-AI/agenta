"""Request and response shapes for the subscription login routes."""

from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SubscriptionLoginAttemptResponse(BaseModel):
    """One device login attempt, as a browser sees it. Never carries the credential."""

    attempt_id: str
    state: str
    user_code: Optional[str] = None
    verification_uri: Optional[str] = None
    expires_at: Optional[str] = None
    poll_after_ms: Optional[int] = None
    error: Optional[str] = None


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
