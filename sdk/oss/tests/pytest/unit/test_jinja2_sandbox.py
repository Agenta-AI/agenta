from unittest.mock import patch

import pytest

from agenta.sdk.types import PromptTemplate, TemplateFormatError
from agenta.sdk.workflows.handlers import _format_with_template


SSTI_PAYLOAD = "{{ lipsum.__globals__['os'].popen('id').read() }}"


def test_handlers_jinja2_renders_safe_template() -> None:
    result = _format_with_template(
        content="Hello {{ name }}",
        format="jinja2",
        kwargs={"name": "alice"},
    )

    assert result == "Hello alice"


def test_handlers_jinja2_blocks_ssti_payload() -> None:
    # The SDK uses a structlog-based MultiLogger with propagate=False, so records
    # don't flow through the standard logging hierarchy (caplog won't see them)
    # and the StreamHandler holds a reference to the pre-test sys.stdout (capsys
    # won't see them either). Patch the module-level logger directly instead.
    with patch("agenta.sdk.workflows.handlers.log") as mock_log:
        result = _format_with_template(
            content=SSTI_PAYLOAD,
            format="jinja2",
            kwargs={},
        )

    assert result == SSTI_PAYLOAD
    assert mock_log.warning.called
    warning_msg = mock_log.warning.call_args[0][0]
    assert "sandbox violation" in warning_msg


def test_prompt_template_jinja2_renders_safe_template() -> None:
    template = PromptTemplate(template_format="jinja2")

    result = template._format_with_template(
        content="Hello {{ name }}",
        kwargs={"name": "alice"},
    )

    assert result == "Hello alice"


def test_prompt_template_jinja2_blocks_ssti_payload() -> None:
    template = PromptTemplate(template_format="jinja2")

    with pytest.raises(TemplateFormatError):
        template._format_with_template(content=SSTI_PAYLOAD, kwargs={})
