"""Unit tests for the WP-B1 patch to ``auto_ai_critique_v0``.

Covers:
- shared provider/secret resolution via ``SecretsManager``;
- ``InvalidSecretsV0Error`` raised when provider settings are missing;
- the LLM call no longer carries ``temperature``;
- the rendered messages and ``response_format`` are forwarded to ``mockllm.acompletion``;
- existing context aliases (``inputs``, ``outputs``/``prediction``,
  ``ground_truth``/``correct_answer``/``reference``, ``trace``, ``parameters``)
  remain available to the prompt template;
- existing result normalization (numeric, boolean, dict, raw text) is unchanged.
"""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from agenta.sdk.engines.running import handlers as critique_handlers
from agenta.sdk.engines.running.errors import (
    InvalidSecretsV0Error,
    PromptFormattingV0Error,
)


# The handler is wrapped by ``@instrument()``. The decorator exposes the raw
# function via ``__original_handler__`` so unit tests can exercise the runtime
# logic without bringing up tracing context.
_auto_ai_critique_v0 = critique_handlers.auto_ai_critique_v0.__original_handler__


def _fake_completion_response(content: str) -> SimpleNamespace:
    """Build the minimal ``litellm``-shaped response the handler reads."""

    message = SimpleNamespace(content=content)
    choice = SimpleNamespace(message=message)
    return SimpleNamespace(choices=[choice])


@contextmanager
def _noop_aws_credentials(_provider_settings):
    yield


@pytest.fixture
def mocked_llm_call():
    """Mock the LLM call boundary without touching the network."""

    captured: dict = {}

    async def _fake_acompletion(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        content = captured.get("response_content", '{"score": 0.9}')
        return _fake_completion_response(content)

    with (
        patch.object(
            critique_handlers.mockllm,
            "acompletion",
            side_effect=_fake_acompletion,
        ) as mock_acompletion,
        patch.object(
            critique_handlers.mockllm,
            "user_aws_credentials_from",
            side_effect=_noop_aws_credentials,
        ) as mock_creds,
    ):
        yield SimpleNamespace(
            acompletion=mock_acompletion,
            user_aws_credentials_from=mock_creds,
            captured=captured,
        )


@pytest.fixture
def mocked_secrets():
    """Patch the SecretsManager boundary used by the handler."""

    with (
        patch.object(
            critique_handlers.SecretsManager,
            "ensure_secrets_in_workflow",
            new=AsyncMock(return_value=[]),
        ) as ensure,
        patch.object(
            critique_handlers.SecretsManager,
            "get_provider_settings_from_workflow",
        ) as get_settings,
    ):
        yield SimpleNamespace(
            ensure=ensure,
            get_settings=get_settings,
        )


def _base_parameters(**overrides):
    params = {
        "prompt_template": [
            {"role": "system", "content": "You evaluate answers."},
            {
                "role": "user",
                "content": (
                    "question={{question}}\n"
                    "prediction={{prediction}}\n"
                    "ground_truth={{ground_truth}}\n"
                    "params_threshold={{parameters.threshold}}"
                ),
            },
        ],
        "model": "gpt-4o-mini",
        "response_type": "text",
        "correct_answer_key": "expected",
        "threshold": 0.5,
        "version": "3",
    }
    params.update(overrides)
    return params


async def test_uses_workflow_secret_resolution_for_standard_model(
    mocked_secrets, mocked_llm_call
):
    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk-resolved",
    }

    result = await _auto_ai_critique_v0(
        parameters=_base_parameters(),
        inputs={"question": "What is 2+2?", "expected": "4"},
        outputs="4",
        trace=None,
    )

    mocked_secrets.ensure.assert_awaited_once()
    mocked_secrets.get_settings.assert_called_once_with("gpt-4o-mini")

    kwargs = mocked_llm_call.captured["kwargs"]
    assert kwargs["model"] == "gpt-4o-mini"
    assert kwargs["api_key"] == "sk-resolved"
    assert "temperature" not in kwargs
    assert kwargs["response_format"] == {"type": "text"}
    # Message rendering still resolves direct input keys.
    user_message = kwargs["messages"][1]["content"]
    assert "question=What is 2+2?" in user_message
    assert "prediction=4" in user_message
    assert "ground_truth=4" in user_message
    assert "params_threshold=0.5" in user_message

    # Dict-shaped LLM output passes through the result normalizer unchanged.
    assert result == {"score": 0.9}


