"""
Unit tests for the prompt_v0 evaluator (agenta:builtin:prompt:v0).

Tests are organised into:

1. Parameter validation  — missing/invalid configuration raises the right errors.
2. Template formatting   — context variables are forwarded to the template.
3. Response parsing      — bool/number/dict/text LLM outputs map to typed results.
4. Threshold             — custom threshold changes the success boundary.
5. Secrets               — missing or malformed secrets raises the right error.
6. Error handling        — LLM exceptions raise PromptV0Error.

async handlers are called via asyncio.run() so no pytest-asyncio marker is needed.
The @instrument() decorator is bypassed via __wrapped__.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agenta.sdk.workflows.errors import (
    InvalidConfigurationParameterV0Error,
    InvalidConfigurationParametersV0Error,
    InvalidInputsV0Error,
    InvalidSecretsV0Error,
    MissingConfigurationParameterV0Error,
    PromptFormattingV0Error,
    PromptV0Error,
)
from agenta.sdk.workflows.handlers import prompt_v0

_prompt_v0 = prompt_v0.__wrapped__


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def make_message(role: str, content: str) -> dict:
    return {"role": role, "content": content}


def make_params(
    prompt_template=None,
    model=None,
    template_format=None,
    threshold=None,
    response_type=None,
    json_schema=None,
) -> dict:
    params: dict = {
        # No template variables — safe to call without any context args.
        "prompt_template": prompt_template
        or [make_message("user", "Evaluate this output.")],
    }
    if model is not None:
        params["model"] = model
    if template_format is not None:
        params["template_format"] = template_format
    if threshold is not None:
        params["threshold"] = threshold
    if response_type is not None:
        params["response_type"] = response_type
    if json_schema is not None:
        params["json_schema"] = json_schema
    return params


def make_secrets(openai_key: str = "sk-test") -> list:
    return [
        {
            "kind": "provider_key",
            "data": {
                "kind": "openai",
                "provider": {"key": openai_key},
            },
        }
    ]


def make_llm_response(content: str):
    """Build a minimal mock litellm response."""
    choice = MagicMock()
    choice.message.content = content
    resp = MagicMock()
    resp.choices = [choice]
    return resp


def patched_call(llm_content: str, secrets=None):
    """
    Returns (secrets_patch, litellm_patch) context managers so tests can do:
        with secrets_patch, litellm_patch:
            run(_prompt_v0(...))
    """
    if secrets is None:
        secrets = make_secrets()

    mock_litellm = MagicMock()
    mock_litellm.acompletion = AsyncMock(return_value=make_llm_response(llm_content))
    # Make AuthenticationError a real exception subclass so except-clause works
    mock_litellm.AuthenticationError = type(
        "AuthenticationError", (Exception,), {"message": ""}
    )

    sp = patch(
        "agenta.sdk.managers.secrets.SecretsManager.retrieve_secrets",
        new=AsyncMock(return_value=(secrets, None, None)),
    )
    lp = patch(
        "agenta.sdk.workflows.handlers._load_litellm",
        return_value=mock_litellm,
    )
    return sp, lp, mock_litellm


def call(
    llm_content: str,
    *,
    params=None,
    inputs=None,
    outputs=None,
    trace=None,
    testcase=None,
    secrets=None,
):
    """Run prompt_v0 with fully-patched secrets and litellm."""
    if params is None:
        params = make_params()
    sp, lp, _ = patched_call(llm_content, secrets=secrets)
    with sp, lp:
        return run(
            _prompt_v0(
                parameters=params,
                inputs=inputs,
                outputs=outputs,
                trace=trace,
                testcase=testcase,
            )
        )


# ---------------------------------------------------------------------------
# 1. Parameter validation
# ---------------------------------------------------------------------------


class TestPromptV0Parameters:
    def test_none_parameters_raises(self):
        with pytest.raises(InvalidConfigurationParametersV0Error):
            run(_prompt_v0(parameters=None))

    def test_string_parameters_raises(self):
        with pytest.raises(InvalidConfigurationParametersV0Error):
            run(_prompt_v0(parameters="bad"))

    def test_list_parameters_raises(self):
        with pytest.raises(InvalidConfigurationParametersV0Error):
            run(_prompt_v0(parameters=[]))

    def test_missing_prompt_template_raises(self):
        with pytest.raises(MissingConfigurationParameterV0Error):
            run(_prompt_v0(parameters={"model": "gpt-4"}))

    def test_non_list_prompt_template_raises(self):
        sp, lp, _ = patched_call("0.8")
        with sp, lp:
            with pytest.raises(InvalidConfigurationParameterV0Error):
                run(_prompt_v0(parameters={"prompt_template": "not a list"}))

    def test_invalid_response_type_raises(self):
        sp, lp, _ = patched_call("0.8")
        with sp, lp:
            with pytest.raises(InvalidConfigurationParameterV0Error):
                run(_prompt_v0(parameters=make_params(response_type="xml")))

    def test_json_schema_response_without_schema_dict_raises(self):
        sp, lp, _ = patched_call("{}")
        with sp, lp:
            with pytest.raises(InvalidConfigurationParameterV0Error):
                run(
                    _prompt_v0(
                        parameters=make_params(
                            response_type="json_schema",
                            json_schema="not a dict",
                        )
                    )
                )

    def test_inputs_non_dict_raises(self):
        sp, lp, _ = patched_call("0.8")
        with sp, lp:
            with pytest.raises(InvalidInputsV0Error):
                run(_prompt_v0(parameters=make_params(), inputs="bad"))


# ---------------------------------------------------------------------------
# 2. Response parsing
# ---------------------------------------------------------------------------


class TestPromptV0ResponseParsing:
    def test_number_string_returns_score_and_success(self):
        result = call("0.9")
        assert result == {"score": pytest.approx(0.9), "success": True}

    def test_zero_returns_score_and_failure(self):
        result = call("0.0")
        assert result == {"score": pytest.approx(0.0), "success": False}

    def test_integer_one_returns_success(self):
        result = call("1")
        assert result["score"] == pytest.approx(1.0)
        assert result["success"] is True

    def test_bool_true_returns_success_only(self):
        result = call("true")
        assert result == {"success": True}

    def test_bool_false_returns_failure_only(self):
        result = call("false")
        assert result == {"success": False}

    def test_dict_returned_as_is(self):
        result = call(json.dumps({"score": 0.7, "reason": "ok"}))
        assert result == {"score": 0.7, "reason": "ok"}

    def test_plain_text_wrapped_in_message(self):
        result = call("This output looks correct.")
        assert result == {"message": "This output looks correct."}

    def test_whitespace_stripped_before_parse(self):
        result = call("  0.5  ")
        assert result == {"score": pytest.approx(0.5), "success": True}


# ---------------------------------------------------------------------------
# 3. Threshold
# ---------------------------------------------------------------------------


class TestPromptV0Threshold:
    def test_custom_threshold_high_fails(self):
        result = call("0.6", params=make_params(threshold=0.9))
        assert result["success"] is False

    def test_custom_threshold_low_passes(self):
        result = call("0.3", params=make_params(threshold=0.1))
        assert result["success"] is True

    def test_default_threshold_boundary(self):
        result = call("0.5")
        assert result["success"] is True  # score >= 0.5 (default)

    def test_threshold_one_only_perfect_passes(self):
        result = call("1.0", params=make_params(threshold=1.0))
        assert result["success"] is True

    def test_threshold_one_near_perfect_fails(self):
        result = call("0.99", params=make_params(threshold=1.0))
        assert result["success"] is False


# ---------------------------------------------------------------------------
# 4. Template context
# ---------------------------------------------------------------------------


class TestPromptV0Context:
    def _capture_messages(
        self, params=None, inputs=None, outputs=None, trace=None, testcase=None
    ):
        """Return the messages list that was passed to litellm.acompletion."""
        if params is None:
            params = make_params()
        sp, lp, mock_llm = patched_call("0.9")
        with sp, lp:
            run(
                _prompt_v0(
                    parameters=params,
                    inputs=inputs,
                    outputs=outputs,
                    trace=trace,
                    testcase=testcase,
                )
            )
        _, call_kwargs = mock_llm.acompletion.call_args
        return call_kwargs.get("messages") or mock_llm.acompletion.call_args.kwargs.get(
            "messages"
        )

    def test_outputs_substituted_in_template(self):
        params = make_params(
            prompt_template=[make_message("user", "Answer: {{outputs}}")]
        )
        msgs = self._capture_messages(params=params, outputs="Paris")
        assert msgs[0]["content"] == "Answer: Paris"

    def test_inputs_substituted_as_top_level_keys(self):
        params = make_params(prompt_template=[make_message("user", "Q: {{question}}")])
        msgs = self._capture_messages(
            params=params, inputs={"question": "What is 2+2?"}
        )
        assert msgs[0]["content"] == "Q: What is 2+2?"

    def test_inputs_accessible_as_inputs_dict(self):
        params = make_params(prompt_template=[make_message("user", "Data: {{inputs}}")])
        msgs = self._capture_messages(params=params, inputs={"x": 1})
        assert "x" in msgs[0]["content"]

    def test_trace_substituted_in_template(self):
        params = make_params(
            prompt_template=[make_message("user", "Latency: {{trace}}")]
        )
        msgs = self._capture_messages(params=params, trace={"latency": 100})
        assert "100" in msgs[0]["content"]

    def test_prediction_is_alias_for_outputs(self):
        params = make_params(
            prompt_template=[make_message("user", "Pred: {{prediction}}")]
        )
        msgs = self._capture_messages(params=params, outputs="yes")
        assert msgs[0]["content"] == "Pred: yes"

    def test_testcase_in_context(self):
        params = make_params(
            prompt_template=[make_message("user", "Ref: {{testcase}}")]
        )
        msgs = self._capture_messages(params=params, testcase={"correct": "4"})
        assert "correct" in msgs[0]["content"]

    def test_model_forwarded_to_litellm(self):
        sp, lp, mock_llm = patched_call("0.9")
        with sp, lp:
            run(_prompt_v0(parameters=make_params(model="gpt-4o"), outputs="x"))
        _, kw = mock_llm.acompletion.call_args
        assert kw.get("model") == "gpt-4o"


# ---------------------------------------------------------------------------
# 5. Secrets
# ---------------------------------------------------------------------------


class TestPromptV0Secrets:
    def test_none_secrets_raises(self):
        sp = patch(
            "agenta.sdk.managers.secrets.SecretsManager.retrieve_secrets",
            new=AsyncMock(return_value=(None, None, None)),
        )
        lp = patch(
            "agenta.sdk.workflows.handlers._load_litellm", return_value=MagicMock()
        )
        with sp, lp:
            with pytest.raises(InvalidSecretsV0Error):
                run(_prompt_v0(parameters=make_params()))

    def test_non_list_secrets_raises(self):
        sp = patch(
            "agenta.sdk.managers.secrets.SecretsManager.retrieve_secrets",
            new=AsyncMock(return_value=("bad", None, None)),
        )
        lp = patch(
            "agenta.sdk.workflows.handlers._load_litellm", return_value=MagicMock()
        )
        with sp, lp:
            with pytest.raises(InvalidSecretsV0Error):
                run(_prompt_v0(parameters=make_params()))


# ---------------------------------------------------------------------------
# 6. Error handling
# ---------------------------------------------------------------------------


class TestPromptV0ErrorHandling:
    def test_llm_exception_raises_prompt_error(self):
        sp, lp, mock_llm = patched_call("unused")
        mock_llm.acompletion = AsyncMock(side_effect=RuntimeError("LLM down"))
        with sp, lp:
            with pytest.raises(PromptV0Error):
                run(_prompt_v0(parameters=make_params()))

    def test_template_formatting_error_raises(self):
        # Template references {{missing_var}} which is never in context.
        params = make_params(
            prompt_template=[make_message("user", "Answer: {{missing_var}}")]
        )
        sp, lp, _ = patched_call("0.9")
        with sp, lp:
            with pytest.raises(PromptFormattingV0Error):
                run(_prompt_v0(parameters=params))
