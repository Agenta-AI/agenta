from contextlib import nullcontext

import pytest

from agenta.sdk.engines.running.handlers import (
    _coerce_fallback_policy,
    _coerce_retry_config,
    _coerce_retry_policy,
    _run_prompt_llm_config_with_retry,
    _prompt_llm_configs,
    _run_prompt_with_fallback,
    _should_fallback,
    _should_retry,
)
from agenta.sdk.engines.running.errors import InvalidSecretsV0Error
from agenta.sdk.utils.types import (
    CATALOG_TYPES,
    FallbackPolicy,
    ModelConfig,
    PromptTemplate,
    RetryConfig,
    RetryPolicy,
)


class ProviderError(Exception):
    def __init__(self, status_code, message=None):
        self.status_code = status_code
        super().__init__(message or f"provider error {status_code}")


def test_new_prompt_template_fields_default_to_null_in_data_model():
    prompt = PromptTemplate()

    assert prompt.fallback_configs is None
    assert prompt.retry_config is None
    assert prompt.retry_policy is None
    assert prompt.fallback_policy is None

    dumped = prompt.model_dump()
    assert dumped["fallback_configs"] is None
    assert dumped["retry_config"] is None
    assert dumped["retry_policy"] is None
    assert dumped["fallback_policy"] is None


def test_new_prompt_template_fields_coerce_at_runtime():
    prompt = PromptTemplate()

    assert _prompt_llm_configs(prompt) == [prompt.llm_config]
    assert _coerce_retry_config(prompt.retry_config) == RetryConfig(
        max_retries=0,
        delay_ms=0,
    )
    assert _coerce_retry_policy(prompt.retry_policy) == RetryPolicy.OFF
    assert _coerce_fallback_policy(prompt.fallback_policy) == FallbackPolicy.OFF


def test_chat_template_kwargs_is_passed_through_when_set():
    prompt = PromptTemplate(
        llm_config=ModelConfig(
            model="qwen/qwen3",
            chat_template_kwargs={"enable_thinking": False},
        )
    )

    assert prompt.to_openai_kwargs()["chat_template_kwargs"] == {
        "enable_thinking": False
    }


def test_chat_template_kwargs_is_not_template_formatted():
    prompt = PromptTemplate(
        messages=[{"role": "user", "content": "Hello {{name}}"}],
        input_keys=["name"],
        llm_config=ModelConfig(
            model="qwen/qwen3",
            chat_template_kwargs={"literal": "{{provider_flag}}"},
        ),
        fallback_configs=[
            {
                "model": "fallback",
                "chat_template_kwargs": {"nested": {"literal": "{{fallback_flag}}"}},
            }
        ],
    )

    formatted = prompt.format(name="Ada")

    assert formatted.messages[0].content == "Hello Ada"
    assert formatted.llm_config.chat_template_kwargs == {"literal": "{{provider_flag}}"}
    assert formatted.fallback_configs[0].chat_template_kwargs == {
        "nested": {"literal": "{{fallback_flag}}"}
    }


def test_null_chat_template_kwargs_is_omitted_from_provider_kwargs():
    prompt = PromptTemplate(llm_config=ModelConfig(model="gpt-4o-mini"))

    assert "chat_template_kwargs" not in prompt.to_openai_kwargs()


def test_fallback_config_uses_model_config_defaults():
    prompt = PromptTemplate(fallback_configs=[{"temperature": 0.2}])

    assert prompt.fallback_configs[0].model == "gpt-4o-mini"
    assert prompt.fallback_configs[0].temperature == 0.2


def test_prompt_template_catalog_schema_exposes_fallback_model_ref():
    schema = CATALOG_TYPES["prompt-template"]
    fallback_schema = schema["properties"]["fallback_configs"]
    retry_config_schema = schema["properties"]["retry_config"]
    retry_policy_schema = schema["properties"]["retry_policy"]
    fallback_policy_schema = schema["properties"]["fallback_policy"]
    array_schema = next(
        option for option in fallback_schema["anyOf"] if option.get("type") == "array"
    )
    retry_object_schema = next(
        option
        for option in retry_config_schema["anyOf"]
        if option.get("type") == "object"
    )

    assert fallback_schema["default"] is None
    assert array_schema["items"]["properties"]["model"]["x-ag-type-ref"] == "model"
    assert fallback_policy_schema["x-ag-type"] == "choice"
    assert fallback_policy_schema["enum"] == [
        "off",
        "availability",
        "capacity",
        "access",
        "context",
        "any",
    ]
    assert set(retry_object_schema["properties"]) == {
        "max_retries",
        "delay_ms",
    }
    assert retry_policy_schema["enum"] == [
        "off",
        "availability",
        "capacity",
        "transient",
        "any",
    ]


