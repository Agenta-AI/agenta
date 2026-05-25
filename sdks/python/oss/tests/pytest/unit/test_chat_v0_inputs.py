from contextlib import nullcontext
from types import SimpleNamespace

import pytest

from agenta.sdk.engines.running import handlers


class _FakeMessage:
    def model_dump(self, exclude_none=True):
        return {"role": "assistant", "content": "ok"}


@pytest.fixture
def fake_llm(monkeypatch):
    captured = {}

    async def ensure_secrets():
        return None

    async def acompletion(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=_FakeMessage(),
                )
            ]
        )

    monkeypatch.setattr(
        handlers.SecretsManager,
        "ensure_secrets_in_workflow",
        ensure_secrets,
    )
    monkeypatch.setattr(
        handlers.SecretsManager,
        "get_provider_settings_from_workflow",
        lambda model: {"model": model, "api_key": "test-key"},
    )
    monkeypatch.setattr(handlers.mockllm, "acompletion", acompletion)
    monkeypatch.setattr(
        handlers.mockllm,
        "user_aws_credentials_from",
        lambda _settings: nullcontext(),
    )

    return captured


@pytest.mark.asyncio
async def test_chat_v0_treats_messages_as_reserved_input(fake_llm):
    inputs = {"messages": [{"role": "user", "content": "Hello"}]}

    result = await handlers.chat_v0.__wrapped__(
        parameters={
            "prompt": {
                "messages": [{"role": "system", "content": "Be concise."}],
                "input_keys": ["messages"],
                "llm_config": {"model": "gpt-4o-mini"},
            }
        },
        inputs=inputs,
    )

    assert result == {"role": "assistant", "content": "ok"}
    assert fake_llm["messages"] == [
        {"role": "system", "content": "Be concise."},
        {"role": "user", "content": "Hello"},
    ]
    assert inputs == {"messages": [{"role": "user", "content": "Hello"}]}


@pytest.mark.asyncio
async def test_chat_v0_validates_non_reserved_inputs(fake_llm):
    await handlers.chat_v0.__wrapped__(
        parameters={
            "prompt": {
                "messages": [{"role": "system", "content": "Country: {{country}}"}],
                "input_keys": ["country", "messages"],
                "llm_config": {"model": "gpt-4o-mini"},
            }
        },
        inputs={
            "country": "France",
            "messages": [{"role": "user", "content": "Capital?"}],
        },
    )

    assert fake_llm["messages"] == [
        {"role": "system", "content": "Country: France"},
        {"role": "user", "content": "Capital?"},
    ]


@pytest.mark.asyncio
async def test_chat_v0_explicit_messages_override_input_messages(fake_llm):
    inputs = {
        "messages": [{"role": "user", "content": "ignored"}],
    }

    await handlers.chat_v0.__wrapped__(
        parameters={
            "prompt": {
                "messages": [{"role": "system", "content": "Be concise."}],
                "input_keys": ["messages"],
                "llm_config": {"model": "gpt-4o-mini"},
            }
        },
        inputs=inputs,
        messages=[{"role": "user", "content": "used"}],
    )

    assert fake_llm["messages"] == [
        {"role": "system", "content": "Be concise."},
        {"role": "user", "content": "used"},
    ]
    assert inputs == {"messages": [{"role": "user", "content": "ignored"}]}
