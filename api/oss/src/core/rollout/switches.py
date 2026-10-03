"""Per-organization rollout switches for the LLM gateway and the wallet.

Two PostHog flags carry the rollout, and each environment switch stays the master:

- `llm-gateway-rollout`: a JSON list of organization ids. With `AGENTA_LLM_GATEWAY_ENABLED`
  on, only these organizations are served by the LLM gateway; every other one is refused
  with `llm_gateway_disabled`, which the agent SDK reads as "resolve from the vault".
- `wallets-rollout`: a JSON object mapping organization id to `off`, `shadow` or `enforce`.
  With `AGENTA_WALLETS_ENABLED` on, an organization absent from it is `off`.

The flags are read only with `AGENTA_ROLLOUT_FLAGS_ENABLED` on. Off, the default and what a
self-hosted deployment runs, the environment switches alone decide: the gateway serves every
organization and the wallet enforces for every organization.

PostHog unreachable, slow, or a malformed payload is fail-safe, not fail-closed: the gateway
is off and the wallet is off for everyone, logged, until a later lookup succeeds. The client
answers an unreachable PostHog with no payload rather than an error, so "no payload" and
"unreachable" are the same answer here. A process that read a payload keeps it through a
failed refresh for up to `ROLLOUT_MAX_STALE_SECONDS`, so a short outage does not turn the
wallet off between a call's admission and its measurement and drop a charge already spent.
"""

import asyncio
import json
import time
from enum import Enum
from typing import Any, Dict, Optional, Set, Tuple
from uuid import UUID

from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.env import env
from oss.src.utils.lazy import _load_posthog
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

LLM_GATEWAY_ROLLOUT_FLAG = "llm-gateway-rollout"
WALLETS_ROLLOUT_FLAG = "wallets-rollout"

# How long a payload is used before it is refreshed, in this process and in the shared
# `posthog:flags` cache. A payload edit applies within about two of these.
ROLLOUT_CACHE_TTL_SECONDS = 30

# The oldest payload still served while a refresh runs. A process that saw no traffic for
# longer waits for the refresh like a new process does, so an idle process does not apply
# a payload edited long ago.
ROLLOUT_MAX_STALE_SECONDS = 300

# How long a caller waits when this process holds no payload yet (its first lookup per
# flag). Short enough that the lookup plus a 1s shadow wallet check stays inside the 2s
# bound each wallet admission point puts around its answer.
ROLLOUT_LOOKUP_TIMEOUT_SECONDS = 0.5

# The flags are rolled out to everyone; the payload, not the targeting, carries the rollout.
_DISTINCT_ID = "agenta-rollout"


class WalletMode(str, Enum):
    OFF = "off"
    SHADOW = "shadow"
    ENFORCE = "enforce"


async def llm_gateway_enabled_for(organization_id: UUID) -> bool:
    if not env.llm_gateway.enabled:
        return False
    if not env.rollout.enabled:
        return True
    payload = await _flag_payload(LLM_GATEWAY_ROLLOUT_FLAG)
    return str(organization_id) in _parse_organization_ids(payload)


async def wallet_mode_for(organization_id: UUID, *, wait: bool = True) -> WalletMode:
    """`wait=False` never waits for a refresh and accepts a payload of any age: for a
    measurement inside a tight bound, after an admission that already read the payload."""
    if not env.wallets.enabled:
        return WalletMode.OFF
    if not env.rollout.enabled:
        return WalletMode.ENFORCE
    payload = await _flag_payload(WALLETS_ROLLOUT_FLAG, wait=wait)
    return _parse_wallet_modes(payload).get(str(organization_id), WalletMode.OFF)


# flag -> (monotonic time fetched, payload), and the one refresh in flight per flag.
_payloads: Dict[str, Tuple[float, Any]] = {}
# flag -> (monotonic time fetched, payload) of the last refresh that returned a payload.
_last_payloads: Dict[str, Tuple[float, Any]] = {}
_refreshes: Dict[str, "asyncio.Future[Any]"] = {}


async def _flag_payload(flag: str, *, wait: bool = True) -> Optional[Any]:
    """The flag's raw payload, without a PostHog round trip on the request path.

    A fresh payload is returned as is. A stale one is returned too, while one shared
    refresh runs in the background; the request path waits only when this process has no
    usable payload, and then at most `ROLLOUT_LOOKUP_TIMEOUT_SECONDS`. The admission that
    precedes a measurement therefore always leaves a payload behind for it to read.
    """
    cached = _payloads.get(flag)
    age = time.monotonic() - cached[0] if cached else None
    if cached and age < ROLLOUT_CACHE_TTL_SECONDS:
        return cached[1]

    refresh = _refreshes.get(flag)
    if refresh is None:
        refresh = asyncio.ensure_future(_refresh(flag))
        _refreshes[flag] = refresh
        refresh.add_done_callback(lambda _: _refreshes.pop(flag, None))

    if cached and (age < ROLLOUT_MAX_STALE_SECONDS or not wait):
        return cached[1]
    if not wait:
        return None
    try:
        # Shielded: a caller that gives up must not cancel the refresh other callers share.
        return await asyncio.wait_for(
            asyncio.shield(refresh), timeout=ROLLOUT_LOOKUP_TIMEOUT_SECONDS
        )
    except Exception as exc:  # noqa: BLE001 - a lookup not answered in time reads as "off"
        log.warning(
            "[rollout] payload not ready; rollout switch off for this call",
            feature_flag=flag,
            reason=repr(exc),
        )
        # Keep that "off" as a stale answer until the refresh lands, so the measurement
        # after this admission reads it at once instead of waiting inside its own bound.
        if _payloads.get(flag) is cached:
            _payloads[flag] = (time.monotonic() - ROLLOUT_CACHE_TTL_SECONDS, None)
        return None


async def _refresh(flag: str) -> Optional[Any]:
    """Read the payload from the shared cache, else from PostHog, and keep it here.

    Any failure keeps the last payload while it is younger than the stale limit, else "no
    payload", so an unreachable PostHog is asked once per TTL per process, not once per call.
    """
    payload: Optional[Any] = None
    try:
        payload = await _shared_payload(flag)
    except Exception as exc:  # noqa: BLE001 - any failure reads as "switch off"
        log.warning(
            "[rollout] PostHog lookup failed; rollout switch off",
            feature_flag=flag,
            reason=repr(exc),
        )
    now = time.monotonic()
    if payload is not None:
        _last_payloads[flag] = (now, payload)
    else:
        last = _last_payloads.get(flag)
        if last is not None and now - last[0] < ROLLOUT_MAX_STALE_SECONDS:
            log.warning(
                "[rollout] refresh returned no payload; keeping the last one",
                feature_flag=flag,
            )
            payload = last[1]
    _payloads[flag] = (now, payload)
    return payload


async def _shared_payload(flag: str) -> Optional[Any]:
    cache_key = {"ff": flag, "kind": "payload"}
    cached = await get_cache(namespace="posthog:flags", key=cache_key, retry=False)
    if isinstance(cached, dict):
        return cached.get("payload")

    posthog = _load_posthog()
    if posthog is None:
        log.warning(
            "[rollout] PostHog unavailable; rollout switch off", feature_flag=flag
        )
        return None
    # The client call is blocking HTTP with its own timeout; keep it off the event loop.
    payload = await asyncio.to_thread(
        posthog.get_feature_flag_payload, flag, _DISTINCT_ID
    )
    if payload is None:
        log.warning(
            "[rollout] no payload from PostHog; rollout switch off", feature_flag=flag
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
