"""F4: a harness kind the runtime cannot read must be refused with a shape, at every boundary.

The gate's H1 cell committed `harness.kind` as `12345` and as `"not_a_real_harness"`. Both were
persisted with a 200, and the invoke that followed died on the enum's bare `ValueError`: an
unhandled HTTP 500 whose body was the Python repr, carrying no code a client could act on and
no hint of which field was wrong.

These cases pin the SDK half: `coerce` raises a typed, coded error; parsing a template refuses a
bad kind where the template is read; and the invoke remap turns it into a 400 naming the field
and the harnesses that exist, never a 500. An absent or null kind still means "use the default",
which is what every stored config relies on.

Run: uv run pytest oss/tests/pytest/unit/agents/test_dtos_harness_kind_refusal.py
"""

from __future__ import annotations

import json

import pytest

from agenta.sdk.agents.dtos import (
    AgentTemplate,
    HarnessKind,
    InvalidHarnessKindError,
)
from agenta.sdk.decorators.routing import handle_invoke_failure


def _params(kind):
    return {"agent": {"harness": {"kind": kind}}}


class TestCoerce:
    @pytest.mark.parametrize("value", [12345, "not_a_real_harness", 0, [], {}])
    def test_an_unreadable_kind_raises_the_coded_error(self, value):
        with pytest.raises(InvalidHarnessKindError) as caught:
            HarnessKind.coerce(value)

        assert caught.value.code == 400
        assert "harness.kind" in caught.value.message

    def test_the_message_names_the_value_and_every_harness_that_exists(self):
        with pytest.raises(InvalidHarnessKindError) as caught:
            HarnessKind.coerce("not_a_real_harness")

        message = caught.value.message
        assert "not_a_real_harness" in message
        for kind in HarnessKind:
            assert kind.value in message

    def test_it_is_still_a_value_error(self):
        # The enum has always raised `ValueError` here, and callers guard on that type. The
        # coded error inherits it so those guards keep working.
        with pytest.raises(ValueError):
            HarnessKind.coerce("not_a_real_harness")

    @pytest.mark.parametrize(
        "value,expected",
        [
            ("pi_core", HarnessKind.PI),
            ("PI_CORE", HarnessKind.PI),
            ("claude", HarnessKind.CLAUDE),
            ("codex", HarnessKind.CODEX),
            (HarnessKind.CLAUDE, HarnessKind.CLAUDE),
            # A revision saved while the experiment existed still reads as plain Pi.
            ("pi_agenta", HarnessKind.PI),
        ],
    )
    def test_a_readable_kind_is_unchanged(self, value, expected):
        assert HarnessKind.coerce(value) is expected


class TestTemplateParsing:
    @pytest.mark.parametrize("kind", [12345, "not_a_real_harness", 0])
    def test_a_bad_kind_is_refused_where_the_template_is_read(self, kind):
        # This is the invoke boundary: the handler parses the template before it selects a
        # backend, so a config persisted before the fix fails here rather than at `make_harness`.
        with pytest.raises(InvalidHarnessKindError):
            AgentTemplate.from_params(_params(kind))

    @pytest.mark.parametrize("kind", [None, "", "   "])
    def test_an_absent_kind_still_means_the_default(self, kind):
        # Unchanged behaviour, deliberately: null is how a caller says "whatever the default
        # is", and refusing it would break every config that never set a harness.
        assert (
            AgentTemplate.from_params(_params(kind)).harness == AgentTemplate().harness
        )

    def test_a_template_with_no_harness_section_is_unchanged(self):
        assert (
            AgentTemplate.from_params({"agent": {"instructions": "hi"}}).harness
            == AgentTemplate().harness
        )

    @pytest.mark.parametrize("kind", ["pi_core", "claude", "codex"])
    def test_a_readable_kind_parses_to_itself(self, kind):
        assert AgentTemplate.from_params(_params(kind)).harness == kind

    def test_a_legacy_pi_agenta_revision_still_parses(self):
        # Its stored spelling survives the parse exactly as before; `make_harness` maps it.
        assert AgentTemplate.from_params(_params("pi_agenta")).harness == "pi_agenta"


class TestInvokeRemap:
    async def test_it_answers_400_with_the_field_and_the_allowed_values(self):
        response = await handle_invoke_failure(InvalidHarnessKindError("not_a_harness"))
        body = json.dumps(json.loads(bytes(response.body)))

        assert response.status_code == 400
        assert "harness.kind" in body
        assert "invalid-harness-kind" in body

    async def test_the_bare_value_error_it_replaced_would_have_been_a_500(self):
        # The shape of the defect: an unclassified exception is a 500 whose body is the repr.
        response = await handle_invoke_failure(
            ValueError("'12345' is not a valid HarnessKind")
        )
        assert response.status_code == 500
