"""`llm_v0` resolves the credential per LLM entry, through the shared slug-first resolver.

The agent path used to pre-bind litellm's module-global `openai_key` & co. from the vault before
calling out. A module global has room for one key per family, so an entry naming the second of
two same-family connections silently ran on the first one's key. Resolving each entry through
`SecretsManager.get_provider_settings_from_workflow` makes this path answer exactly what the
prompt path and the evaluators answer: the slug picks the record, and a slugless entry falls back
to the family's first record.
"""

import asyncio
from types import SimpleNamespace

import pytest

from agenta.sdk.engines.running import handlers
from agenta.sdk.engines.running.errors import UnknownConnectionV0Error

pytestmark = pytest.mark.asyncio


def _provider_key(*, slug=None, kind="openai", key="sk-x"):
    return {
        "kind": "provider_key",
        "slug": slug,
        "data": {"kind": kind, "provider": {"key": key}},
    }


@pytest.fixture
def litellm(monkeypatch):
    """A stand-in litellm that records the kwargs of each call, with no network."""

    calls = []

    async def acompletion(**kwargs):
        calls.append(kwargs)
        message = SimpleNamespace(
            model_dump=lambda exclude_none=True: {"role": "assistant"}
        )
        return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=None)

    fake = SimpleNamespace(acompletion=acompletion, calls=calls)
    monkeypatch.setattr(handlers, "_load_litellm", lambda: fake)
    return fake


@pytest.fixture
def vault(monkeypatch):
    """Put a secrets list in the workflow context the resolver reads."""

    def _vault(secrets):
        monkeypatch.setattr(
            "agenta.sdk.managers.secrets.RunningContext",
            SimpleNamespace(
                get=lambda: SimpleNamespace(
                    secrets=secrets, vault_secrets=secrets, local_secrets=[]
                )
            ),
        )

    return _vault


async def _run(llms):
    return await handlers._call_llm_with_fallback(
        llms=llms,
        messages=[{"role": "user", "content": "hi"}],
        tools=None,
    )


TWO_OPENAI_CONNECTIONS = [
    _provider_key(slug="openai", key="sk-first"),
    _provider_key(slug="openai-2", key="sk-second"),
]


async def test_an_entry_naming_the_second_connection_runs_on_its_key(litellm, vault):
    vault(TWO_OPENAI_CONNECTIONS)

    await _run([{"model": "gpt-4o-mini", "connection": "openai-2"}])

    assert litellm.calls[0]["api_key"] == "sk-second"


async def test_a_slugless_entry_still_takes_the_first_record_of_the_family(
    litellm, vault
):
    vault(TWO_OPENAI_CONNECTIONS)

    await _run([{"model": "gpt-4o-mini"}])

    assert litellm.calls[0]["api_key"] == "sk-first"


async def test_an_unknown_slug_fails_loud_instead_of_using_another_key(litellm, vault):
    vault(TWO_OPENAI_CONNECTIONS)

    with pytest.raises(UnknownConnectionV0Error) as excinfo:
        await _run([{"model": "gpt-4o-mini", "connection": "openai-9"}])

    error = excinfo.value
    assert error.code == 400
    assert "openai-9" in error.message
    assert "sk-first" not in error.message
    # Failing loud means failing before the call, not after spending a wrong key.
    assert litellm.calls == []


async def test_each_entry_carries_its_own_connection_through_the_fallback(
    litellm, monkeypatch, vault
):
    """The bug this path had: one global key attribute cannot serve two entries at once."""

    vault(TWO_OPENAI_CONNECTIONS)

    class Unavailable(Exception):
        pass

    monkeypatch.setattr(litellm, "ServiceUnavailableError", Unavailable, raising=False)

    original = litellm.acompletion

    async def acompletion(**kwargs):
        result = await original(**kwargs)
        if len(litellm.calls) == 1:
            raise Unavailable("first entry is down")
        return result

    monkeypatch.setattr(litellm, "acompletion", acompletion)

    await _run(
        [
            {"model": "gpt-4o-mini", "connection": "openai"},
            {"model": "gpt-4o-mini", "connection": "openai-2"},
        ]
    )

    assert [call["api_key"] for call in litellm.calls] == ["sk-first", "sk-second"]


async def test_each_family_resolves_independently(litellm, vault):
    vault(
        [
            _provider_key(slug="openai", key="sk-oai-first"),
            _provider_key(slug="anthropic", kind="anthropic", key="sk-ant"),
            _provider_key(slug="openai-2", key="sk-oai-second"),
        ]
    )

    await _run([{"model": "anthropic/claude-sonnet-5"}])
    await _run([{"model": "gpt-4o-mini"}])

    assert litellm.calls[0]["api_key"] == "sk-ant"
    assert litellm.calls[1]["api_key"] == "sk-oai-first"


async def test_a_keyless_record_is_addressable_around_by_slug(litellm, vault):
    """The resolver's answer, not this path's own: a keyless first record yields no key.

    litellm then falls back to its environment, which is the same thing the prompt path and the
    evaluators do with these secrets. Naming the real connection by slug still reaches its key.
    """

    vault(
        [
            {"kind": "provider_key", "slug": "openai", "data": {"kind": "openai"}},
            _provider_key(slug="openai-2", key="sk-real"),
        ]
    )

    await _run([{"model": "gpt-4o-mini"}])
    await _run([{"model": "gpt-4o-mini", "connection": "openai-2"}])

    assert "api_key" not in litellm.calls[0]
    assert litellm.calls[1]["api_key"] == "sk-real"


async def test_the_model_reaches_litellm_in_the_form_the_resolver_chose(litellm, vault):
    """A bare Anthropic id needs its family prefix or litellm calls the wrong API."""

    vault([_provider_key(slug="anthropic", kind="anthropic", key="sk-ant")])

    await _run([{"model": "claude-sonnet-5", "connection": "anthropic"}])

    assert litellm.calls[0]["model"] == "anthropic/claude-sonnet-5"


async def test_no_attribute_is_ever_set_on_the_litellm_module(litellm, vault):
    """CU2: the key travels in kwargs only, never as `setattr(litellm, ...)`."""

    vault(TWO_OPENAI_CONNECTIONS)
    before = set(vars(litellm))

    await _run([{"model": "gpt-4o-mini", "connection": "openai-2"}])

    assert set(vars(litellm)) == before
    assert not any(name.endswith("_key") for name in vars(litellm))


async def test_concurrent_calls_with_different_connections_do_not_cross_contaminate(
    litellm, vault
):
    """Two tenants racing through the same process must never see each other's key.

    A module-global attribute would let a slow second caller overwrite the key the first
    caller is mid-flight on. Per-call kwargs make that structurally impossible.
    """

    vault(TWO_OPENAI_CONNECTIONS)

    order = []

    async def acompletion(**kwargs):
        # The entry resolved second (openai-2) finishes first, exposing shared-state interference.
        # would leak "sk-second" into the first entry's in-flight call.
        if kwargs["api_key"] == "sk-second":
            await asyncio.sleep(0)
        else:
            await asyncio.sleep(0.01)
        order.append(kwargs["api_key"])
        message = SimpleNamespace(
            model_dump=lambda exclude_none=True: {"role": "assistant"}
        )
        return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=None)

    litellm.acompletion = acompletion

    first, second = await asyncio.gather(
        _run([{"model": "gpt-4o-mini", "connection": "openai"}]),
        _run([{"model": "gpt-4o-mini", "connection": "openai-2"}]),
    )

    assert order == ["sk-second", "sk-first"]
    assert first[1] == {}
    assert second[1] == {}