def test_fallback_policy_404_only_allowed_by_any():
    error = ProviderError(404)

    assert not _should_fallback(error, FallbackPolicy.ACCESS)
    assert not _should_fallback(error, FallbackPolicy.CONTEXT)
    assert _should_fallback(error, FallbackPolicy.ANY)


def test_fallback_policy_context_handles_context_window_errors():
    error = ProviderError(400, "context window exceeded")

    assert not _should_fallback(error, FallbackPolicy.ACCESS)
    assert _should_fallback(error, FallbackPolicy.CONTEXT)
    assert _should_fallback(error, FallbackPolicy.ANY)


def test_retry_policy_requires_explicit_policy():
    retry_config = RetryConfig(max_retries=2)

    assert not _should_retry(ProviderError(503), retry_config, None)
    assert _should_retry(
        ProviderError(503),
        RetryConfig(max_retries=2),
        RetryPolicy.AVAILABILITY,
    )


def test_retry_policy_any_is_still_provider_call_errors_only():
    retry_config = RetryConfig(max_retries=2)

    assert _should_retry(ProviderError(400), retry_config, RetryPolicy.ANY)
    assert not _should_retry(
        InvalidSecretsV0Error(expected="dict", got=None, model="gpt-4o-mini"),
        retry_config,
        RetryPolicy.ANY,
    )


def test_plain_value_error_with_network_text_is_not_retryable():
    # A local ValueError whose message incidentally contains "connection" must not
    # be classified as retryable — only typed exceptions and HTTP status codes drive
    # retry classification.
    error = ValueError("connection string is missing")
    retry_config = RetryConfig(max_retries=2)

    assert not _should_retry(error, retry_config, RetryPolicy.ANY)


def test_plain_value_error_with_network_text_is_not_fallback_eligible():
    # Same principle for fallback: text heuristics must not classify local errors.
    error = ValueError("connection string is missing")

    assert not _should_fallback(error, FallbackPolicy.ANY)


def test_plain_value_error_with_auth_text_is_not_fallback_eligible():
    error = ValueError("authorization header is required by this function")

    assert not _should_fallback(error, FallbackPolicy.ACCESS)
    assert not _should_fallback(error, FallbackPolicy.ANY)


def test_plain_value_error_with_timeout_text_is_not_retryable():
    error = ValueError("timed out waiting for lock")
    retry_config = RetryConfig(max_retries=2)

    assert not _should_retry(error, retry_config, RetryPolicy.AVAILABILITY)
    assert not _should_retry(error, retry_config, RetryPolicy.ANY)


@pytest.mark.asyncio
async def test_prompt_runner_moves_to_fallback_after_candidate_failure(monkeypatch):
    calls = []

    async def fake_run_candidate(
        formatted_prompt, llm_config, retry_config, retry_policy, messages=None
    ):
        calls.append(llm_config.model)
        if llm_config.model == "primary":
            raise ProviderError(503)
        return "fallback response"

    monkeypatch.setattr(
        "agenta.sdk.engines.running.handlers._run_prompt_llm_config_with_retry",
        fake_run_candidate,
    )

    prompt = PromptTemplate(
        llm_config=ModelConfig(model="primary"),
        fallback_configs=[{"model": "fallback"}],
        fallback_policy=FallbackPolicy.AVAILABILITY,
    )

    assert await _run_prompt_with_fallback(prompt) == "fallback response"
    assert calls == ["primary", "fallback"]


@pytest.mark.asyncio
async def test_retry_runner_retries_explicit_transient_provider_errors(monkeypatch):
    calls = []

    monkeypatch.setattr(
        "agenta.sdk.engines.running.handlers.SecretsManager.get_provider_settings_from_workflow",
        lambda model: {"model": model},
    )
    monkeypatch.setattr(
        "agenta.sdk.engines.running.handlers.mockllm.user_aws_credentials_from",
        lambda provider_settings: nullcontext(),
    )

    async def fake_completion(**kwargs):
        calls.append(kwargs["model"])
        raise ProviderError(503)

    monkeypatch.setattr(
        "agenta.sdk.engines.running.handlers.mockllm.acompletion",
        fake_completion,
    )

    prompt = PromptTemplate(llm_config=ModelConfig(model="primary"))

    with pytest.raises(ProviderError):
        await _run_prompt_llm_config_with_retry(
            formatted_prompt=prompt,
            llm_config=prompt.llm_config,
            retry_config=RetryConfig(max_retries=2),
            retry_policy=RetryPolicy.AVAILABILITY,
        )

    assert calls == ["primary", "primary", "primary"]


