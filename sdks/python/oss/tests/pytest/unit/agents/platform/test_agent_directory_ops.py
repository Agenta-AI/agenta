"""The four ops that reach OTHER agents: `list_agents`, `read_agent_config`, `create_agent` and
`edit_agent_config`.

They are used by small, cheap models, so what the model sees is pinned here: a flat schema
with the bound caller fields stripped, the ordered operations `commit_revision` takes, and
descriptions that say when to use these and when to use the self tools.
"""

from __future__ import annotations

import logging

import jsonschema
import pytest

from agenta.sdk.agents.platform import AgentaPlatformToolResolver
from agenta.sdk.agents.platform.op_catalog import (
    _COMMIT_REVISION_INPUT_SCHEMA,
    get_platform_op,
)
from agenta.sdk.agents.tools import AGENTA_TOOLS, PlatformToolConfig

AGENT_OPS = ("list_agents", "read_agent_config", "create_agent", "edit_agent_config")
OPERATION_ITEMS = _COMMIT_REVISION_INPUT_SCHEMA["properties"]["workflow_revision"][
    "properties"
]["delta"]["properties"]["operations"]["items"]


def _schema(op: str) -> dict:
    return get_platform_op(op).resolved_input_schema()


def test_the_model_sees_flat_small_schemas_with_the_caller_stripped():
    assert set(_schema("list_agents")["properties"]) == {
        "cursor",
        "limit",
        "include_archived",
    }
    assert "required" not in _schema("list_agents")

    read = _schema("read_agent_config")
    assert set(read["properties"]) == {"agent", "path", "max_bytes"}
    assert read["required"] == ["agent"]

    create = _schema("create_agent")
    assert set(create["properties"]) == {"name", "description", "operations"}
    assert create["required"] == ["name"]

    edit = _schema("edit_agent_config")
    assert set(edit["properties"]) == {"agent", "base_revision_id", "operations"}
    assert edit["required"] == ["agent", "base_revision_id", "operations"]

    # No commit message anywhere: the server writes it, with the attribution.
    for op in AGENT_OPS:
        assert "message" not in _schema(op)["properties"]
        assert _schema(op)["additionalProperties"] is False


def test_the_operations_are_the_ones_commit_revision_takes():
    for op in ("create_agent", "edit_agent_config"):
        operations = _schema(op)["properties"]["operations"]
        assert operations["type"] == "array"
        assert operations["items"] == OPERATION_ITEMS


def test_the_examples_in_the_descriptions_are_valid_calls():
    jsonschema.validate({"agent": "invoice-helper-k3x9"}, _schema("read_agent_config"))
    jsonschema.validate(
        {
            "agent": "invoice-helper-k3x9",
            "path": ["parameters", "agent", "instructions"],
        },
        _schema("read_agent_config"),
    )
    jsonschema.validate(
        {
            "name": "Invoice helper",
            "description": "Answers questions about invoices.",
            "operations": [
                {
                    "operation": "set",
                    "target": ["parameters", "agent", "instructions", "agents_md"],
                    "value": "You answer questions about our invoices.",
                }
            ],
        },
        _schema("create_agent"),
    )
    jsonschema.validate(
        {
            "agent": "invoice-helper-k3x9",
            "base_revision_id": "r1",
            "operations": [
                {
                    "operation": "edit_text",
                    "target": ["parameters", "agent", "instructions", "agents_md"],
                    "edits": [{"old_text": "a", "new_text": "b"}],
                }
            ],
        },
        _schema("edit_agent_config"),
    )
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate({"name": "   "}, _schema("create_agent"))


def test_the_descriptions_send_the_model_to_the_self_tools_for_itself():
    assert "read_config" in get_platform_op("read_agent_config").description
    assert "commit_revision" in get_platform_op("edit_agent_config").description
    edit = get_platform_op("edit_agent_config").description
    # Self-sufficient: an agent with only these tools still learns the operations.
    for word in ("TARGET", "OPERATIONS", "edit_text", "read_agent_config", "conflict"):
        assert word in edit
    # File markers resolve only on commit_revision's shape; these tools say so and never
    # show the marker form.
    for op in ("create_agent", "edit_agent_config"):
        description = get_platform_op(op).description
        assert "`@ag.file` is not resolved here" in description
        assert '{"@ag.file"' not in description


