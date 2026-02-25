import logging

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


def test_handlers_jinja2_blocks_ssti_payload(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING):
        result = _format_with_template(
            content=SSTI_PAYLOAD,
            format="jinja2",
            kwargs={},
        )

    assert result == SSTI_PAYLOAD
    assert any("sandbox violation" in r.message for r in caplog.records)


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
