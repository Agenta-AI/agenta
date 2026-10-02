"""The per-organization rollout switches: the master env switches, the deployment without a
PostHog key of its own, payload parsing, the shared cache, and PostHog failing."""

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
    """Turn both master switches on, as a deployment with its own PostHog key."""
    monkeypatch.setattr(env.llm_gateway, "enabled", True)
    monkeypatch.setattr(env.wallets, "enabled", True)
    monkeypatch.setattr(env.posthog, "api_key_configured", True)

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


async def test_without_a_posthog_key_of_its_own_the_env_switches_decide_alone(
    monkeypatch, posthog
):
    client = posthog(_PostHog())
    monkeypatch.setattr(env.posthog, "api_key_configured", False)

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


async def test_an_edit_applies_once_the_cached_payload_expires(posthog, cache):
    client = posthog(_PostHog({WALLETS_ROLLOUT_FLAG: {str(ORG): "shadow"}}))
    assert await wallet_mode_for(ORG) is WalletMode.SHADOW

    client.payloads[WALLETS_ROLLOUT_FLAG] = {str(ORG): "enforce"}
    assert await wallet_mode_for(ORG) is WalletMode.SHADOW
    cache.clear()  # the TTL ran out

    assert await wallet_mode_for(ORG) is WalletMode.ENFORCE


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


async def test_a_failed_lookup_is_cached_so_an_outage_costs_one_request_per_ttl(
    posthog,
):
    client = posthog(_PostHog(raises=True))

    for _ in range(3):
        assert await wallet_mode_for(ORG) is WalletMode.OFF

    assert client.calls == [WALLETS_ROLLOUT_FLAG]


async def test_a_slow_posthog_reads_as_off_within_the_lookup_bound(
    posthog, monkeypatch
):
    monkeypatch.setattr(switches, "ROLLOUT_LOOKUP_TIMEOUT_SECONDS", 0.05)
    posthog(_PostHog({WALLETS_ROLLOUT_FLAG: {str(ORG): "enforce"}}, delay=0.5))

    mode = await asyncio.wait_for(wallet_mode_for(ORG), timeout=0.4)

    assert mode is WalletMode.OFF