async def test_resolves_custom_provider_model_settings(mocked_secrets, mocked_llm_call):
    mocked_secrets.get_settings.return_value = {
        "model": "bedrock/anthropic.claude-3-5-sonnet",
        "aws_access_key_id": "AKIA...",
        "aws_secret_access_key": "secret",
        "aws_region_name": "us-east-1",
    }

    await _auto_ai_critique_v0(
        parameters=_base_parameters(model="my-self-hosted-claude"),
        inputs={"question": "q", "expected": "e"},
        outputs="o",
    )

    mocked_secrets.get_settings.assert_called_once_with("my-self-hosted-claude")

    kwargs = mocked_llm_call.captured["kwargs"]
    # The compatible model resolved from provider_settings is used, not the raw
    # alias the user typed.
    assert kwargs["model"] == "bedrock/anthropic.claude-3-5-sonnet"
    assert kwargs["aws_access_key_id"] == "AKIA..."
    assert kwargs["aws_region_name"] == "us-east-1"
    assert "temperature" not in kwargs


async def test_missing_provider_settings_raises_invalid_secrets(
    mocked_secrets, mocked_llm_call
):
    mocked_secrets.get_settings.return_value = None

    with pytest.raises(InvalidSecretsV0Error) as exc_info:
        await _auto_ai_critique_v0(
            parameters=_base_parameters(model="ghost-model"),
            inputs={"question": "q"},
            outputs="o",
        )

    # The error message surfaces the model so users know which provider key is missing.
    assert "ghost-model" in str(exc_info.value.message)
    mocked_llm_call.acompletion.assert_not_called()


async def test_does_not_send_temperature_in_llm_call(mocked_secrets, mocked_llm_call):
    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    await _auto_ai_critique_v0(
        parameters=_base_parameters(),
        inputs={"question": "q", "expected": "e"},
        outputs="o",
    )

    kwargs = mocked_llm_call.captured["kwargs"]
    # Explicitly assert removal of the previously hard-coded value.
    assert "temperature" not in kwargs


async def test_response_format_uses_json_schema_when_configured(
    mocked_secrets, mocked_llm_call
):
    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    schema = {
        "name": "verdict",
        "schema": {
            "type": "object",
            "properties": {"score": {"type": "number"}},
            "required": ["score"],
        },
    }

    await _auto_ai_critique_v0(
        parameters=_base_parameters(
            response_type="json_schema",
            json_schema=schema,
        ),
        inputs={"question": "q", "expected": "e"},
        outputs="o",
    )

    kwargs = mocked_llm_call.captured["kwargs"]
    assert kwargs["response_format"] == {
        "type": "json_schema",
        "json_schema": schema,
    }


async def test_json_schema_variables_are_rendered_before_llm_call(
    mocked_secrets, mocked_llm_call
):
    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    schema = {
        "name": "verdict",
        "schema": {
            "type": "object",
            "properties": {
                "{{question}}": {
                    "type": "string",
                    "description": "Expected {{correct_answer}} at {{parameters.threshold}}",
                }
            },
            "required": ["{{question}}"],
        },
    }

    await _auto_ai_critique_v0(
        parameters=_base_parameters(
            response_type="json_schema",
            json_schema=schema,
        ),
        inputs={"question": "score", "expected": "gold"},
        outputs="o",
    )

    kwargs = mocked_llm_call.captured["kwargs"]
    assert kwargs["response_format"] == {
        "type": "json_schema",
        "json_schema": {
            "name": "verdict",
            "schema": {
                "type": "object",
                "properties": {
                    "score": {
                        "type": "string",
                        "description": "Expected gold at 0.5",
                    }
                },
                "required": ["score"],
            },
        },
    }
    assert schema["schema"]["properties"]["{{question}}"]["description"] == (
        "Expected {{correct_answer}} at {{parameters.threshold}}"
    )


async def test_response_format_json_object_does_not_attach_schema(
    mocked_secrets, mocked_llm_call
):
    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    await _auto_ai_critique_v0(
        parameters=_base_parameters(
            response_type="json_object",
            json_schema={"name": "ignored"},
        ),
        inputs={"question": "q", "expected": "e"},
        outputs="o",
    )

    kwargs = mocked_llm_call.captured["kwargs"]
    assert kwargs["response_format"] == {"type": "json_object"}


async def test_jinja_render_error_raises_prompt_formatting_before_llm_call(
    mocked_secrets, mocked_llm_call
):
    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    with pytest.raises(PromptFormattingV0Error):
        await _auto_ai_critique_v0(
            parameters=_base_parameters(
                template_format="jinja2",
                prompt_template=[
                    {
                        "role": "user",
                        "content": "{{ lipsum.__globals__['os'].popen('id').read() }}",
                    }
                ],
            ),
            inputs={"question": "q", "expected": "e"},
            outputs="o",
        )

    mocked_llm_call.acompletion.assert_not_called()


