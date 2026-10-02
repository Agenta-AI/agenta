"""Per-organization rollout switches for the LLM gateway and the wallet.

Two PostHog flags carry the rollout, and each environment switch stays the master:

- `llm-gateway-rollout`: a JSON list of organization ids. With `AGENTA_LLM_GATEWAY_ENABLED`
  on, only these organizations are served by the LLM gateway; every other one is refused
  with `llm_gateway_disabled`, which the agent SDK reads as "resolve from the vault".
- `wallets-rollout`: a JSON object mapping organization id to `off`, `shadow` or `enforce`.
  With `AGENTA_WALLETS_ENABLED` on, an organization absent from it is `off`.

A deployment that supplied no PostHog key of its own (`env.posthog.api_key_configured`) has
no way to publish either flag, so there the environment switches alone decide: the gateway
serves every organization and the wallet enforces for every organization.

PostHog unreachable, slow, or a malformed payload is fail-safe, not fail-closed: the gateway
is off and the wallet is off for everyone, logged, until a later lookup succeeds. The client
answers an unreachable PostHog with no payload rather than an error, so "no payload" and
"unreachable" are the same answer here.
"""

import asyncio
import json
from enum import Enum
from typing import Any, Dict, Optional, Set
from uuid import UUID

from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.env import env
from oss.src.utils.lazy import _load_posthog
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

LLM_GATEWAY_ROLLOUT_FLAG = "llm-gateway-rollout"
WALLETS_ROLLOUT_FLAG = "wallets-rollout"

# How long a payload, or a failed lookup, is reused before PostHog is asked again. It bounds
# how long a payload edit takes to apply, and how often an unreachable PostHog is retried.
ROLLOUT_CACHE_TTL_SECONDS = 60

# Below the 2s bound the wallet admission points put around their whole answer, so a slow
# PostHog reads as "switch off" instead of timing out the admission that asked.
ROLLOUT_LOOKUP_TIMEOUT_SECONDS = 1.5

# The flags are rolled out to everyone; the payload, not the targeting, carries the rollout.
_DISTINCT_ID = "agenta-rollout"


class WalletMode(str, Enum):
    OFF = "off"
    SHADOW = "shadow"
    ENFORCE = "enforce"


async def llm_gateway_enabled_for(organization_id: UUID) -> bool:
    if not env.llm_gateway.enabled:
        return False
    if not env.posthog.api_key_configured:
        return True
    payload = await _flag_payload(LLM_GATEWAY_ROLLOUT_FLAG)
    return str(organization_id) in _parse_organization_ids(payload)


async def wallet_mode_for(organization_id: UUID) -> WalletMode:
    if not env.wallets.enabled:
        return WalletMode.OFF
    if not env.posthog.api_key_configured:
        return WalletMode.ENFORCE
    payload = await _flag_payload(WALLETS_ROLLOUT_FLAG)
    return _parse_wallet_modes(payload).get(str(organization_id), WalletMode.OFF)


async def _flag_payload(flag: str) -> Optional[Any]:
    """The flag's raw payload, from the shared `posthog:flags` cache when fresh.

    A failed lookup is cached as "no payload" too, so an unreachable PostHog costs one
    request per TTL rather than one per gateway call.
    """
    cache_key = {"ff": flag, "kind": "payload"}
    cached = await get_cache(namespace="posthog:flags", key=cache_key, retry=False)
    if isinstance(cached, dict):
        return cached.get("payload")

    payload: Optional[Any] = None
    posthog = _load_posthog()
    if posthog is None:
        log.warning(
            "[rollout] PostHog unavailable; rollout switch off", feature_flag=flag
        )
    else:
        try:
            # The client call is blocking HTTP; keep it off the event loop.
            payload = await asyncio.wait_for(
                asyncio.to_thread(posthog.get_feature_flag_payload, flag, _DISTINCT_ID),
                timeout=ROLLOUT_LOOKUP_TIMEOUT_SECONDS,
            )
        except Exception as exc:  # noqa: BLE001 - any failure reads as "switch off"
            log.warning(
                "[rollout] PostHog lookup failed; rollout switch off",
                feature_flag=flag,
                reason=repr(exc),
            )
        else:
            if payload is None:
                log.warning(
                    "[rollout] no payload from PostHog; rollout switch off",
                    feature_flag=flag,
                )

    await set_cache(
        namespace="posthog:flags",
        key=cache_key,
        value={"payload": payload},
        ttl=ROLLOUT_CACHE_TTL_SECONDS,
    )
    return payload


def _decode(payload: Any) -> Any:
    # PostHog returns a JSON payload either decoded or as its JSON text, by client version.
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except ValueError:
            return payload
    return payload


def _parse_organization_ids(payload: Any) -> Set[str]:
    payload = _decode(payload)
    if payload is None:
        return set()
    if not isinstance(payload, list):
        log.error(
            "[rollout] malformed payload; expected a list of organization ids",
            feature_flag=LLM_GATEWAY_ROLLOUT_FLAG,
        )
        return set()
    ids = set()
    for value in payload:
        organization_id = _normalize_id(value)
        if organization_id is None:
            log.error(
                "[rollout] ignoring an entry that is not an organization id",
                feature_flag=LLM_GATEWAY_ROLLOUT_FLAG,
                entry=str(value)[:64],
            )
            continue
        ids.add(organization_id)
    return ids


def _parse_wallet_modes(payload: Any) -> Dict[str, WalletMode]:
    payload = _decode(payload)
    if payload is None:
        return {}
    if not isinstance(payload, dict):
        log.error(
            "[rollout] malformed payload; expected organization id to mode",
            feature_flag=WALLETS_ROLLOUT_FLAG,
        )
        return {}
    modes: Dict[str, WalletMode] = {}
    for key, value in payload.items():
        organization_id = _normalize_id(key)
        try:
            mode = WalletMode(str(value).strip().lower())
        except ValueError:
            mode = None
        if organization_id is None or mode is None:
            # The entry is dropped, so that organization reads as `off`.
            log.error(
                "[rollout] ignoring a malformed entry",
                feature_flag=WALLETS_ROLLOUT_FLAG,
                entry=f"{str(key)[:64]}={str(value)[:16]}",
            )
            continue
        modes[organization_id] = mode
    return modes


def _normalize_id(value: Any) -> Optional[str]:
    try:
        return str(UUID(str(value).strip()))
    except ValueError:
        return None
