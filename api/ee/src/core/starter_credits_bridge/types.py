import math

from pydantic import BaseModel, ConfigDict, field_validator


# Consumer mail providers. Classification drives the per-domain daily cap, which only
# means anything on a domain one company controls: unrecognized free mail counts every
# signup from it against a single "company" and, with `block_digit_locals`, judges a
# personal address by rules meant for a work one. A plain constant rather than config
# because it tracks the mail industry, not an operator decision, and because the policy
# payload UNIONS with it (see `_normalize_domains`) — extending the list must never
# silently drop gmail.com.
DEFAULT_FREEMAIL_DOMAINS: tuple[str, ...] = (
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "yahoo.co.uk",
    "yahoo.co.in",
    "yahoo.fr",
    "yahoo.de",
    "ymail.com",
    "rocketmail.com",
    "hotmail.com",
    "hotmail.co.uk",
    "hotmail.fr",
    "hotmail.de",
    "hotmail.it",
    "outlook.com",
    "outlook.de",
    "outlook.fr",
    "outlook.es",
    "outlook.in",
    "live.com",
    "live.co.uk",
    "msn.com",
    "aol.com",
    "aim.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "proton.me",
    "protonmail.com",
    "pm.me",
    "tutanota.com",
    "tuta.com",
    "fastmail.com",
    "hey.com",
    "zoho.com",
    "mail.com",
    "gmx.com",
    "gmx.de",
    "gmx.net",
    "web.de",
    "t-online.de",
    "freenet.de",
    "orange.fr",
    "wanadoo.fr",
    "free.fr",
    "laposte.net",
    "libero.it",
    "virgilio.it",
    "seznam.cz",
    "wp.pl",
    "onet.pl",
    "interia.pl",
    "mail.ru",
    "yandex.ru",
    "yandex.com",
    "rambler.ru",
    "qq.com",
    "163.com",
    "126.com",
    "sina.com",
    "naver.com",
    "daum.net",
    "hanmail.net",
    "rediffmail.com",
    "comcast.net",
    "verizon.net",
    "att.net",
    "sbcglobal.net",
    "cox.net",
    "btinternet.com",
    "sky.com",
    "virginmedia.com",
    "bigpond.com",
    "uol.com.br",
    "bol.com.br",
)


class MintPolicy(BaseModel):
    """Mint policy: velocity caps, domain classification, eligibility rules, and
    the money values (grant, per-key limits). Everything ships via the PostHog
    policy flag payload (env fields can override single fields) so no real value
    lives in source; an unresolved or invalid policy means no seeding. Unknown
    payload fields are rejected so a malformed rollout fails closed instead of
    half-applying."""

    # `validate_default` so an absent `freemail_domains` still picks up the built-in
    # defaults through the validator below.
    model_config = ConfigDict(extra="forbid", validate_default=True)

    global_daily: int
    global_hourly: int
    work_domain_daily: int
    freemail_domains: list[str] = []
    block_digit_locals: bool
    grant_usd: float
    key_max_parallel_requests: int
    key_rpm_limit: int
    key_tpm_limit: int

    @field_validator("freemail_domains")
    @classmethod
    def _normalize_domains(cls, domains: list[str]) -> list[str]:
        """Whatever the payload names, UNIONED with the built-in defaults.

        A configured list adds providers the defaults miss; it never replaces them, so a
        rollout that names three domains cannot quietly reclassify gmail.com as a company
        domain.
        """
        configured = {domain.strip().lower() for domain in domains if domain.strip()}

        return sorted(configured | set(DEFAULT_FREEMAIL_DOMAINS))

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
