"""AWS credentials reach litellm as arguments of their own call, never through `os.environ`.

The process environment is shared by every concurrent request, so a credential written there
for one call can be read by another call that is running at the same time or later.
"""

import asyncio
import os
from types import SimpleNamespace

import pytest

from agenta.sdk.engines.running.errors import InvalidSecretsV0Error
from agenta.sdk.engines.running.handlers import _run_prompt_llm_config_with_retry
from agenta.sdk.litellm import mockllm
from agenta.sdk.utils.types import ModelConfig, PromptTemplate

AWS_ENV_NAMES = (
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
)

BEDROCK_MODEL = "bedrock/anthropic.claude-3-haiku-20240307-v1:0"

PROJECT_A_SETTINGS = {
    "model": BEDROCK_MODEL,
    "aws_access_key_id": "project-a-access-key",
    "aws_secret_access_key": "project-a-secret-key",
    "aws_region_name": "eu-west-1",
}


class _Message(SimpleNamespace):
    def model_dump(self, exclude_none: bool = False) -> dict:
        return {"role": "assistant", "content": self.content}


def _response(content: str = "ok") -> SimpleNamespace:
    return SimpleNamespace(choices=[SimpleNamespace(message=_Message(content=content))])


class FakeLitellm:
    """Records each call and, when told to, holds it open until released."""

    def __init__(self):
        self.calls = {}
        self.entered = {}
        self.release = {}

    def hold(self, name: str) -> None:
        self.entered[name] = asyncio.Event()
        self.release[name] = asyncio.Event()

    async def acompletion(self, **kwargs):
        name = kwargs["messages"][-1]["content"]
        self.calls[name] = {
            "kwargs": kwargs,
            "env": {key: os.environ.get(key) for key in AWS_ENV_NAMES},
        }
        if name in self.entered:
            self.entered[name].set()
            await self.release[name].wait()
        return _response()


@pytest.fixture
def fake_litellm(monkeypatch):
    for name in AWS_ENV_NAMES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("AGENTA_LITELLM_MOCK", raising=False)
    monkeypatch.setattr(mockllm, "AGENTA_LITELLM_MOCK", None)

    fake = FakeLitellm()
    monkeypatch.setattr(mockllm, "_load_litellm", lambda injected=None: fake)
    return fake


def _settings_by_task(monkeypatch, settings: dict) -> None:
    monkeypatch.setattr(
        "agenta.sdk.engines.running.handlers.SecretsManager.get_provider_settings_from_workflow",
        lambda model, connection=None: dict(settings[model]),
    )


async def _run(task: str, model: str):
    prompt = PromptTemplate(
        messages=[{"role": "user", "content": task}],
        llm_config=ModelConfig(model=model),
    )
    return await _run_prompt_llm_config_with_retry(
        formatted_prompt=prompt,
        llm_config=prompt.llm_config,
        retry_config=None,
        retry_policy=None,
    )


@pytest.mark.asyncio
async def test_concurrent_calls_never_share_aws_credentials(monkeypatch, fake_litellm):
    """A enters, B enters, A exits, B exits. Then C, with no keys, must not see A's keys."""
    monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", "true")
    _settings_by_task(
        monkeypatch,
        {
            "model-a": PROJECT_A_SETTINGS,
            "model-b": {"model": "gpt-4o-mini", "api_key": "project-b-openai-key"},
            "model-c": {"model": BEDROCK_MODEL, "aws_region_name": "eu-west-1"},
        },
    )
    fake_litellm.hold("a")
    fake_litellm.hold("b")

    task_a = asyncio.create_task(_run("a", "model-a"))
    await fake_litellm.entered["a"].wait()
    task_b = asyncio.create_task(_run("b", "model-b"))
    await fake_litellm.entered["b"].wait()

    fake_litellm.release["a"].set()
    await task_a
    fake_litellm.release["b"].set()
    await task_b

    assert "AWS_ACCESS_KEY_ID" not in os.environ
    assert "AWS_SECRET_ACCESS_KEY" not in os.environ

    await _run("c", "model-c")

    a_kwargs = fake_litellm.calls["a"]["kwargs"]
    assert a_kwargs["aws_access_key_id"] == "project-a-access-key"
    assert a_kwargs["aws_secret_access_key"] == "project-a-secret-key"
    assert a_kwargs["aws_region_name"] == "eu-west-1"
    for task in ("a", "b", "c"):
        assert fake_litellm.calls[task]["env"]["AWS_ACCESS_KEY_ID"] is None
    assert "aws_access_key_id" not in fake_litellm.calls["c"]["kwargs"]
    assert "aws_access_key_id" not in fake_litellm.calls["b"]["kwargs"]


