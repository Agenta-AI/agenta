"""The `fraud-check` PostHog flag payload, read the same way the auth helper reads the
`blocked-domains` payload: live lookup, cached under the `posthog:flags` namespace."""

import asyncio
import json
import math
from typing import Any, Optional

from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.lazy import _load_posthog
from oss.src.utils.logging import get_module_logger

from ee.src.core.fraud.types import (
    FRAUD_CHECK_FLAG,
    FraudCheckConfig,
    FraudCheckMode,
)

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

# The last payload read with success, kept for a week.
_LAST_KNOWN_KEY = {"ff": FRAUD_CHECK_FLAG, "last_known": True}
_LAST_KNOWN_TTL_SECONDS = 7 * 24 * 3600


_THRESHOLD_FIELDS = ("signup_threshold", "apikey_threshold")

# The invalid fields of the last payload, so the same bad payload logs one warning and
# not one per signup or key creation.
_last_invalid_fields: tuple = ()


def _is_threshold(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and 0.0 <= value <= 1.0
    )


def _is_policy(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _drop_invalid_fields(payload: dict) -> dict:
    """The payload without an invalid `policy` or threshold, so that field takes its
    default. `mode` is left as is: an invalid mode turns the check off."""
    global _last_invalid_fields
    invalid = tuple(
        field
        for field, valid in (
            ("policy", _is_policy),
            *((name, _is_threshold) for name in _THRESHOLD_FIELDS),
        )
        if field in payload and not valid(payload[field])
    )
    if invalid and invalid != _last_invalid_fields:
        # The field names only. The policy text is never logged.
        log.warning(
            "[fraud] flag payload fields invalid; using defaults",
            feature_flag=FRAUD_CHECK_FLAG,
            fields=list(invalid),
        )
    _last_invalid_fields = invalid
    return {key: value for key, value in payload.items() if key not in invalid}


def _config_from_payload(payload: Optional[dict]) -> FraudCheckConfig:
    if payload is None:
        return FraudCheckConfig()
    try:
        return FraudCheckConfig(**_drop_invalid_fields(payload))
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
        # The PostHog client also returns None when its request fails. The last payload
        # read with success then wins over the defaults, so an outage keeps an `off`
        # check off. Only a flag never seen gives the defaults.
        last = await get_cache(
            namespace=_CACHE_NAMESPACE, key=_LAST_KNOWN_KEY, retry=False
        )
        payload = last if isinstance(last, dict) else {}
        # Cache it too, so that every signup and key creation does not ask PostHog again.
        await set_cache(namespace=_CACHE_NAMESPACE, key=cache_key, value=payload)
        return _config_from_payload(payload)

    payload = _parse_payload(raw)
    if payload is None:
        log.warning(
            "[fraud] flag payload malformed; check off",
            feature_flag=FRAUD_CHECK_FLAG,
        )
        return _FAILED

    config = _config_from_payload(payload)
    await set_cache(namespace=_CACHE_NAMESPACE, key=cache_key, value=payload)
    await set_cache(
        namespace=_CACHE_NAMESPACE,
        key=_LAST_KNOWN_KEY,
        value=payload,
        ttl=_LAST_KNOWN_TTL_SECONDS,
    )
    return config
