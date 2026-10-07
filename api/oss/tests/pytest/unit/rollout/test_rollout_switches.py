"""The per-organization rollout switches: the master env switches, `AGENTA_ROLLOUT_FLAGS_ENABLED`
off, payload parsing, the shared cache, and PostHog failing."""

import asyncio
import json
import time
from uuid import uuid4

import pytest

from oss.src.core.rollout import switches
from oss.src.core.rollout.switches import (
    LLM_GATEWAY_ROLLOUT_FLAG,
    WALLETS_ROLLOUT_FLAG,
    WalletMode,
    llm_gateway_enabled_for,
    wallet_mode_for,
)
from oss.src.utils.env import env

ORG = uuid4()
OTHER = uuid4()


class _PostHog:
    def __init__(self, payloads=None, *, raises=False, delay=0.0):
        self.payloads = payloads or {}
        self.raises = raises
        self.delay = delay
        self.calls = []

    def get_feature_flag_payload(self, flag, distinct_id):
        self.calls.append(flag)
        if self.delay:
            time.sleep(self.delay)
        if self.raises:
            raise ConnectionError("posthog unreachable")
        return self.payloads.get(flag)


@pytest.fixture(autouse=True)
def _fresh_process_state():
    """Each test starts as a process that has read no payload yet."""
    switches._payloads.clear()
    switches._refreshes.clear()
    yield
    switches._payloads.clear()
    switches._refreshes.clear()


async def _settle():
    """Let a background refresh finish."""
    for refresh in list(switches._refreshes.values()):
        await refresh


@pytest.fixture
def cache(monkeypatch):
    """The shared `posthog:flags` cache, in memory, recording each write's TTL."""
    store = {}

    async def _get(*, namespace, key, retry):
        return store.get((namespace, json.dumps(key, sort_keys=True)), (None,))[0]

    async def _set(*, namespace, key, value, ttl):
        store[(namespace, json.dumps(key, sort_keys=True))] = (value, ttl)

    monkeypatch.setattr(switches, "get_cache", _get)
    monkeypatch.setattr(switches, "set_cache", _set)
    return store


@pytest.fixture
def posthog(monkeypatch, cache):
    """Turn both master switches and the rollout flags on."""
    monkeypatch.setattr(env.llm_gateway, "enabled", True)
    monkeypatch.setattr(env.wallets, "enabled", True)
    monkeypatch.setattr(env.rollout, "enabled", True)

    def _install(client):
        monkeypatch.setattr(switches, "_load_posthog", lambda: client)
        return client

    return _install


# Master switches


async def test_the_env_switches_off_mean_off_whatever_the_payload(monkeypatch, posthog):
    client = posthog(
        _PostHog(
            {
                LLM_GATEWAY_ROLLOUT_FLAG: [str(ORG)],
                WALLETS_ROLLOUT_FLAG: {str(ORG): "enforce"},
            }
        )
    )
    monkeypatch.setattr(env.llm_gateway, "enabled", False)
    monkeypatch.setattr(env.wallets, "enabled", False)

    assert await llm_gateway_enabled_for(ORG) is False
    assert await wallet_mode_for(ORG) is WalletMode.OFF
    assert client.calls == []


async def test_with_rollout_flags_off_the_env_switches_decide_alone(
    monkeypatch, posthog
):
    client = posthog(_PostHog())
    monkeypatch.setattr(env.rollout, "enabled", False)

    assert await llm_gateway_enabled_for(ORG) is True
    assert await wallet_mode_for(ORG) is WalletMode.ENFORCE
    assert client.calls == []


# Payloads


async def test_only_listed_organizations_get_the_gateway(posthog):
    posthog(_PostHog({LLM_GATEWAY_ROLLOUT_FLAG: [str(ORG).upper()]}))

    assert await llm_gateway_enabled_for(ORG) is True
    assert await llm_gateway_enabled_for(OTHER) is False


