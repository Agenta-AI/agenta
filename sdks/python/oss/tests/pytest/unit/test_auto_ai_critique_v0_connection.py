"""LLM-as-a-judge resolves its credential through the connection slug in its configuration.

Unlike ``test_auto_ai_critique_v0_runtime``, which mocks the resolver, these run the REAL
``SecretsManager`` over mock vault payloads — the point is that the slug travels from the
evaluator's parameters all the way to the key litellm is handed, with two same-family
connections present to make a family-only resolution ambiguous.
"""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from agenta.sdk.contexts.running import RunningContext
from agenta.sdk.engines.running import handlers as critique_handlers
from agenta.sdk.engines.running.errors import (
    InvalidConfigurationParameterV0Error,
    UnknownConnectionV0Error,
)
from agenta.sdk.middlewares.running.normalizer import NormalizerMiddleware
from agenta.sdk.models.workflows import WorkflowRequestData, WorkflowServiceRequest

_auto_ai_critique_v0 = critique_handlers.auto_ai_critique_v0.__original_handler__


TWO_OPENAI_CONNECTIONS = [
    {
        "kind": "provider_key",
        "slug": "openai",
        "data": {"kind": "openai", "provider": {"key": "sk-team-a"}},
    },
    {
        "kind": "provider_key",
        "slug": "openai-2",
        "data": {"kind": "openai", "provider": {"key": "sk-team-b"}},
    },
]


@contextmanager
def _noop_aws_credentials(_provider_settings):
    yield


@pytest.fixture
def judge(monkeypatch):
    """Run the judge against mock vault payloads, returning the kwargs litellm was handed."""
    import agenta as ag

    ag.init()

    captured: dict = {}

    async def _fake_acompletion(*_args, **kwargs):
        captured["kwargs"] = kwargs
        message = SimpleNamespace(content='{"score": 1.0}')
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    async def _run(secrets, **parameter_overrides):
        monkeypatch.setattr(
            "agenta.sdk.managers.secrets.RunningContext",
            SimpleNamespace(
                get=lambda: SimpleNamespace(
                    secrets=secrets, vault_secrets=secrets, local_secrets=[]
                )
            ),
        )
        parameters = {
            "prompt_template": [{"role": "user", "content": "grade {{prediction}}"}],
            "model": "gpt-4o-mini",
            "response_type": "text",
            "version": "3",
        }
        parameters.update(parameter_overrides)

        with (
            patch.object(
                critique_handlers.SecretsManager,
                "ensure_secrets_in_workflow",
                new=AsyncMock(return_value=secrets),
            ),
            patch.object(
                critique_handlers.mockllm,
                "acompletion",
                side_effect=_fake_acompletion,
            ),
            patch.object(
                critique_handlers.mockllm,
                "user_aws_credentials_from",
                side_effect=_noop_aws_credentials,
            ),
        ):
            await _auto_ai_critique_v0(parameters=parameters, outputs="4")

        return captured["kwargs"]

    return _run


async def test_judge_resolves_the_named_connection(judge):
    kwargs = await judge(TWO_OPENAI_CONNECTIONS, connection="openai-2")

    assert kwargs["model"] == "gpt-4o-mini"
    assert kwargs["api_key"] == "sk-team-b"


async def test_judge_without_a_connection_keeps_the_family_fallback(judge):
    kwargs = await judge(TWO_OPENAI_CONNECTIONS)

    # Deterministic rather than correct-by-luck: the first record of the family wins, which is
    # what a judge saved before named connections existed has always resolved to.
    assert kwargs["api_key"] == "sk-team-a"


async def test_judge_with_a_saved_model_list_prefers_the_owning_connection(judge):
    secrets = [
        {
            "kind": "provider_key",
            "slug": "openai",
            "data": {
                "kind": "openai",
                "provider": {"key": "sk-team-a"},
                "models": [{"slug": "gpt-4o"}],
            },
        },
        {
            "kind": "provider_key",
            "slug": "openai-2",
            "data": {
                "kind": "openai",
                "provider": {"key": "sk-team-b"},
                "models": [{"slug": "gpt-4o-mini"}],
            },
        },
    ]

    kwargs = await judge(secrets)

    assert kwargs["api_key"] == "sk-team-b"


async def test_judge_with_an_unknown_connection_fails_loud(judge):
    with pytest.raises(UnknownConnectionV0Error):
        await judge(TWO_OPENAI_CONNECTIONS, connection="openai-9")


async def test_an_unknown_connection_reaches_the_caller_as_a_400(monkeypatch):
    """The running middleware turns it into a configuration error, not a 500 with a stacktrace.

    A slug the vault has no record for is something the user can fix in their configuration, so
    the response has to say so — the generic branch of `_normalize_exception` would answer 500
    and attach the SDK's traceback instead.
    """
    import agenta as ag

    monkeypatch.setattr(ag, "tracing", None)

    async def handler(parameters):
        raise UnknownConnectionV0Error("openai-9", ["openai", "openai-2"])

    request = WorkflowServiceRequest(data=WorkflowRequestData(parameters={}))
    token = RunningContext.set(RunningContext(handler=handler))
    try:
        response = await NormalizerMiddleware()(request, lambda _request: None)
    finally:
        RunningContext.reset(token)

    assert response.status.code == 400
    assert response.status.stacktrace is None
    assert "openai-9" in response.status.message
    assert response.status.type.endswith("unknown-connection")


async def test_judge_rejects_a_non_string_connection(judge):
    with pytest.raises(InvalidConfigurationParameterV0Error):
        await judge(TWO_OPENAI_CONNECTIONS, connection={"slug": "openai-2"})