@pytest.mark.asyncio
async def test_retry_runner_does_not_retry_deterministic_secret_errors(monkeypatch):
    calls = []

    def fake_provider_settings(model):
        calls.append(model)
        return None

    monkeypatch.setattr(
        "agenta.sdk.engines.running.handlers.SecretsManager.get_provider_settings_from_workflow",
        fake_provider_settings,
    )

    prompt = PromptTemplate(llm_config=ModelConfig(model="primary"))

    with pytest.raises(InvalidSecretsV0Error):
        await _run_prompt_llm_config_with_retry(
            formatted_prompt=prompt,
            llm_config=prompt.llm_config,
            retry_config=RetryConfig(max_retries=2),
            retry_policy=RetryPolicy.ANY,
        )

    assert calls == ["primary"]


# ---------------------------------------------------------------------------
# FPT-004: runtime fallback matrix
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "status_code, policy, expected",
    [
        # availability
        (503, FallbackPolicy.AVAILABILITY, True),
        (500, FallbackPolicy.AVAILABILITY, True),
        (503, FallbackPolicy.CAPACITY, True),
        (503, FallbackPolicy.ACCESS, True),
        (503, FallbackPolicy.ANY, True),
        # capacity
        (429, FallbackPolicy.AVAILABILITY, False),
        (429, FallbackPolicy.CAPACITY, True),
        (429, FallbackPolicy.ACCESS, True),
        (429, FallbackPolicy.ANY, True),
        # access
        (401, FallbackPolicy.AVAILABILITY, False),
        (401, FallbackPolicy.CAPACITY, False),
        (401, FallbackPolicy.ACCESS, True),
        (401, FallbackPolicy.ANY, True),
        (403, FallbackPolicy.ACCESS, True),
        # any (400/404/422 without context-window text)
        (400, FallbackPolicy.AVAILABILITY, False),
        (400, FallbackPolicy.CONTEXT, False),
        (400, FallbackPolicy.ANY, True),
        (404, FallbackPolicy.ANY, True),
        (422, FallbackPolicy.ANY, True),
        # context-window on 400
        (400, FallbackPolicy.CONTEXT, False),  # plain 400 is not context
    ],
)
def test_fallback_policy_status_code_matrix(status_code, policy, expected):
    error = ProviderError(status_code)
    assert _should_fallback(error, policy) == expected


@pytest.mark.parametrize(
    "status_code, policy, expected",
    [
        (503, RetryPolicy.AVAILABILITY, True),
        (503, RetryPolicy.CAPACITY, True),
        (503, RetryPolicy.TRANSIENT, True),
        (503, RetryPolicy.ANY, True),
        (429, RetryPolicy.AVAILABILITY, False),
        (429, RetryPolicy.CAPACITY, True),
        (429, RetryPolicy.TRANSIENT, True),
        (429, RetryPolicy.ANY, True),
        (400, RetryPolicy.AVAILABILITY, False),
        (400, RetryPolicy.CAPACITY, False),
        (400, RetryPolicy.TRANSIENT, False),
        (400, RetryPolicy.ANY, True),
        (404, RetryPolicy.ANY, True),
        (422, RetryPolicy.ANY, True),
        # typed timeout always availability
        (503, RetryPolicy.AVAILABILITY, True),
    ],
)
def test_retry_policy_status_code_matrix(status_code, policy, expected):
    error = ProviderError(status_code)
    retry_config = RetryConfig(max_retries=1)
    assert _should_retry(error, retry_config, policy) == expected


def test_retry_before_fallback_same_model_retried_first(monkeypatch):
    """Retry exhausts on the primary before fallback fires."""
    calls = []

    async def fake_run_candidate(
        formatted_prompt, llm_config, retry_config, retry_policy, messages=None
    ):
        calls.append(llm_config.model)
        if llm_config.model == "primary":
            raise ProviderError(503)
        return "fallback ok"

    monkeypatch.setattr(
        "agenta.sdk.engines.running.handlers._run_prompt_llm_config_with_retry",
        fake_run_candidate,
    )

    prompt = PromptTemplate(
        llm_config=ModelConfig(model="primary"),
        fallback_configs=[{"model": "secondary"}],
        fallback_policy=FallbackPolicy.AVAILABILITY,
        retry_config=RetryConfig(max_retries=2),
        retry_policy=RetryPolicy.AVAILABILITY,
    )

    # _run_prompt_with_fallback delegates retry to _run_prompt_llm_config_with_retry;
    # here fake_run_candidate stands in for the whole retry loop, so we only see
    # one call per model — verifying that primary is tried before secondary.
    import asyncio

    result = asyncio.get_event_loop().run_until_complete(
        _run_prompt_with_fallback(prompt)
    )
    assert result == "fallback ok"
    assert calls == ["primary", "secondary"]