@pytest.mark.asyncio
async def test_upper_case_credential_names_become_call_arguments(
    monkeypatch, fake_litellm
):
    monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", "false")
    _settings_by_task(
        monkeypatch,
        {
            "model-a": {
                "model": BEDROCK_MODEL,
                "AWS_ACCESS_KEY_ID": "upper-access-key",
                "AWS_SECRET_ACCESS_KEY": "upper-secret-key",
                "AWS_SESSION_TOKEN": "upper-session-token",
                "AWS_DEFAULT_REGION": "us-east-2",
            }
        },
    )

    await _run("a", "model-a")

    kwargs = fake_litellm.calls["a"]["kwargs"]
    assert kwargs["aws_access_key_id"] == "upper-access-key"
    assert kwargs["aws_secret_access_key"] == "upper-secret-key"
    assert kwargs["aws_session_token"] == "upper-session-token"
    assert kwargs["aws_region_name"] == "us-east-2"
    assert not any(key.startswith("AWS_") for key in kwargs)
    assert fake_litellm.calls["a"]["env"]["AWS_ACCESS_KEY_ID"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "settings",
    [
        {"model": BEDROCK_MODEL, "aws_region_name": "eu-west-1"},
        {"model": "sagemaker/my-endpoint", "aws_region_name": "eu-west-1"},
        {
            "model": "my-model",
            "custom_llm_provider": "bedrock",
            "aws_access_key_id": "only-the-id",
        },
        {"model": BEDROCK_MODEL, "aws_profile_name": "default"},
        {"model": BEDROCK_MODEL, "aws_role_name": "arn:aws:iam::1:role/x"},
        # litellm picks the host profile over the keys.
        {**PROJECT_A_SETTINGS, "aws_profile_name": "default"},
        # SageMaker ignores an API key and signs with AWS credentials.
        {"model": "sagemaker_chat/my-endpoint", "api_key": "not-a-credential"},
    ],
)
async def test_hosted_mode_refuses_an_aws_call_without_its_own_credentials(
    monkeypatch, fake_litellm, settings
):
    monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", "false")
    _settings_by_task(monkeypatch, {"model-a": settings})

    with pytest.raises(InvalidSecretsV0Error) as error:
        await _run("a", "model-a")

    assert error.value.code == 400
    assert fake_litellm.calls == {}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "settings",
    [
        PROJECT_A_SETTINGS,
        {"model": BEDROCK_MODEL, "api_key": "bedrock-api-key"},
        {
            "model": "sagemaker/my-endpoint",
            "aws_access_key_id": "id",
            "aws_secret_access_key": "secret",
        },
        # The role is assumed with the connection's own keys.
        {**PROJECT_A_SETTINGS, "aws_role_name": "arn:aws:iam::1:role/x"},
    ],
)
async def test_hosted_mode_runs_an_aws_call_with_its_own_credentials(
    monkeypatch, fake_litellm, settings
):
    monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", "false")
    _settings_by_task(monkeypatch, {"model-a": settings})

    await _run("a", "model-a")

    assert "a" in fake_litellm.calls


@pytest.mark.asyncio
async def test_self_hosted_aws_call_without_keys_uses_the_host_credentials(
    monkeypatch, fake_litellm
):
    """Self-hosted, the call carries no keys and litellm signs with the host's own chain."""
    monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", "true")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "host-access-key")
    _settings_by_task(
        monkeypatch,
        {"model-a": {"model": BEDROCK_MODEL, "aws_region_name": "eu-west-1"}},
    )

    await _run("a", "model-a")

    call = fake_litellm.calls["a"]
    assert "aws_access_key_id" not in call["kwargs"]
    assert call["env"]["AWS_ACCESS_KEY_ID"] == "host-access-key"
    assert os.environ["AWS_ACCESS_KEY_ID"] == "host-access-key"


@pytest.mark.asyncio
async def test_non_aws_completion_is_passed_through_unchanged(
    monkeypatch, fake_litellm
):
    monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", "false")
    _settings_by_task(
        monkeypatch,
        {"model-a": {"model": "gpt-4o-mini", "api_key": "project-openai-key"}},
    )

    result = await _run("a", "model-a")

    assert result.choices[0].message.content == "ok"
    kwargs = fake_litellm.calls["a"]["kwargs"]
    assert kwargs["model"] == "gpt-4o-mini"
    assert kwargs["api_key"] == "project-openai-key"
    assert not any(key.startswith("aws_") for key in kwargs)


@pytest.fixture
def agent_loop_litellm(monkeypatch, fake_litellm):
    """The llm_v0 agent loop calls litellm directly, not through `mockllm.acompletion`."""
    from agenta.sdk.engines.running import handlers

    async def _ensure_secrets():
        return None

    monkeypatch.setattr(handlers, "_load_litellm", lambda *a, **k: fake_litellm)
    monkeypatch.setattr(
        handlers.SecretsManager, "ensure_secrets_in_workflow", _ensure_secrets
    )
    return handlers


