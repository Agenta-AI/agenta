"""`llm_v0` binds litellm's per-provider key attributes to the FIRST record of each family.

The agent path sets `litellm.openai_key` & co. from the vault before calling out. With two
connections for one provider, letting the last record overwrite the first would make this path
run on a different credential than `SecretsManager._settings_by_family` picks everywhere else.
"""

from types import SimpleNamespace

import pytest

from agenta.sdk.engines.running import handlers

pytestmark = pytest.mark.asyncio


def _provider_key(kind: str, key: str) -> dict:
    return {"kind": "provider_key", "data": {"kind": kind, "provider": {"key": key}}}


@pytest.fixture
def litellm(monkeypatch):
    """A stand-in litellm whose key attributes the handler writes, with no network."""

    async def acompletion(**_kwargs):
        message = SimpleNamespace(
            model_dump=lambda exclude_none=True: {"role": "assistant"}
        )
        return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=None)

    fake = SimpleNamespace(acompletion=acompletion)
    monkeypatch.setattr(handlers, "_load_litellm", lambda: fake)
    return fake


async def _run(monkeypatch, secrets):
    async def retrieve_secrets():
        return secrets, [], []

    monkeypatch.setattr(handlers.SecretsManager, "retrieve_secrets", retrieve_secrets)
    await handlers._call_llm_with_fallback(
        llms=[{"model": "gpt-4o-mini"}],
        messages=[{"role": "user", "content": "hi"}],
        tools=None,
    )


async def test_the_first_connection_of_a_family_wins(litellm, monkeypatch):
    await _run(
        monkeypatch,
        [_provider_key("openai", "sk-first"), _provider_key("openai", "sk-second")],
    )

    assert litellm.openai_key == "sk-first"


async def test_each_family_binds_independently(litellm, monkeypatch):
    await _run(
        monkeypatch,
        [
            _provider_key("openai", "sk-oai-first"),
            _provider_key("anthropic", "sk-ant"),
            _provider_key("openai", "sk-oai-second"),
        ],
    )

    assert litellm.openai_key == "sk-oai-first"
    assert litellm.anthropic_key == "sk-ant"


async def test_a_keyless_record_does_not_claim_the_family(litellm, monkeypatch):
    await _run(
        monkeypatch,
        [
            {"kind": "provider_key", "data": {"kind": "openai", "provider": {}}},
            _provider_key("openai", "sk-real"),
        ],
    )

    assert litellm.openai_key == "sk-real"
