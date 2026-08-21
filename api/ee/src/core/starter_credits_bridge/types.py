from pydantic import BaseModel, field_validator


class MintPolicy(BaseModel):
    """Mint velocity/eligibility policy. The values ship via the PostHog policy
    flag payload (env fields can override single fields) so thresholds never
    live in source; an unresolved policy means no seeding."""

    global_daily: int
    global_hourly: int
    work_domain_daily: int
    freemail_domains: list[str]
    block_digit_locals: bool

    @field_validator("freemail_domains")
    @classmethod
    def _normalize_domains(cls, domains: list[str]) -> list[str]:
        return [domain.strip().lower() for domain in domains if domain.strip()]

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