async def test_each_organization_gets_its_own_wallet_mode_and_the_rest_are_off(posthog):
    third = uuid4()
    posthog(
        _PostHog(
            {
                WALLETS_ROLLOUT_FLAG: {
                    str(ORG): "shadow",
                    str(OTHER): " ENFORCE ",
                    str(third): "off",
                }
            }
        )
    )

    assert await wallet_mode_for(ORG) is WalletMode.SHADOW
    assert await wallet_mode_for(OTHER) is WalletMode.ENFORCE
    assert await wallet_mode_for(third) is WalletMode.OFF
    assert await wallet_mode_for(uuid4()) is WalletMode.OFF


@pytest.mark.parametrize("payload", [["*"], [" * ", str(ORG)], json.dumps(["*"])])
async def test_a_star_entry_gives_every_organization_the_gateway(posthog, payload):
    posthog(_PostHog({LLM_GATEWAY_ROLLOUT_FLAG: payload}))

    assert await llm_gateway_enabled_for(ORG) is True
    assert await llm_gateway_enabled_for(uuid4()) is True


async def test_a_star_key_gives_every_unlisted_organization_its_wallet_mode(posthog):
    posthog(
        _PostHog(
            {
                WALLETS_ROLLOUT_FLAG: {
                    "*": "shadow",
                    str(ORG): "enforce",
                    str(OTHER): "off",
                }
            }
        )
    )

    assert await wallet_mode_for(uuid4()) is WalletMode.SHADOW
    # A listed organization keeps its own mode, `off` included.
    assert await wallet_mode_for(ORG) is WalletMode.ENFORCE
    assert await wallet_mode_for(OTHER) is WalletMode.OFF


async def test_a_malformed_star_mode_is_dropped_and_unlisted_organizations_are_off(
    posthog,
):
    posthog(_PostHog({WALLETS_ROLLOUT_FLAG: {"*": "on", str(ORG): "shadow"}}))

    assert await wallet_mode_for(uuid4()) is WalletMode.OFF
    assert await wallet_mode_for(ORG) is WalletMode.SHADOW


async def test_a_payload_delivered_as_json_text_is_decoded(posthog):
    posthog(
        _PostHog(
            {
                LLM_GATEWAY_ROLLOUT_FLAG: json.dumps([str(ORG)]),
                WALLETS_ROLLOUT_FLAG: json.dumps({str(ORG): "shadow"}),
            }
        )
    )

    assert await llm_gateway_enabled_for(ORG) is True
    assert await wallet_mode_for(ORG) is WalletMode.SHADOW


@pytest.mark.parametrize(
    "payload",
    [{"not": "a list"}, "not json", 42, [str(ORG)[:-1]]],
    ids=["object", "text", "number", "truncated-id"],
)
async def test_a_malformed_gateway_payload_turns_the_gateway_off(posthog, payload):
    posthog(_PostHog({LLM_GATEWAY_ROLLOUT_FLAG: payload}))

    assert await llm_gateway_enabled_for(ORG) is False


async def test_a_malformed_wallet_entry_reads_as_off_without_dropping_the_others(
    posthog,
):
    posthog(
        _PostHog(
            {
                WALLETS_ROLLOUT_FLAG: {
                    str(ORG): "on",  # not a mode
                    "not-an-id": "enforce",
                    str(OTHER): "shadow",
                }
            }
        )
    )

    assert await wallet_mode_for(ORG) is WalletMode.OFF
    assert await wallet_mode_for(OTHER) is WalletMode.SHADOW


@pytest.mark.parametrize("payload", [[str(ORG)], "nonsense", None])
async def test_a_wallet_payload_that_is_not_an_object_is_off_for_everyone(
    posthog, payload
):
    posthog(_PostHog({WALLETS_ROLLOUT_FLAG: payload}))

    assert await wallet_mode_for(ORG) is WalletMode.OFF


# Cache


async def test_a_payload_is_read_once_per_ttl_in_the_shared_cache(posthog, cache):
    client = posthog(_PostHog({LLM_GATEWAY_ROLLOUT_FLAG: [str(ORG)]}))

    for _ in range(3):
        assert await llm_gateway_enabled_for(ORG) is True

    assert client.calls == [LLM_GATEWAY_ROLLOUT_FLAG]
    [(namespace, _key)] = cache.keys()
    assert namespace == "posthog:flags"
    [(_value, ttl)] = cache.values()
    assert ttl == switches.ROLLOUT_CACHE_TTL_SECONDS


