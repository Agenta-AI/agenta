"""The `fraud-check` PostHog flag payload, read the same way the auth helper reads the
`blocked-domains` payload: live lookup, cached under the `posthog:flags` namespace."""

import asyncio
import json
from typing import Any, Optional

from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.lazy import _load_posthog
from oss.src.utils.logging import get_module_logger

from ee.src.core.fraud.types import FRAUD_CHECK_FLAG, FraudCheckConfig, FraudCheckMode

log = get_module_logger(__name__)

_CACHE_NAMESPACE = "posthog:flags"


def _parse_payload(raw: Any) -> Optional[dict]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except ValueError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


# A flag that exists but cannot be read or parsed turns the check off. Only a flag that
# is missing gives the defaults, so a PostHog outage or a typo in an `off` payload never
# switches enforcement on.
_FAILED = FraudCheckConfig(mode=FraudCheckMode.OFF)


def _config_from_payload(payload: Optional[dict]) -> FraudCheckConfig:
    if payload is None:
        return FraudCheckConfig()
    try:
        return FraudCheckConfig(**payload)
    except Exception as exc:
        log.warning(
            "[fraud] flag payload invalid; check off",
            feature_flag=FRAUD_CHECK_FLAG,
            reason=type(exc).__name__,
        )
        return _FAILED


async def read_fraud_check_config() -> FraudCheckConfig:
    """The current check settings. A missing or unreadable flag gives the defaults."""
    cache_key = {"ff": FRAUD_CHECK_FLAG}

    cached = await get_cache(namespace=_CACHE_NAMESPACE, key=cache_key, retry=False)
    if isinstance(cached, dict):
        return _config_from_payload(cached)

    posthog = _load_posthog()
    if posthog is None:
        log.warning(
            "[fraud] PostHog feature flag lookup skipped; using defaults",
            feature_flag=FRAUD_CHECK_FLAG,
            reason="unavailable",
        )
        return FraudCheckConfig()

    try:
        raw = await asyncio.to_thread(
            posthog.get_feature_flag_payload, FRAUD_CHECK_FLAG, "fraud-check"
        )
    except Exception as exc:
        log.warning(
            "[fraud] PostHog feature flag lookup failed; check off",
            feature_flag=FRAUD_CHECK_FLAG,
            reason=type(exc).__name__,
        )
        return _FAILED

    if raw is None:
        # The flag is missing. Cache the empty payload too, so that every signup and
        # key creation does not ask PostHog again.
        await set_cache(namespace=_CACHE_NAMESPACE, key=cache_key, value={})
        return FraudCheckConfig()

    payload = _parse_payload(raw)
    if payload is None:
        log.warning(
            "[fraud] flag payload malformed; check off",
            feature_flag=FRAUD_CHECK_FLAG,
        )
        return _FAILED

    config = _config_from_payload(payload)
    await set_cache(namespace=_CACHE_NAMESPACE, key=cache_key, value=payload)
    return config