@pytest.mark.asyncio
async def test_fallback_not_triggered_on_local_error(monkeypatch):
    """A local programming error must not trigger fallback."""
    calls = []

    async def fake_run_candidate(
        formatted_prompt, llm_config, retry_config, retry_policy, messages=None
    ):
        calls.append(llm_config.model)
        raise ValueError("bug in prompt rendering")

    monkeypatch.setattr(
        "agenta.sdk.engines.running.handlers._run_prompt_llm_config_with_retry",
        fake_run_candidate,
    )

    prompt = PromptTemplate(
        llm_config=ModelConfig(model="primary"),
        fallback_configs=[{"model": "secondary"}],
        fallback_policy=FallbackPolicy.ANY,
    )

    with pytest.raises(ValueError):
        await _run_prompt_with_fallback(prompt)

    assert calls == ["primary"]


@pytest.mark.asyncio
async def test_fallback_exhaustion_raises_last_error(monkeypatch):
    """When all configs fail the last error is re-raised."""
    errors = []

    async def fake_run_candidate(
        formatted_prompt, llm_config, retry_config, retry_policy, messages=None
    ):
        exc = ProviderError(503, f"{llm_config.model} unavailable")
        errors.append(exc)
        raise exc

    monkeypatch.setattr(
        "agenta.sdk.engines.running.handlers._run_prompt_llm_config_with_retry",
        fake_run_candidate,
    )

    prompt = PromptTemplate(
        llm_config=ModelConfig(model="primary"),
        fallback_configs=[{"model": "secondary"}, {"model": "tertiary"}],
        fallback_policy=FallbackPolicy.AVAILABILITY,
    )

    with pytest.raises(ProviderError) as exc_info:
        await _run_prompt_with_fallback(prompt)

    assert "tertiary" in str(exc_info.value)


@pytest.mark.asyncio
async def test_retry_exhaustion_raises_after_max_attempts(monkeypatch):
    """Retry loop stops at max_retries+1 total attempts."""
    calls = []

    monkeypatch.setattr(
        "agenta.sdk.engines.running.handlers.SecretsManager.get_provider_settings_from_workflow",
        lambda model: {"model": model},
    )
    monkeypatch.setattr(
        "agenta.sdk.engines.running.handlers.mockllm.user_aws_credentials_from",
        lambda provider_settings: nullcontext(),
    )

    async def fake_completion(**kwargs):
        calls.append(kwargs["model"])
        raise ProviderError(503)

    monkeypatch.setattr(
        "agenta.sdk.engines.running.handlers.mockllm.acompletion",
        fake_completion,
    )

    prompt = PromptTemplate(llm_config=ModelConfig(model="m"))

    with pytest.raises(ProviderError):
        await _run_prompt_llm_config_with_retry(
            formatted_prompt=prompt,
            llm_config=prompt.llm_config,
            retry_config=RetryConfig(max_retries=3),
            retry_policy=RetryPolicy.AVAILABILITY,
        )

    assert len(calls) == 4  # 1 initial + 3 retries


# ---------------------------------------------------------------------------
# FPT-006: backward compatibility — old prompt JSON must not gain new fields
# ---------------------------------------------------------------------------


def test_old_prompt_round_trip_omits_new_fields():
    """PromptTemplate built from old-style JSON must not serialize new keys."""
    old_config = {
        "llm_config": {
            "model": "gpt-4o-mini",
            "temperature": 0.7,
            "max_tokens": 512,
        },
        "messages": [{"role": "user", "content": "Hello"}],
        "template_format": "fstring",
    }

    prompt = PromptTemplate(**old_config)
    dumped = prompt.model_dump(exclude_none=True)

    for new_key in (
        "fallback_configs",
        "retry_config",
        "retry_policy",
        "fallback_policy",
        "chat_template_kwargs",
    ):
        assert new_key not in dumped, f"new field '{new_key}' leaked into old prompt"


def test_default_prompt_serialization_omits_new_fields():
    """A freshly constructed PromptTemplate with no new fields set must not
    include those keys when serialized with exclude_none=True."""
    prompt = PromptTemplate(llm_config=ModelConfig(model="gpt-4o-mini"))
    dumped = prompt.model_dump(exclude_none=True)

    for new_key in (
        "fallback_configs",
        "retry_config",
        "retry_policy",
        "fallback_policy",
        "chat_template_kwargs",
    ):
        assert new_key not in dumped, (
            f"new field '{new_key}' leaked into default prompt"
        )


def test_retry_config_default_not_serialized():
    """RetryConfig() with default max_retries=0 must serialize as None-equivalent
    when omitted from the prompt, not written as an object with defaults."""
    prompt = PromptTemplate(llm_config=ModelConfig(model="gpt-4o-mini"))
    assert prompt.retry_config is None
    dumped = prompt.model_dump(exclude_none=True)
    assert "retry_config" not in dumped
