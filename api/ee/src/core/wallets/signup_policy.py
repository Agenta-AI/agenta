"""The signup grant policy: who gets the signup grant, and how many grants a day.

The policy ships as the payload of a PostHog flag. It holds the velocity caps, the email
domain classification and the email eligibility rules. An unresolved or invalid policy
means no signup grant (fail closed). The one exception is a deployment with no PostHog
of its own, which runs on `DEVELOPMENT_POLICY_VALUES`.
"""

import asyncio
import json
import math
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from pydantic import BaseModel, ConfigDict, field_validator

from oss.src.dbs.redis.shared.engine import get_cache_engine
from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.env import env
from oss.src.utils.lazy import _load_posthog
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


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

# Plus-tags (`jane+1@gmail.com`) are one inbox and many grant-eligible strings.
# Internal testers who need a plus tag use this domain.
PLUS_ALIAS_ALLOWLIST_DOMAINS: tuple[str, ...] = ("agenta.ai",)


class MintPolicy(BaseModel):
    """Mint policy: velocity caps, domain classification, eligibility rules, and
    the money values. Everything ships via the PostHog policy flag payload so no real
    value lives in source; an unresolved or invalid policy means no signup grant.
    Unknown payload fields are rejected so a malformed rollout fails closed instead of
    half-applying. The one exception is a deployment with no PostHog at all, which gets
    DEVELOPMENT_POLICY_VALUES below.

    `grant_usd` and the `key_*` limits sized the retired starter-credits keys. Nothing
    reads them now, but the live payload still carries them and `extra="forbid"` would
    refuse that payload without them, so they stay required.
    """

    # `validate_default` so an absent `freemail_domains` still picks up the built-in
    # defaults through the validator below.
    model_config = ConfigDict(extra="forbid", validate_default=True)

    global_daily: int
    global_hourly: int
    work_domain_daily: int
    freemail_domains: list[str] = []
    block_digit_locals: bool
    # Throwaway mail domains. A signup on one of them, or on a subdomain, is refused.
    disposable_domains: list[str] = []
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

    @field_validator("disposable_domains")
    @classmethod
    def _normalize_disposable_domains(cls, domains: list[str]) -> list[str]:
        return sorted({domain.strip().lower() for domain in domains if domain.strip()})

    def is_freemail(self, domain: str) -> bool:
        return domain.lower() in self.freemail_domains

    def is_disposable(self, domain: str) -> bool:
        domain = domain.lower()
        return any(
            domain == listed or domain.endswith(f".{listed}")
            for listed in self.disposable_domains
        )


# What a deployment with no PostHog runs on: local development and live QA, which
# would otherwise be blocked by the fail-closed rule with no way to unblock them.
# The numbers are deliberately generic — a small grant and caps loose enough not to
# get in the way of testing — so they say nothing about the real program, whose
# values live only in the PostHog payload. A deployment that HAS PostHog never
# reaches these: a missing or malformed payload there still fails closed.
DEVELOPMENT_POLICY_VALUES: dict = {
    "global_daily": 1000,
    "global_hourly": 1000,
    "work_domain_daily": 1000,
    "freemail_domains": [],
    "block_digit_locals": False,
    "grant_usd": 5.0,
    "key_max_parallel_requests": 2,
    "key_rpm_limit": 30,
    "key_tpm_limit": 1_000_000,
}


# Redis key prefix of the velocity counters.
SIGNUP_GRANT_COUNTER_PREFIX = "free_credits:signup_grants"

# The cache namespace and the PostHog distinct id come from the retired starter-credits
# program. The namespace is kept so a policy cached before an upgrade still covers a
# PostHog outage after it. The distinct id is kept so the flag's release conditions
# still match.
_POLICY_CACHE_NAMESPACE = "starter_credits_bridge:policy"
_POLICY_DISTINCT_ID = "starter-credits-bridge"

_VELOCITY_COUNTER_TTL_SECONDS = 2 * 24 * 3600

# asyncio only weak-refs scheduled tasks; hold strong refs until each finishes.
_background_tasks: set[asyncio.Task] = set()