async def test_another_process_reads_the_shared_cache_instead_of_posthog(
    posthog, cache
):
    client = posthog(_PostHog({WALLETS_ROLLOUT_FLAG: {str(ORG): "shadow"}}))
    assert await wallet_mode_for(ORG) is WalletMode.SHADOW

    switches._payloads.clear()  # a second API process, same Redis
    assert await wallet_mode_for(ORG) is WalletMode.SHADOW

    assert client.calls == [WALLETS_ROLLOUT_FLAG]


async def test_a_stale_payload_is_served_while_one_refresh_fetches_the_edit(
    posthog, cache
):
    client = posthog(_PostHog({WALLETS_ROLLOUT_FLAG: {str(ORG): "shadow"}}))
    assert await wallet_mode_for(ORG) is WalletMode.SHADOW

    client.payloads[WALLETS_ROLLOUT_FLAG] = {str(ORG): "enforce"}
    cache.clear()  # the shared TTL ran out
    fetched_at, payload = switches._payloads[WALLETS_ROLLOUT_FLAG]
    switches._payloads[WALLETS_ROLLOUT_FLAG] = (
        fetched_at - switches.ROLLOUT_CACHE_TTL_SECONDS - 1,
        payload,
    )

    # Served at once from the stale payload; the edit lands with the background refresh.
    assert await wallet_mode_for(ORG) is WalletMode.SHADOW
    await _settle()
    assert await wallet_mode_for(ORG) is WalletMode.ENFORCE
    assert client.calls == [WALLETS_ROLLOUT_FLAG] * 2


async def test_concurrent_first_callers_share_one_lookup(posthog):
    client = posthog(_PostHog({LLM_GATEWAY_ROLLOUT_FLAG: [str(ORG)]}, delay=0.05))

    answers = await asyncio.gather(*(llm_gateway_enabled_for(ORG) for _ in range(12)))

    assert answers == [True] * 12
    assert client.calls == [LLM_GATEWAY_ROLLOUT_FLAG]


async def test_a_payload_of_any_age_is_served_at_once_while_a_slow_refresh_runs(
    posthog, cache
):
    # G2: an idle process's first call must not wait on PostHog, nor read "off".
    client = posthog(_PostHog({LLM_GATEWAY_ROLLOUT_FLAG: [str(ORG)]}, delay=0.3))
    switches._payloads[LLM_GATEWAY_ROLLOUT_FLAG] = (
        time.monotonic() - 3600,
        [str(ORG)],
    )

    started = time.monotonic()
    assert await llm_gateway_enabled_for(ORG) is True
    assert time.monotonic() - started < 0.1

    await _settle()
    assert client.calls == [LLM_GATEWAY_ROLLOUT_FLAG]


async def test_a_first_call_waits_for_the_first_lookup_up_to_the_longer_timeout(
    posthog,
):
    posthog(_PostHog({WALLETS_ROLLOUT_FLAG: {str(ORG): "enforce"}}, delay=0.6))

    assert await wallet_mode_for(ORG) is WalletMode.ENFORCE


async def test_a_measurement_never_waits_for_a_first_lookup(posthog, monkeypatch):
    # The measurement after a cold admission reads "off" at once, inside its own bound.
    monkeypatch.setattr(switches, "ROLLOUT_FIRST_LOOKUP_TIMEOUT_SECONDS", 0.05)
    posthog(_PostHog({WALLETS_ROLLOUT_FLAG: {str(ORG): "enforce"}}, delay=0.5))

    assert await wallet_mode_for(ORG) is WalletMode.OFF
    started = time.monotonic()
    assert await wallet_mode_for(ORG, wait=False) is WalletMode.OFF
    assert time.monotonic() - started < 0.04

    await _settle()
    assert await wallet_mode_for(ORG) is WalletMode.ENFORCE


