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

PostHog unreachable, slow, or a malformed payload never turns a switch that a process
already read off. Each process serves the last payload it read at once, of any age, and
refreshes it in the background once it is older than `ROLLOUT_CACHE_TTL_SECONDS`; a refresh
that fails keeps it and is logged. Only a process that has never read a payload waits, at
most `ROLLOUT_FIRST_LOOKUP_TIMEOUT_SECONDS`, and then reads "off" (the gateway off and the
wallet off) until a lookup succeeds. The API fetches both payloads at startup, so that wait
is rare. The client answers an unreachable PostHog with no payload rather than an error, so
"no payload" and "unreachable" are the same answer here: to turn an organization off, edit
the payload, do not delete the flag.
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
# `posthog:flags` cache. A payload edit applies within about two of these on a busy process;
# an idle process applies it on its first call after the edit plus one refresh.
ROLLOUT_CACHE_TTL_SECONDS = 30

# How long a caller waits when this process has never read a payload for the flag. Inside
# the 2s bound each wallet admission point puts around its answer.
ROLLOUT_FIRST_LOOKUP_TIMEOUT_SECONDS = 1.5

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


def prefetch_rollout_flags() -> None:
    """Start reading both payloads at process startup, so a first call rarely waits."""
    if env.rollout.enabled:
        for flag in (LLM_GATEWAY_ROLLOUT_FLAG, WALLETS_ROLLOUT_FLAG):
            _start_refresh(flag)


# flag -> (monotonic time of the last refresh, the last payload a refresh returned), and
# the one refresh in flight per flag.
_payloads: Dict[str, Tuple[float, Any]] = {}
_refreshes: Dict[str, "asyncio.Future[Any]"] = {}


async def _flag_payload(flag: str, *, wait: bool = True) -> Optional[Any]:
    """The flag's raw payload, without a PostHog round trip on the request path.

    The last payload this process read is returned at once, whatever its age; one shared
    refresh runs in the background once it is older than the TTL. Only a process that has
    never read one waits, and only when the caller can (`wait=False` reads it as None).
    """
    cached = _payloads.get(flag)
    if cached is not None:
        if time.monotonic() - cached[0] >= ROLLOUT_CACHE_TTL_SECONDS:
            _start_refresh(flag)
        return cached[1]

    refresh = _start_refresh(flag)
    if not wait:
        return None
    try:
        # Shielded: a caller that gives up must not cancel the refresh other callers share.
        return await asyncio.wait_for(
            asyncio.shield(refresh), timeout=ROLLOUT_FIRST_LOOKUP_TIMEOUT_SECONDS
        )
    except Exception as exc:  # noqa: BLE001 - a first lookup not answered reads as "off"
        log.warning(
            "[rollout] no payload read yet; rollout switch off for this call",
            feature_flag=flag,
            reason=repr(exc),
        )
        return None


def _start_refresh(flag: str) -> "asyncio.Future[Any]":
    refresh = _refreshes.get(flag)
    if refresh is None:
        refresh = asyncio.ensure_future(_refresh(flag))
        _refreshes[flag] = refresh
        refresh.add_done_callback(lambda _: _refreshes.pop(flag, None))
    return refresh


async def _refresh(flag: str) -> Optional[Any]:
    """Read the payload from the shared cache, else from PostHog, and keep it here.

    A failure keeps the last payload and still restarts the TTL, so an unreachable PostHog
    is asked once per TTL per process, not once per call.
    """
    payload: Optional[Any] = None
    try:
        payload = await _shared_payload(flag)
    except Exception as exc:  # noqa: BLE001 - logged; the last payload stands
        log.warning(
            "[rollout] PostHog lookup failed", feature_flag=flag, reason=repr(exc)
        )
    last = _payloads.get(flag)
    if payload is None and last is not None and last[1] is not None:
        log.warning(
            "[rollout] refresh returned no payload; keeping the last one",
            feature_flag=flag,
        )
        payload = last[1]
    _payloads[flag] = (time.monotonic(), payload)
    return payload


async def _shared_payload(flag: str) -> Optional[Any]:
    cache_key = {"ff": flag, "kind": "payload"}
    cached = await get_cache(namespace="posthog:flags", key=cache_key, retry=False)
    if isinstance(cached, dict):
        return cached.get("payload")

    posthog = _load_posthog()
    if posthog is None:
        log.warning("[rollout] PostHog unavailable", feature_flag=flag)
        return None
    # The client call is blocking HTTP with its own timeout; keep it off the event loop.
    payload = await asyncio.to_thread(
        posthog.get_feature_flag_payload, flag, _DISTINCT_ID
    )
    if payload is None:
        log.warning("[rollout] no payload from PostHog", feature_flag=flag)
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