# The development-policy notice is worth seeing, and worth seeing once: it would
# otherwise repeat on every signup for the whole life of a dev process.
_development_policy_announced = False


def _development_policy() -> MintPolicy:
    """The policy a deployment without PostHog runs on."""
    global _development_policy_announced

    if not _development_policy_announced:
        _development_policy_announced = True
        log.warning(
            "signup grant policy: PostHog not configured, using the built-in development policy"
        )

    return MintPolicy(**DEVELOPMENT_POLICY_VALUES)


async def resolve_mint_policy() -> Optional[MintPolicy]:
    """Resolve the mint policy. Live-first; a MALFORMED live payload fails
    closed with an alert (a bad rollout must never silently keep old caps via
    the cache) — only a transport failure may fall back to the Redis-cached
    payload. The payload is the only source of policy values, except on a
    deployment that configured no PostHog of its own, which runs on the built-in
    development policy. No resolvable policy means no signup grant."""
    flag = env.signup_grant_policy.policy_flag
    # Deliberately global: the mint policy is one program-wide payload (caps, domain
    # rules), identical for every organization.
    cache_key = {"ff": flag}

    # Deliberately NOT `env.posthog.enabled`: the PostHog config falls back to a
    # built-in project key, so `enabled` is true in every checkout and could never
    # tell a local stack from a deployment that runs its own PostHog. A deployment
    # that supplied no key of its own has no way to publish a policy, so failing
    # closed would simply block it; one that did keeps failing closed below on a
    # missing or malformed payload, which is what protects production.
    if not env.posthog.api_key_configured:
        return _development_policy()

    payload: Optional[dict] = None
    live_malformed = False
    posthog = _load_posthog()
    if posthog is not None:
        try:
            raw = await asyncio.to_thread(
                posthog.get_feature_flag_payload, flag, _POLICY_DISTINCT_ID
            )
        except Exception as exc:
            log.warning(
                "[wallets] live signup grant policy lookup failed; using cached value",
                reason=str(exc),
            )
        else:
            if raw is None:
                # A reachable PostHog with no payload is a real "no policy" signal:
                # nothing else can supply one, so the resolve below fails closed.
                payload = None
            else:
                payload = _parse_policy_payload(raw)
                if payload is None:
                    live_malformed = True

    if payload is None and not live_malformed:
        cached = await get_cache(
            namespace=_POLICY_CACHE_NAMESPACE,
            key=cache_key,
            retry=False,
        )
        if isinstance(cached, dict):
            payload = cached

    try:
        policy = MintPolicy(**({} if live_malformed else (payload or {})))
    except Exception:
        log.error(
            "[wallets] mint policy missing or invalid; signup grants disabled (fail closed)",
            malformed_live_payload=live_malformed,
        )
        if live_malformed:
            _send_alert_background(
                "signup grant policy: live policy payload is malformed; signup grants disabled"
            )
        return None

    if payload is not None and not live_malformed:
        await set_cache(
            namespace=_POLICY_CACHE_NAMESPACE,
            key=cache_key,
            value=payload,
        )
    return policy


def _parse_policy_payload(raw: Any) -> Optional[dict]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except ValueError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _velocity_counters(
    organization_email: str,
    policy: MintPolicy,
) -> list[tuple[str, int, int, str]]:
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    hour = datetime.now(timezone.utc).strftime("%Y%m%d%H")
    domain = _email_domain(organization_email)

    counters = [
        (
            f"{SIGNUP_GRANT_COUNTER_PREFIX}:{day}",
            policy.global_daily,
            _VELOCITY_COUNTER_TTL_SECONDS,
            "global_daily",
        ),
        (
            f"{SIGNUP_GRANT_COUNTER_PREFIX}:hour:{hour}",
            policy.global_hourly,
            2 * 3600,
            "global_hourly",
        ),
    ]
    if not policy.is_freemail(domain):
        counters.append(
            (
                f"{SIGNUP_GRANT_COUNTER_PREFIX}:{day}:domain:{domain}",
                policy.work_domain_daily,
                _VELOCITY_COUNTER_TTL_SECONDS,
                "work_domain_daily",
            )
        )
    return counters


