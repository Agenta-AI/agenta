import math

from pydantic import BaseModel, ConfigDict, field_validator


class MintPolicy(BaseModel):
    """Mint policy: velocity caps, domain classification, eligibility rules, and
    the money values (grant, per-key limits). Everything ships via the PostHog
    policy flag payload (env fields can override single fields) so no real value
    lives in source; an unresolved or invalid policy means no seeding. Unknown
    payload fields are rejected so a malformed rollout fails closed instead of
    half-applying."""

    model_config = ConfigDict(extra="forbid")

    global_daily: int
    global_hourly: int
    work_domain_daily: int
    freemail_domains: list[str]
    block_digit_locals: bool
    grant_usd: float
    key_max_parallel_requests: int
    key_rpm_limit: int
    key_tpm_limit: int

    @field_validator("freemail_domains")
    @classmethod
    def _normalize_domains(cls, domains: list[str]) -> list[str]:
        return [domain.strip().lower() for domain in domains if domain.strip()]

    @field_validator("grant_usd")
    @classmethod
    def _finite_positive_grant(cls, value: float) -> float:
        if not math.isfinite(value) or value <= 0:
            raise ValueError("grant_usd must be a finite positive number")
        return value

    @field_validator(
        "global_daily",
        "global_hourly",
        "work_domain_daily",
        "key_max_parallel_requests",
        "key_rpm_limit",
        "key_tpm_limit",
    )
    @classmethod
    def _positive_ints(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("policy limits must be positive")
        return value

    def is_freemail(self, domain: str) -> bool:
        return domain.lower() in self.freemail_domains


class StarterCreditsBridgeError(Exception):
    """Base exception for starter-credits-bridge errors."""


class ProxyRequestError(StarterCreditsBridgeError):
    """The proxy admin API refused or failed a request.

    Never carries key material; `detail` is a short, log-safe diagnosis.
    """

    def __init__(self, *, status_code: int | None, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"proxy request failed ({status_code}): {detail}")


class KeyAliasExistsError(ProxyRequestError):
    """A key with this alias was already minted (idempotency signal)."""


class MintedKey(BaseModel):
    key: str
    key_alias: str
