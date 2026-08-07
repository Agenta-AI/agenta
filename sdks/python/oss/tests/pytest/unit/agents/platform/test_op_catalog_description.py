"""The ephemeral per-call ``description`` on builder tool calls (R12).

The agent may attach one or two sentences to a builder tool call, saying what the call does and
why. The frontend shows it beside the call. It is NOT the commit message: ``message`` describes the
change in the revision history and is persisted; this describes the call in the conversation and is
never persisted.

The field costs no endpoint schema change. The catalog advertises it, the resolver puts its name on
the spec as an ephemeral argument, and the runner deletes it before it builds the request. These
tests cover the two SDK-side halves: the schema the model sees, and the strip list the runner reads.
The runner's own strip is covered in ``services/runner/tests/unit/tool-direct.test.ts``.

Contract: ``docs/design/agent-config-editing/contracts/read-config.md`` section 12.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents import PlatformToolConfig
from agenta.sdk.agents.platform import (
    PLATFORM_OPS,
    AgentaPlatformToolResolver,
    PlatformOp,
)
from agenta.sdk.agents.platform.op_catalog import (
    EPHEMERAL_DESCRIPTION_ARG,
    EPHEMERAL_DESCRIPTION_MAX_LENGTH,
)


def _resolver(connection):
    return AgentaPlatformToolResolver(connection=connection)


# The builder ops: the playground shows every one of their calls to the human building the agent.
BUILDER_OPS = ["commit_revision", "test_run"]


# --- the model-visible schema -------------------------------------------------


@pytest.mark.parametrize("op_name", BUILDER_OPS)
def test_builder_op_offers_the_description(op_name):
    schema = PLATFORM_OPS[op_name].resolved_input_schema()
    prop = schema["properties"][EPHEMERAL_DESCRIPTION_ARG]
    assert prop["type"] == "string"
    assert prop["maxLength"] == EPHEMERAL_DESCRIPTION_MAX_LENGTH


@pytest.mark.parametrize("op_name", BUILDER_OPS)
def test_the_description_is_never_required(op_name):
    # An agent that says nothing is quieter, not broken.
    schema = PLATFORM_OPS[op_name].resolved_input_schema()
    assert EPHEMERAL_DESCRIPTION_ARG not in schema.get("required", [])


@pytest.mark.parametrize("op_name", BUILDER_OPS)
def test_the_nested_position_is_accepted_and_says_it_is_lifted(op_name):
    # The payload objects are closed, so a note written one level too deep used to be
    # rejected outright and the turn was spent recovering. Advertising the position costs
    # nothing. The wording has to say what happens to the value, or the tolerance reads as
    # a place to store something.
    schema = PLATFORM_OPS[op_name].resolved_input_schema()
    payload_keys = set(schema["properties"]) - {EPHEMERAL_DESCRIPTION_ARG}

    for key in payload_keys:
        nested = schema["properties"][key]
        if not isinstance(nested, dict) or not isinstance(
            nested.get("properties"), dict
        ):
            continue
        tolerated = nested["properties"][EPHEMERAL_DESCRIPTION_ARG]
        assert "never saved" in tolerated["description"]
        assert "top level" in tolerated["description"]


@pytest.mark.parametrize("op_name", BUILDER_OPS)
def test_the_nested_position_is_marked_ephemeral(op_name):
    # The runner decides whether a nested `description` is the endpoint's own field or a
    # misplaced note by reading the advertised schema. Once the tolerated position is
    # advertised, the NAME can no longer tell those apart, and a note read as a real field
    # is neither lifted nor stripped: it reaches the API and is persisted, which is exactly
    # what contract 12.3 forbids. The marker is what keeps that decision machine-readable.
    from agenta.sdk.agents.platform.op_catalog import EPHEMERAL_MARKER

    schema = PLATFORM_OPS[op_name].resolved_input_schema()
    payload_keys = set(schema["properties"]) - {EPHEMERAL_DESCRIPTION_ARG}

    for key in payload_keys:
        nested = schema["properties"][key]
        if not isinstance(nested, dict) or not isinstance(
            nested.get("properties"), dict
        ):
            continue
        assert nested["properties"][EPHEMERAL_DESCRIPTION_ARG][EPHEMERAL_MARKER] is True


def test_a_real_payload_description_is_never_overwritten():
    # Four platform ops carry a genuine `description` inside their payload. None of them
    # accepts the ephemeral note today, which is an accident of the catalog and not an
    # invariant, so the tolerance checks instead of trusting it.
    from agenta.sdk.agents.platform.op_catalog import _tolerate_description

    payload = {
        "type": "object",
        "properties": {
            "description": {"type": "string", "description": "the real one"}
        },
    }

    _tolerate_description(payload)

    assert payload["properties"]["description"]["description"] == "the real one"


@pytest.mark.parametrize("op_name", BUILDER_OPS)
def test_the_field_says_where_it_goes(op_name):
    # The schema already shows the placement, and models nested the field inside the
    # payload object anyway. The envelope is closed, so the call is rejected and the turn
    # is spent recovering. Live QA lost a round trip to this twice in a row.
    schema = PLATFORM_OPS[op_name].resolved_input_schema()
    said = schema["properties"][EPHEMERAL_DESCRIPTION_ARG]["description"]
    payload_keys = set(schema["properties"]) - {EPHEMERAL_DESCRIPTION_ARG}

    assert "top level" in said
    # Every sibling is named, so the advice is exact for this op and not a generic hint.
    for key in payload_keys:
        assert f"`{key}`" in said


def test_the_placement_advice_follows_a_renamed_key():
    # The sentence is generated from the op's own keys. A hard-coded key would keep
    # pointing at a name that no longer exists, and the model would follow it.
    from agenta.sdk.agents.platform.op_catalog import _ephemeral_description_schema

    assert (
        "`only_child`" in _ephemeral_description_schema(["only_child"])["description"]
    )
    both = _ephemeral_description_schema(["first", "second"])["description"]
    assert "`first`" in both and "`second`" in both
    # It names the preferred position without forbidding the other one, which is now
    # accepted and lifted. Advice the schema contradicts teaches a model nothing.
    assert "never inside" not in both


def test_a_non_builder_op_does_not_offer_it():
    # Off by default: an op whose calls no human reads gains nothing from a note.
    schema = PLATFORM_OPS["discover_tools"].resolved_input_schema()
    assert EPHEMERAL_DESCRIPTION_ARG not in schema["properties"]
    assert PLATFORM_OPS["discover_tools"].ephemeral_args is None


def test_the_injection_does_not_leak_between_reads():
    # `resolved_input_schema` must return a fresh tree each call; a shared sub-object would let
    # one caller's edit reach the next one.
    first = PLATFORM_OPS["commit_revision"].resolved_input_schema()
    first["properties"][EPHEMERAL_DESCRIPTION_ARG]["maxLength"] = 1
    second = PLATFORM_OPS["commit_revision"].resolved_input_schema()
    assert (
        second["properties"][EPHEMERAL_DESCRIPTION_ARG]["maxLength"]
        == EPHEMERAL_DESCRIPTION_MAX_LENGTH
    )


def test_the_catalog_schema_stays_closed():
    # The catalog schemas forbid unknown keys, so the field must be advertised or the model
    # cannot send it at all. This pins the reason the injection exists.
    schema = PLATFORM_OPS["commit_revision"].resolved_input_schema()
    assert schema["additionalProperties"] is False


# --- the strip list on the spec ----------------------------------------------


@pytest.mark.parametrize("op_name", BUILDER_OPS)
def test_the_op_declares_the_ephemeral_argument(op_name):
    assert PLATFORM_OPS[op_name].ephemeral_args == [EPHEMERAL_DESCRIPTION_ARG]


@pytest.mark.parametrize("op_name", BUILDER_OPS)
async def test_the_resolver_puts_the_strip_list_on_the_spec(connection, op_name):
    resolution = await _resolver(connection).resolve([PlatformToolConfig(op=op_name)])
    spec = resolution.tool_specs[0]
    assert spec.ephemeral_args == [EPHEMERAL_DESCRIPTION_ARG]


async def test_both_dispatch_modes_carry_the_strip_list(connection):
    # `commit_revision` is endpoint mode (a direct `call`); `test_run` is handler mode (a
    # `call_ref`). Both must strip, so both must carry the list.
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="commit_revision"), PlatformToolConfig(op="test_run")]
    )
    by_name = {spec.name: spec for spec in resolution.tool_specs}
    assert by_name["commit_revision"].call is not None
    assert by_name["commit_revision"].ephemeral_args == [EPHEMERAL_DESCRIPTION_ARG]
    assert by_name["test_run"].call_ref == "tools.agenta.test_run"
    assert by_name["test_run"].ephemeral_args == [EPHEMERAL_DESCRIPTION_ARG]


async def test_a_non_builder_spec_carries_no_strip_list(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="discover_tools")]
    )
    assert resolution.tool_specs[0].ephemeral_args is None


# --- the wire ----------------------------------------------------------------


async def test_the_strip_list_rides_the_wire_as_camel_case(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="commit_revision")]
    )
    wire = resolution.tool_specs[0].to_wire()
    assert wire["ephemeralArgs"] == [EPHEMERAL_DESCRIPTION_ARG]


async def test_the_wire_omits_the_field_when_there_is_nothing_to_strip(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="discover_tools")]
    )
    assert "ephemeralArgs" not in resolution.tool_specs[0].to_wire()


# --- the flag itself ----------------------------------------------------------


def test_the_flag_is_off_by_default():
    op = PlatformOp(
        op="x",
        description="d",
        method="POST",
        path="/api/x",
        input_schema={
            "type": "object",
            "additionalProperties": False,
            "properties": {},
        },
    )
    assert op.accepts_description is False
    assert op.ephemeral_args is None
    assert EPHEMERAL_DESCRIPTION_ARG not in op.resolved_input_schema()["properties"]