async def test_inputs_and_outputs_aliases_available_to_template(
    mocked_secrets, mocked_llm_call
):
    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    parameters = _base_parameters()
    parameters["prompt_template"] = [
        {
            "role": "user",
            "content": (
                "inputs={{inputs}}\n"
                "outputs={{outputs}}\n"
                "prediction={{prediction}}\n"
                "reference={{reference}}\n"
                "correct_answer={{correct_answer}}\n"
                "trace={{trace}}"
            ),
        }
    ]

    await _auto_ai_critique_v0(
        parameters=parameters,
        inputs={"question": "q", "expected": "gold"},
        outputs={"answer": "a"},
        trace={"root": "ok"},
    )

    rendered = mocked_llm_call.captured["kwargs"]["messages"][0]["content"]
    assert '"question": "q"' in rendered
    assert '"answer": "a"' in rendered
    assert "reference=gold" in rendered
    assert "correct_answer=gold" in rendered
    assert '"root": "ok"' in rendered


@pytest.mark.parametrize(
    "llm_content,expected_result",
    [
        ('{"score": 0.42}', {"score": 0.42}),
        ("0.8", {"score": 0.8, "success": True}),
        ("0.2", {"score": 0.2, "success": False}),
    ],
)
async def test_existing_result_normalization_preserved(
    mocked_secrets,
    mocked_llm_call,
    llm_content,
    expected_result,
):
    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }
    mocked_llm_call.captured["response_content"] = llm_content

    result = await _auto_ai_critique_v0(
        parameters=_base_parameters(),
        inputs={"question": "q", "expected": "e"},
        outputs="o",
    )

    assert result == expected_result


async def test_non_json_text_output_raises_invalid_outputs(
    mocked_secrets, mocked_llm_call
):
    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }
    mocked_llm_call.captured["response_content"] = "not json"

    from agenta.sdk.engines.running.errors import InvalidOutputsV0Error

    with pytest.raises(InvalidOutputsV0Error):
        await _auto_ai_critique_v0(
            parameters=_base_parameters(),
            inputs={"question": "q", "expected": "e"},
            outputs="o",
        )


# =============================================================================
# Mustache template format
# =============================================================================


async def test_judge_renders_messages_with_mustache(mocked_secrets, mocked_llm_call):
    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    await _auto_ai_critique_v0(
        parameters=_base_parameters(template_format="mustache"),
        inputs={"question": "What is 2+2?", "expected": "4"},
        outputs="4",
        trace=None,
    )

    user_message = mocked_llm_call.captured["kwargs"]["messages"][1]["content"]
    assert "question=What is 2+2?" in user_message
    assert "prediction=4" in user_message
    assert "ground_truth=4" in user_message
    assert "params_threshold=0.5" in user_message


async def test_judge_renders_json_schema_with_mustache(mocked_secrets, mocked_llm_call):
    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    schema = {
        "name": "verdict",
        "schema": {
            "type": "object",
            "properties": {
                "score": {
                    "type": "number",
                    "description": "Score for {{question}}",
                }
            },
        },
    }

    await _auto_ai_critique_v0(
        parameters=_base_parameters(
            template_format="mustache",
            response_type="json_schema",
            json_schema=schema,
        ),
        inputs={"question": "is it correct", "expected": "e"},
        outputs="o",
    )

    response_format = mocked_llm_call.captured["kwargs"]["response_format"]
    rendered_desc = response_format["json_schema"]["schema"]["properties"]["score"][
        "description"
    ]
    assert rendered_desc == "Score for is it correct"


async def test_judge_mustache_partial_raises_before_llm_call(
    mocked_secrets, mocked_llm_call
):
    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    params = _base_parameters(
        template_format="mustache",
        prompt_template=[
            {"role": "user", "content": "hi {{> partial}}"},
        ],
    )

    with pytest.raises(PromptFormattingV0Error):
        await _auto_ai_critique_v0(
            parameters=params,
            inputs={"question": "q"},
            outputs="o",
        )

    mocked_llm_call.acompletion.assert_not_called()


async def test_version_5_defaults_to_mustache(mocked_secrets, mocked_llm_call):
    """A v5 judge with no explicit template_format renders via mustache.

    Mustache is permissive for missing variables (renders empty), so a template
    referencing an undeclared variable still produces a completion call rather
    than raising — the opposite of the curly default used by v3/v4.
    """

    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    params = _base_parameters(version="5")
    params.pop("template_format", None)
    params["prompt_template"] = [
        {"role": "user", "content": "value={{undeclared_variable}}"},
    ]

    await _auto_ai_critique_v0(
        parameters=params,
        inputs={"question": "q", "expected": "e"},
        outputs="o",
    )

    user_message = mocked_llm_call.captured["kwargs"]["messages"][0]["content"]
    assert user_message == "value="


