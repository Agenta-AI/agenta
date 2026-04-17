import pytest

from agenta.sdk.engines.running.handlers import (
    _normalize_fallback_policy,
    _normalize_retry_policy,
    _prompt_llm_configs,
    _run_prompt_with_fallback,
    _should_fallback,
)
from agenta.sdk.utils.types import (
    CATALOG_TYPES,
    FallbackPolicy,
    ModelConfig,
    PromptTemplate,
    RetryPolicy,
)


class ProviderError(Exception):
    def __init__(self, status_code):
        self.status_code = status_code
        super().__init__(f"provider error {status_code}")


def test_new_prompt_template_fields_default_to_null_in_data_model():
    prompt = PromptTemplate()

    assert prompt.fallback_llm_configs is None
    assert prompt.retry_policy is None
    assert prompt.fallback_policy is None

    dumped = prompt.model_dump()
    assert dumped["fallback_llm_configs"] is None
    assert dumped["retry_policy"] is None
    assert dumped["fallback_policy"] is None


def test_new_prompt_template_fields_normalize_at_runtime():
    prompt = PromptTemplate()

    assert _prompt_llm_configs(prompt) == [prompt.llm_config]
    assert _normalize_retry_policy(prompt.retry_policy) == RetryPolicy()
    assert _normalize_fallback_policy(prompt.fallback_policy) == FallbackPolicy.OFF


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
        fallback_llm_configs=[
            {
                "model": "fallback",
                "chat_template_kwargs": {"nested": {"literal": "{{fallback_flag}}"}},
            }
        ],
    )

    formatted = prompt.format(name="Ada")

    assert formatted.messages[0].content == "Hello Ada"
    assert formatted.llm_config.chat_template_kwargs == {
        "literal": "{{provider_flag}}"
    }
    assert formatted.fallback_llm_configs[0].chat_template_kwargs == {
        "nested": {"literal": "{{fallback_flag}}"}
    }


def test_null_chat_template_kwargs_is_omitted_from_provider_kwargs():
    prompt = PromptTemplate(llm_config=ModelConfig(model="gpt-4o-mini"))

    assert "chat_template_kwargs" not in prompt.to_openai_kwargs()


def test_fallback_config_requires_model():
    with pytest.raises(ValueError, match="fallback_llm_configs\\[0\\]\\.model"):
        PromptTemplate(fallback_llm_configs=[{"temperature": 0.2}])


def test_prompt_template_catalog_schema_exposes_fallback_model_ref():
    schema = CATALOG_TYPES["prompt-template"]
    fallback_schema = schema["properties"]["fallback_llm_configs"]
    array_schema = next(
        option for option in fallback_schema["anyOf"] if option.get("type") == "array"
    )

    assert fallback_schema["default"] is None
    assert array_schema["items"]["properties"]["model"]["x-ag-type-ref"] == "model"
    assert "model" in array_schema["items"]["required"]


def test_fallback_policy_404_only_allowed_by_any():
    error = ProviderError(404)

    assert not _should_fallback(error, FallbackPolicy.ACCESS)
    assert _should_fallback(error, FallbackPolicy.ANY)


@pytest.mark.asyncio
async def test_prompt_runner_moves_to_fallback_after_candidate_failure(monkeypatch):
    calls = []

    async def fake_run_candidate(
        formatted_prompt, llm_config, retry_policy, messages=None
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
        fallback_llm_configs=[{"model": "fallback"}],
        fallback_policy=FallbackPolicy.AVAILABILITY,
    )

    assert await _run_prompt_with_fallback(prompt) == "fallback response"
    assert calls == ["primary", "fallback"]