@pytest.mark.asyncio
async def test_agent_loop_passes_aws_credentials_per_call(
    monkeypatch, agent_loop_litellm, fake_litellm
):
    monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", "false")
    _settings_by_task(
        monkeypatch,
        {
            BEDROCK_MODEL: {
                **PROJECT_A_SETTINGS,
                "AWS_SESSION_TOKEN": "project-a-session-token",
            }
        },
    )

    await agent_loop_litellm._call_llm_with_fallback(
        llms=[{"model": BEDROCK_MODEL}],
        messages=[{"role": "user", "content": "a"}],
        tools=None,
    )

    kwargs = fake_litellm.calls["a"]["kwargs"]
    assert kwargs["aws_access_key_id"] == "project-a-access-key"
    assert kwargs["aws_session_token"] == "project-a-session-token"
    assert "AWS_SESSION_TOKEN" not in kwargs


@pytest.mark.asyncio
async def test_agent_loop_refuses_an_aws_call_without_credentials_in_hosted_mode(
    monkeypatch, agent_loop_litellm, fake_litellm
):
    monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", "false")
    _settings_by_task(
        monkeypatch,
        {BEDROCK_MODEL: {"model": BEDROCK_MODEL, "aws_region_name": "eu-west-1"}},
    )

    with pytest.raises(InvalidSecretsV0Error):
        await agent_loop_litellm._call_llm_with_fallback(
            llms=[{"model": BEDROCK_MODEL}],
            messages=[{"role": "user", "content": "a"}],
            tools=None,
        )

    assert fake_litellm.calls == {}


@pytest.mark.parametrize(
    "model",
    [
        "anthropic.claude-3-haiku-20240307-v1:0",
        "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
    ],
)
def test_hosted_mode_refuses_a_bare_bedrock_model_id(monkeypatch, model):
    """litellm routes these ids to Bedrock without a `bedrock/` prefix."""
    import litellm

    monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", "false")

    with pytest.raises(InvalidSecretsV0Error):
        mockllm.prepare_aws_call_kwargs(
            args=(), kwargs={"model": model}, litellm=litellm
        )


@pytest.mark.asyncio
async def test_llm_v0_returns_the_credential_error(monkeypatch, agent_loop_litellm):
    monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", "false")
    _settings_by_task(
        monkeypatch,
        {BEDROCK_MODEL: {"model": BEDROCK_MODEL, "aws_region_name": "eu-west-1"}},
    )

    with pytest.raises(InvalidSecretsV0Error):
        await agent_loop_litellm.llm_v0.__wrapped__(
            parameters={
                "llms": [{"model": BEDROCK_MODEL}],
                "tools": {"internal": ["control.terminate"]},
                "loop": {"max_iterations": 1},
            }
        )


@pytest.mark.parametrize(
    "license_, flag, dropped",
    [("ee", None, True), ("oss", None, False), ("ee", "true", False)],
)
def test_host_aws_credentials_leave_the_environment_only_in_hosted_mode(
    monkeypatch, license_, flag, dropped
):
    from agenta.sdk.middlewares.running import vault

    monkeypatch.setenv("AGENTA_LICENSE", license_)
    if flag is None:
        monkeypatch.delenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", raising=False)
    else:
        monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", flag)
    for name in vault._HOST_AWS_CREDENTIAL_NAMES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "host-access-key")
    monkeypatch.setenv("AWS_PROFILE_NAME", "host-profile")
    monkeypatch.setenv("AWS_REGION", "eu-west-1")

    names = vault.drop_host_aws_credentials()

    if dropped:
        assert names == ["AWS_ACCESS_KEY_ID", "AWS_PROFILE_NAME"]
        assert "AWS_ACCESS_KEY_ID" not in os.environ
        assert "AWS_PROFILE_NAME" not in os.environ
    else:
        assert names == []
        assert os.environ["AWS_ACCESS_KEY_ID"] == "host-access-key"
    assert os.environ["AWS_REGION"] == "eu-west-1"


@pytest.mark.parametrize(
    "extra, expected_token",
    [({}, ""), ({"aws_session_token": "connection-token"}, "connection-token")],
)
def test_a_key_pair_never_takes_the_host_session_token(
    monkeypatch, extra, expected_token
):
    """litellm fills a missing token from `AWS_SESSION_TOKEN`; an empty one stops that."""
    monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", "true")

    kwargs = mockllm.prepare_aws_call_kwargs(
        args=(), kwargs={**PROJECT_A_SETTINGS, **extra}
    )

    assert kwargs["aws_session_token"] == expected_token


def test_a_keyless_call_keeps_the_host_session_token(monkeypatch):
    monkeypatch.setenv("AGENTA_SERVICES_ENV_PROVIDER_KEYS_ENABLED", "true")

    kwargs = mockllm.prepare_aws_call_kwargs(
        args=(), kwargs={"model": BEDROCK_MODEL, "aws_region_name": "eu-west-1"}
    )

    assert "aws_session_token" not in kwargs