def _email_domain(organization_email: str) -> str:
    _, _, domain = organization_email.rpartition("@")
    return domain.lower() or "unknown"


def _email_rule_refusal(organization_email: str, policy: MintPolicy) -> Optional[str]:
    """The name of the email rule that refuses the address, or None. A refusal logs
    the rule and the domain, never the address."""
    local_part, _, _ = organization_email.rpartition("@")
    domain = _email_domain(organization_email)
    rule = None

    if policy.is_disposable(domain):
        rule = "disposable_domain"
    elif "+" in local_part and domain not in PLUS_ALIAS_ALLOWLIST_DOMAINS:
        rule = "plus_local_part"
    elif (
        not policy.is_freemail(domain)
        and domain not in PLUS_ALIAS_ALLOWLIST_DOMAINS
        and policy.block_digit_locals
        and any(character.isdigit() for character in local_part)
    ):
        rule = "digit_local_part"

    if rule is not None:
        log.warning(
            "[wallets] policy refused mint; no signup grant",
            rule=rule,
            # The domain, never the address: it is what makes a refusal diagnosable
            # (which provider, which rule) without logging who signed up.
            domain=domain,
        )
    return rule


def email_rules_allow(organization_email: str, policy: MintPolicy) -> bool:
    """The mint policy's email rules alone, without the Redis counters."""
    return _email_rule_refusal(organization_email, policy) is None


async def mint_policy_refusal(
    organization_email: str,
    policy: MintPolicy,
) -> Optional[str]:
    """Apply the mint policy: eligibility rules, then Redis counters (global
    daily + hourly; per-domain daily on non-free-mail domains only). Return the
    name of the refusing rule or counter scope, or None when the mint is allowed.
    Fail closed on Redis errors: an unverifiable mint is a skipped mint."""
    domain = _email_domain(organization_email)
    rule = _email_rule_refusal(organization_email, policy)
    if rule is not None:
        return rule

    engine = get_cache_engine()
    try:
        counters = _velocity_counters(organization_email, policy)
        for counter_key, cap, ttl, scope in counters:
            count = await engine.incr(counter_key)
            if count == 1:
                await engine.expire(counter_key, ttl)
            if count > cap:
                if scope != "work_domain_daily" and await _domain_cap_reached(
                    engine, counters
                ):
                    # The global caps are checked first, so without this a domain
                    # past its own cap would be named only by the global cap.
                    scope = "work_domain_daily"
                log.warning(
                    "[wallets] velocity cap reached; no signup grant",
                    rule=scope,
                    domain=domain,
                )
                return scope
    except Exception as exc:
        log.warning(
            "[wallets] velocity counters unavailable; no signup grant (fail closed)",
            rule="velocity_counters_unavailable",
            domain=domain,
            reason=str(exc),
        )
        return "velocity_counters_unavailable"

    return None


async def _domain_cap_reached(
    engine: Any, counters: list[tuple[str, int, int, str]]
) -> bool:
    """Whether the domain's daily counter is already at its cap. It reads the counter
    and does not increment it, so a refusal by a global cap uses no domain slot."""
    for counter_key, cap, _ttl, scope in counters:
        if scope == "work_domain_daily":
            raw = await engine.get(counter_key)
            return raw is not None and int(raw) >= cap
    return False


def _send_alert_background(text: str) -> None:
    """Schedule the operator alert without blocking the caller; never raises."""
    try:
        task = asyncio.create_task(_send_alert(text))
        task.add_done_callback(_background_tasks.discard)
        _background_tasks.add(task)
    except Exception:
        log.warning(
            "[wallets] could not schedule the signup grant policy alert", exc_info=True
        )


async def _send_alert(text: str) -> None:
    """Best-effort operator alert; failures only log."""
    webhook = env.signup_grant_policy.alert_webhook
    if not webhook:
        return

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(webhook, json={"text": text})
            response.raise_for_status()
    except Exception:
        log.warning(
            "[wallets] signup grant policy alert webhook failed",
            exc_info=True,
        )