async def test_startup_prefetch_reads_both_payloads(posthog):
    client = posthog(
        _PostHog(
            {
                LLM_GATEWAY_ROLLOUT_FLAG: [str(ORG)],
                WALLETS_ROLLOUT_FLAG: {str(ORG): "shadow"},
            },
            delay=0.05,
        )
    )

    switches.prefetch_rollout_flags()
    await _settle()

    started = time.monotonic()
    assert await llm_gateway_enabled_for(ORG) is True
    assert await wallet_mode_for(ORG) is WalletMode.SHADOW
    assert time.monotonic() - started < 0.04
    assert sorted(client.calls) == sorted(
        [LLM_GATEWAY_ROLLOUT_FLAG, WALLETS_ROLLOUT_FLAG]
    )


# PostHog failing


@pytest.mark.parametrize(
    "client",
    [_PostHog(raises=True), _PostHog(payloads={})],
    ids=["raises", "no-payload"],
)
async def test_posthog_unreachable_is_gateway_off_and_wallet_off(posthog, client):
    posthog(client)

    assert await llm_gateway_enabled_for(ORG) is False
    assert await wallet_mode_for(ORG) is WalletMode.OFF


async def test_posthog_unavailable_is_off(posthog):
    posthog(None)

    assert await llm_gateway_enabled_for(ORG) is False
    assert await wallet_mode_for(ORG) is WalletMode.OFF


async def test_a_failed_lookup_is_kept_so_an_outage_costs_one_request_per_ttl(
    posthog,
):
    client = posthog(_PostHog(raises=True))

    for _ in range(3):
        assert await wallet_mode_for(ORG) is WalletMode.OFF

    assert client.calls == [WALLETS_ROLLOUT_FLAG]


async def test_a_slow_first_lookup_reads_as_off_and_its_answer_lands_later(
    posthog, monkeypatch
):
    monkeypatch.setattr(switches, "ROLLOUT_FIRST_LOOKUP_TIMEOUT_SECONDS", 0.05)
    posthog(_PostHog({WALLETS_ROLLOUT_FLAG: {str(ORG): "enforce"}}, delay=0.3))

    mode = await asyncio.wait_for(wallet_mode_for(ORG), timeout=0.2)
    assert mode is WalletMode.OFF

    await _settle()
    assert await wallet_mode_for(ORG) is WalletMode.ENFORCE


def _expire(flag):
    """Age this process's payload past the TTL, as if a call came in after it."""
    fetched_at, payload = switches._payloads[flag]
    switches._payloads[flag] = (
        fetched_at - switches.ROLLOUT_CACHE_TTL_SECONDS - 1,
        payload,
    )


@pytest.mark.parametrize(
    "failure", ["raises", "no-payload"], ids=["raises", "no-payload"]
)
async def test_a_failed_refresh_between_admission_and_measurement_keeps_the_charge(
    posthog, cache, failure
):
    client = posthog(_PostHog({WALLETS_ROLLOUT_FLAG: {str(ORG): "enforce"}}))
    assert await wallet_mode_for(ORG) is WalletMode.ENFORCE

    # PostHog goes away; the admission after the TTL starts a refresh that fails.
    if failure == "raises":
        client.raises = True
    else:
        client.payloads = {}
    cache.clear()
    _expire(WALLETS_ROLLOUT_FLAG)
    assert await wallet_mode_for(ORG) is WalletMode.ENFORCE
    await _settle()

    # The measurement after the call still reads the mode its admission read.
    assert await wallet_mode_for(ORG, wait=False) is WalletMode.ENFORCE


async def test_an_outage_of_any_length_keeps_the_last_payload(posthog, cache):
    client = posthog(_PostHog({WALLETS_ROLLOUT_FLAG: {str(ORG): "enforce"}}))
    assert await wallet_mode_for(ORG) is WalletMode.ENFORCE

    client.raises = True
    cache.clear()
    fetched_at, payload = switches._payloads[WALLETS_ROLLOUT_FLAG]
    switches._payloads[WALLETS_ROLLOUT_FLAG] = (fetched_at - 3600, payload)
    await wallet_mode_for(ORG)
    await _settle()

    assert await wallet_mode_for(ORG) is WalletMode.ENFORCE