async def test_version_3_and_4_default_to_curly(mocked_secrets, mocked_llm_call):
    """v3 and v4 keep the legacy curly default, which raises on missing vars.

    This pins that bumping the new judge to v5 does not change v3/v4 behavior.
    """

    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    for version in ("3", "4"):
        params = _base_parameters(version=version)
        params.pop("template_format", None)
        params["prompt_template"] = [
            {"role": "user", "content": "value={{undeclared_variable}}"},
        ]

        with pytest.raises(PromptFormattingV0Error):
            await _auto_ai_critique_v0(
                parameters=params,
                inputs={"question": "q", "expected": "e"},
                outputs="o",
            )


async def test_version_2_defaults_to_fstring(mocked_secrets, mocked_llm_call):
    """A v2 judge with no explicit template_format renders via fstring.

    Happy-path pin for the oldest version: fstring uses single-brace
    ``{name}`` placeholders, so a ``{{name}}`` template emits a literal
    ``{name}`` (the doubled braces escape to a single pair) rather than being
    substituted. This proves v2 still routes to fstring after the v5 bump.
    """

    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    params = _base_parameters(version="2")
    params.pop("template_format", None)
    params["prompt_template"] = [
        {"role": "user", "content": "q={question} lit={{question}}"},
    ]

    await _auto_ai_critique_v0(
        parameters=params,
        inputs={"question": "q", "expected": "e"},
        outputs="o",
    )

    user_message = mocked_llm_call.captured["kwargs"]["messages"][0]["content"]
    # fstring substitutes {question}; {{question}} is an escaped literal brace pair.
    assert user_message == "q=q lit={question}"


async def test_version_4_defaults_response_type_to_json_schema(
    mocked_secrets, mocked_llm_call
):
    """v4 with no explicit response_type defaults to ``json_schema``.

    The version default only fills in when ``response_type`` is absent; this
    pins the v4-specific branch (every other version defaults to ``text``).
    A schema must be attached for the default to surface in ``response_format``.
    """

    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    schema = {
        "name": "verdict",
        "schema": {
            "type": "object",
            "properties": {"score": {"type": "number"}},
            "required": ["score"],
        },
    }

    params = _base_parameters(version="4", json_schema=schema)
    params.pop("response_type", None)  # rely on the v4 default

    await _auto_ai_critique_v0(
        parameters=params,
        inputs={"question": "q", "expected": "e"},
        outputs="o",
    )

    kwargs = mocked_llm_call.captured["kwargs"]
    assert kwargs["response_format"] == {
        "type": "json_schema",
        "json_schema": schema,
    }


# Every known auto_ai_critique version. ``None`` is the absent/null case, which
# the handler coerces to "3" (``parameters.get("version") or "3"``) — there is no
# version 1 in this handler.
_ALL_VERSIONS = [None, "2", "3", "4", "5"]

# Each mode rendered against a single mode-agnostic template. ``{{question}}`` is
# a variable in mustache/curly/jinja2; fstring uses single braces, so it treats
# ``{{question}}`` as an escaped literal ``{question}`` and substitutes ``{question}``.
# The expected output below is the rendered USER message for the given template.
_MODE_TEMPLATE = "q={question} braces={{question}}"
_MODE_EXPECTED = {
    "mustache": "q={question} braces=Q",
    "curly": "q={question} braces=Q",
    "jinja2": "q={question} braces=Q",
    # fstring substitutes {question} and unescapes {{question}} -> {question}
    "fstring": "q=Q braces={question}",
}


@pytest.mark.parametrize("version", _ALL_VERSIONS)
@pytest.mark.parametrize("mode", ["mustache", "curly", "fstring", "jinja2"])
async def test_each_version_renders_with_each_explicit_mode(
    mocked_secrets, mocked_llm_call, version, mode
):
    """Happy path: every version accepts every explicit template_format.

    The handler applies no per-version restriction on ``template_format`` — an
    explicit format always wins over the version default and routes through that
    renderer regardless of version. This matrix pins all 5 versions x 4 modes so
    a future per-version gate cannot silently change behavior, and so the v5
    mustache default never overrides an explicitly chosen mode.
    """

    mocked_secrets.get_settings.return_value = {
        "model": "gpt-4o-mini",
        "api_key": "sk",
    }

    params = _base_parameters(template_format=mode)
    if version is None:
        params.pop("version", None)
    else:
        params["version"] = version
    params["prompt_template"] = [
        {"role": "user", "content": _MODE_TEMPLATE},
    ]

    await _auto_ai_critique_v0(
        parameters=params,
        inputs={"question": "Q", "expected": "e"},
        outputs="o",
    )

    user_message = mocked_llm_call.captured["kwargs"]["messages"][0]["content"]
    assert user_message == _MODE_EXPECTED[mode]