def test_create_points_at_edit_for_the_operation_shape():
    # The full reference lives in `edit_agent_config` only; create shows one example.
    create = get_platform_op("create_agent").description
    assert "the same shape as in `edit_agent_config`" in create
    assert "These are the only fields" in create
    assert "OPERATIONS:" not in create
    # A retry with the same arguments finishes the same agent.
    assert "never makes a second one" in create


@pytest.mark.parametrize(
    "op", ["read_agent_config", "edit_agent_config"], ids=["read", "edit"]
)
def test_the_agent_is_the_slug_or_id_not_the_display_name(op):
    assert "not the display name" in get_platform_op(op).description


def test_the_shapes_the_models_went_hunting_for_are_in_the_edit_description():
    description = " ".join(get_platform_op("edit_agent_config").description.split())
    # Generated from AGENTA_TOOLS, so a new tool cannot be missing from the list.
    names = description.split('Agenta tools (value "allow" or "ask"): ')[1]
    assert names.split(".")[0].split(", ") == list(AGENTA_TOOLS)
    assert '{"name", "description", "body"}, all three required' in description
    assert "When `skills` is missing, `set` it to a list." in description
    assert '{"list":"tools","key":"agenta_tools"}' in description


@pytest.mark.parametrize("op", ["commit_revision", "create_agent", "edit_agent_config"])
def test_no_em_dash_reaches_the_model(op):
    assert "\u2014" not in get_platform_op(op).description


def test_commit_revision_keeps_its_measured_size_plus_the_agenta_tools_key():
    commit = get_platform_op("commit_revision").description
    assert "the agenta_tools entry is keyed agenta_tools" in commit
    assert "Agenta tools (value" not in commit
    assert len(commit) < 2500


def test_the_agenta_tools_example_is_a_valid_operation():
    jsonschema.validate(
        {
            "operation": "set",
            "target": [
                "parameters",
                "agent",
                {"list": "tools", "key": "agenta_tools"},
                "tools",
                "create_schedule",
            ],
            "value": "allow",
        },
        OPERATION_ITEMS,
    )


def test_name_and_description_carry_no_invented_length_limit():
    properties = _schema("create_agent")["properties"]
    assert "maxLength" not in properties["name"]
    assert "maxLength" not in properties["description"]


async def test_the_resolved_spec_carries_the_call_ref_and_the_bindings(connection):
    resolution = await AgentaPlatformToolResolver(connection=connection).resolve(
        [PlatformToolConfig(op=op) for op in AGENT_OPS]
    )
    by_name = {spec.name: spec for spec in resolution.tool_specs}

    edit = by_name["edit_agent_config"].to_wire()
    assert edit["callRef"] == "tools.agenta.edit_agent_config"
    assert edit["contextBindings"] == {
        "caller_agent_id": "$ctx.workflow.artifact.id",
        "caller_session_id": "$ctx.session.id",
    }
    assert "caller_agent_id" not in edit["inputSchema"]["properties"]
    assert by_name["list_agents"].read_only is True


async def test_the_handler_switch_removes_them_and_keeps_the_rest(
    connection, monkeypatch, caplog
):
    # The only gate on these ops: they are handler mode, so the platform-handlers switch
    # removes them. Unlike `read_config` they are optional, so the run still starts.
    monkeypatch.setenv("AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS", "false")
    caplog.set_level(logging.WARNING)

    resolution = await AgentaPlatformToolResolver(connection=connection).resolve(
        [PlatformToolConfig(op=op) for op in AGENT_OPS]
        + [PlatformToolConfig(op="discover_tools")]
    )

    assert [spec.name for spec in resolution.tool_specs] == ["discover_tools"]
