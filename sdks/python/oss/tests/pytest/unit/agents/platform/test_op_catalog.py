"""The platform-op catalog and its resolver (direct-call tools, Phase 3b).

A ``type:"platform"`` tool exposes an EXISTING Agenta endpoint to the agent. The catalog
(``op_catalog.py``) owns the description, the endpoint, the input schema, the run-context bindings,
and the per-op default permission/approval; the resolver (``AgentaPlatformToolResolver``) turns each
config into a ``CallbackToolSpec`` carrying a direct ``call`` descriptor (no ``/tools/call`` hop).

These tests cover: the catalog model's import-time validation, the resolver emitting a direct
``call`` (discover_tools), the self-update ``context_bindings`` stripping its bound field from the
model-visible schema, the catalog's permission/approval defaults and the config override, and the
error paths (unknown op, missing API base).
"""

from __future__ import annotations

import json
from copy import deepcopy
import logging

import jsonschema
import pytest
from pydantic import ValidationError

from agenta.sdk.agents import PlatformToolConfig
from agenta.sdk.agents.platform import op_catalog
from agenta.sdk.agents.platform import (
    PLATFORM_OPS,
    AgentaPlatformToolResolver,
    PlatformConnection,
    PlatformOp,
    get_platform_op,
)
from agenta.sdk.agents.tools import GatewayToolResolutionError, UnknownPlatformOpError


def _resolver(connection):
    return AgentaPlatformToolResolver(connection=connection)


# --- catalog model ------------------------------------------------------------


def test_catalog_ships_platform_builder_ops():
    assert set(PLATFORM_OPS) == {
        "discover_tools",
        "query_workflows",
        "query_spans",
        "test_run",
        "commit_revision",
        "annotate_trace",
        "discover_triggers",
        "create_schedule",
        "create_subscription",
        "list_schedules",
        "list_subscriptions",
        "list_deliveries",
        "list_connections",
        "test_subscription",
        "remove_schedule",
        "remove_subscription",
        "pause_schedule",
        "resume_schedule",
        "pause_subscription",
        "resume_subscription",
    }


def test_reserved_id_uses_the_tools_agenta_namespace():
    # Mirrors the reserved `tools.agenta.discover_tools` precedent (PR #4884).
    assert get_platform_op("discover_tools").reserved_id == (
        "tools.agenta.discover_tools"
    )


def test_op_requires_exactly_one_schema_source():
    with pytest.raises(ValidationError):
        PlatformOp(op="x", description="d", method="POST", path="/api/x")
    with pytest.raises(ValidationError):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            path="/api/x",
            input_schema={"type": "object"},
            input_schema_ref="messages",
        )


def test_op_input_schema_ref_must_be_a_known_catalog_key():
    with pytest.raises(ValidationError, match="CATALOG_TYPES"):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            path="/api/x",
            input_schema_ref="not-a-real-type",
        )


def test_op_requires_exactly_one_target_mode():
    with pytest.raises(ValidationError, match="method.*path.*handler"):
        PlatformOp(op="x", description="d", input_schema={"type": "object"})
    with pytest.raises(ValidationError, match="method.*path.*handler"):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            path="/api/x",
            handler="tools.agenta.test_run",
            input_schema={"type": "object"},
        )
    with pytest.raises(ValidationError, match="method.*path"):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            input_schema={"type": "object"},
        )


def test_op_handler_must_be_allowlisted():
    with pytest.raises(ValidationError, match="allowlisted"):
        PlatformOp(
            op="x",
            description="d",
            handler="tools.agenta.unknown",
            input_schema={"type": "object"},
        )
    # The allowlist is an exact match, not a prefix match: an extension of an
    # allowlisted ref is still rejected.
    with pytest.raises(ValidationError, match="allowlisted"):
        PlatformOp(
            op="x",
            description="d",
            handler="tools.agenta.test_run_extra",
            input_schema={"type": "object"},
        )


def test_op_input_schema_ref_resolves_against_the_catalog():
    # A whole-op schema named by a CATALOG_TYPES key expands to that concrete type (no marker left).
    op = PlatformOp(
        op="x",
        description="d",
        method="POST",
        path="/api/x",
        input_schema_ref="messages",
    )
    schema = op.resolved_input_schema()
    assert "x-ag-type-ref" not in schema
    # `messages` is an array catalog type; expansion yields its concrete structure.
    assert schema.get("type") == "array"


def test_op_path_must_be_a_single_absolute_path():
    with pytest.raises(ValidationError):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            path="api/x",
            input_schema={"type": "object"},
        )
    with pytest.raises(ValidationError):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            path="//evil",
            input_schema={"type": "object"},
        )


def test_op_context_binding_token_must_be_a_ctx_reference():
    with pytest.raises(ValidationError, match=r"\$ctx"):
        PlatformOp(
            op="x",
            description="d",
            method="POST",
            path="/api/x",
            input_schema={"type": "object"},
            context_bindings={"field": "workflow.variant.id"},  # missing $ctx. prefix
        )


def test_unknown_op_raises_typed_error():
    with pytest.raises(UnknownPlatformOpError) as caught:
        get_platform_op("does_not_exist")
    assert caught.value.op == "does_not_exist"
    # The available ops are listed so the message is actionable.
    assert "discover_tools" in str(caught.value)


# --- resolver: discover_tools emits a direct call --------------------------


async def test_discover_tools_emits_a_direct_call(connection):
    # THE deferred item (PR #4884): discover_tools becomes agent-usable as a direct call to
    # POST /api/tools/discover, instead of the server-side /tools/call tools.agenta.* dispatch.
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="discover_tools")]
    )
    assert len(resolution.tool_specs) == 1
    spec = resolution.tool_specs[0]
    assert spec.kind == "callback"
    assert spec.name == "discover_tools"
    # A direct call, NOT a gateway call_ref (the `call` XOR `call_ref` rule).
    assert spec.call_ref is None
    assert spec.call is not None
    assert spec.call.method == "POST"
    assert spec.call.path == "/api/tools/discover"
    assert spec.call.context is None  # no run-context binding for a plain read
    # The model-visible input schema is the discover request contract.
    assert set(spec.input_schema["properties"]) == {
        "use_cases",
        "provider",
        "limit_alternatives",
    }
    assert spec.input_schema["required"] == ["use_cases"]
    assert spec.read_only is True
    assert spec.effective_permission() is None
    # The shared callback gives the runner the origin to resolve the relative path against.
    assert resolution.tool_callback.endpoint == "https://api.x/api/tools/call"
    assert resolution.tool_callback.authorization == "Access tok"


async def test_discover_tools_wire_carries_call_not_call_ref(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="discover_tools")]
    )
    wire = resolution.tool_specs[0].to_wire()
    assert wire["kind"] == "callback"
    assert "callRef" not in wire
    assert wire["call"]["path"] == "/api/tools/discover"


async def test_test_run_emits_handler_call_ref_with_bindings_and_timeout_by_default(
    connection,
):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="test_run")]
    )
    spec = resolution.tool_specs[0]

    assert spec.kind == "callback"
    assert spec.name == "test_run"
    assert spec.call is None
    assert spec.call_ref == "tools.agenta.test_run"
    assert spec.context_bindings == {
        "target.workflow_variant_id": "$ctx.workflow.variant.id"
    }
    assert spec.timeout_ms == 120000
    assert spec.read_only is False
    assert spec.effective_permission() is None
    assert "target" not in spec.input_schema["properties"]
    assert set(spec.input_schema["properties"]) == {
        "inputs",
        "delta",
        "expectations",
    }
    assert spec.input_schema["required"] == ["inputs"]
    assert spec.input_schema["properties"]["inputs"]["required"] == ["messages"]
    # The verdict enum is spelled out in the description so its meaning survives even when
    # the skill is not loaded (see docs/design/.../part-3-agenta-skills-sync.md, B5).
    for verdict_word in ("pass", "incomplete", "unconfirmed", "failed"):
        assert verdict_word in spec.description

    wire = spec.to_wire()
    assert wire["callRef"] == "tools.agenta.test_run"
    assert wire["contextBindings"] == {
        "target.workflow_variant_id": "$ctx.workflow.variant.id"
    }
    assert wire["timeoutMs"] == 120000
    assert "call" not in wire


@pytest.mark.parametrize(
    "disabled_value",
    ["false", "0", "f", "n", "no", "off", "disable", "disabled", " OFF "],
)
async def test_platform_handlers_flag_off_skips_handler_ops_and_keeps_endpoint_ops(
    connection, monkeypatch, caplog, disabled_value
):
    monkeypatch.setenv("AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS", disabled_value)
    caplog.set_level(logging.WARNING)

    resolution = await _resolver(connection).resolve(
        [
            PlatformToolConfig(op="test_run"),
            PlatformToolConfig(op="discover_tools"),
        ]
    )

    assert [spec.name for spec in resolution.tool_specs] == ["discover_tools"]
    assert resolution.tool_callback.endpoint == "https://api.x/api/tools/call"
    assert "skipping platform handler-mode op 'test_run'" in caplog.text
    assert "AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS" in caplog.text


async def test_platform_handlers_empty_flag_uses_default_on(connection, monkeypatch):
    monkeypatch.setenv("AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS", "")

    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="test_run")]
    )

    assert [spec.name for spec in resolution.tool_specs] == ["test_run"]


async def test_query_spans_emits_project_scoped_read_call(connection):
    # Project scoping comes from the caller credential on the endpoint; there is no target field
    # for the model to supply and no run-context binding to inject.
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="query_spans")]
    )
    spec = resolution.tool_specs[0]
    assert spec.kind == "callback"
    assert spec.name == "query_spans"
    assert spec.call_ref is None
    assert spec.call.method == "POST"
    assert spec.call.path == "/api/spans/query"
    assert spec.call.context is None
    assert spec.read_only is True
    assert spec.effective_permission() is None

    assert set(spec.input_schema["properties"]) == {
        "filtering",
        "windowing",
        "query_ref",
        "query_variant_ref",
        "query_revision_ref",
    }
    assert "required" not in spec.input_schema
    assert {
        "focus",
        "format",
        "filter",
        "oldest",
        "newest",
        "limit",
        "rate",
    }.isdisjoint(spec.input_schema["properties"])

    # The filtering DSL is no longer inlined as `$defs` — it lives in `references/span-queries.md`
    # and the arguments are advertised as open objects. Nothing may re-expand here.
    assert "$defs" not in spec.input_schema
    assert "$ref" not in json.dumps(spec.input_schema)


def test_query_spans_advertises_open_dsl_arguments_with_the_vocabulary_in_prose():
    """The DSL's *vocabulary* has to survive the trim, or the model cannot write a query.

    ~1,150 tokens of `$defs` became prose on the two arguments that carry the DSL. The operator
    names and the condition shape stay in the advertisement — enough to write the common
    verification query without opening the reference — and the reference carries the rest."""
    schema = get_platform_op("query_spans").resolved_input_schema()

    filtering = schema["properties"]["filtering"]
    assert filtering["type"] == "object"
    # Open: no `properties`, no `required`, no closed object.
    assert set(filtering) == {"type", "description"}
    for operator in ("is_not", "gte", "startswith", "has_not", "not_in", "not_exists"):
        assert operator in filtering["description"], operator
    for logical in ("and", "or", "nand"):
        assert f"`{logical}`" in filtering["description"], logical
    assert "trace_id" in filtering["description"]
    assert "references/span-queries.md" in filtering["description"]

    windowing = schema["properties"]["windowing"]
    for field in ("oldest", "newest", "limit", "order", "next"):
        assert field in windowing["description"], field


def test_query_spans_accepts_the_full_dsl_it_stopped_describing():
    """The trim only removes constraints: every query the typed `$defs` accepted still validates."""
    schema = get_platform_op("query_spans").resolved_input_schema()

    jsonschema.validate(
        {
            "filtering": {
                "operator": "and",
                "conditions": [
                    {"field": "trace_id", "operator": "is", "value": "abc"},
                    {
                        "operator": "or",
                        "conditions": [
                            {
                                "field": "attributes",
                                "key": "ag.type",
                                "operator": "has",
                                "value": {"x": 1},
                            },
                            {
                                "field": "span_name",
                                "operator": "contains",
                                "value": "tool",
                                "options": {"case_sensitive": False},
                            },
                        ],
                    },
                ],
            },
            "windowing": {
                "oldest": "2026-07-01T00:00:00Z",
                "newest": "2026-07-02T00:00:00Z",
                "limit": 50,
                "order": "descending",
            },
            "query_ref": {"slug": "saved", "version": "1"},
        },
        schema,
    )


def test_span_queries_reference_ships_with_the_build_an_agent_skill():
    # The prose the schema now points at has to actually be on disk for the agent, and the skill
    # body has to tell it to read the file — the same contract `config-schema.md` has.
    from agenta.sdk.agents.adapters.agenta_builtins import BUILD_AN_AGENT_SKILL

    by_path = {file.path: file.content for file in BUILD_AN_AGENT_SKILL.files}
    assert "references/span-queries.md" in by_path
    reference = by_path["references/span-queries.md"]
    for operator in ("startswith", "not_exists", "btwn", "nand"):
        assert operator in reference, operator
    assert "references/span-queries.md" in BUILD_AN_AGENT_SKILL.body


# --- resolver: commit_revision self-update binds + strips ---------------------


async def test_commit_revision_binds_self_and_strips_bound_field(connection):
    # "Update myself": the running variant id is bound from run context and stripped from the
    # model-visible schema, so the model supplies only the payload and can never retarget.
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="commit_revision")]
    )
    spec = resolution.tool_specs[0]
    assert spec.call.path == "/api/workflows/revisions/commit"
    # The context binding rides as call.context — the runner fills it from runContext at dispatch.
    assert spec.call.context == {
        "workflow_revision.workflow_variant_id": "$ctx.workflow.variant.id"
    }
    # The bound field is gone from the model-visible schema (and its `required`); the payload fields
    # the model SHOULD supply remain.
    workflow_revision = spec.input_schema["properties"]["workflow_revision"]
    assert "workflow_variant_id" not in workflow_revision["properties"]
    assert set(workflow_revision["properties"]) == {"message", "delta"}
    assert workflow_revision["required"] == ["delta"]
    delta = workflow_revision["properties"]["delta"]
    assert set(delta["properties"]) == {"set", "remove"}
    assert "parameters.agent" in delta["properties"]["set"]["description"]
    # Lists (tools, skills, mcps) replace wholesale on deep-merge; the description must warn
    # the model to resend the complete list or it wipes its own build-kit tools (B2).
    assert "wholesale" in spec.description
    assert "revision id" in spec.description


async def test_commit_revision_is_not_read_only(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="commit_revision")]
    )
    spec = resolution.tool_specs[0]
    assert spec.read_only is False
    assert spec.effective_permission() is None


# --- delta.set carries the typed agent-template shape -------------------------


def _iter_required_lists(node):
    """Yield every JSON-Schema `required` array reachable under `node`."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "required" and isinstance(value, list):
                yield value
            else:
                yield from _iter_required_lists(value)
    elif isinstance(node, list):
        for item in node:
            yield from _iter_required_lists(item)


def _has_embed_branch(items):
    """True when a list-item schema accepts the `@ag.embed` object alternative."""
    branches = items.get("anyOf") if isinstance(items, dict) else None
    if not isinstance(branches, list):
        return False
    return any(
        isinstance(branch, dict)
        and isinstance(branch.get("properties"), dict)
        and "@ag.embed" in branch["properties"]
        for branch in branches
    )


def _commit_agent_subtree():
    schema = get_platform_op("commit_revision").resolved_input_schema()
    delta = schema["properties"]["workflow_revision"]["properties"]["delta"]
    return delta["properties"]["set"]["properties"]["parameters"]["properties"]["agent"]


def _test_run_agent_subtree():
    schema = get_platform_op("test_run").resolved_input_schema()
    delta = schema["properties"]["delta"]
    return delta["properties"]["set"]["properties"]["parameters"]["properties"]["agent"]


AGENT_TEMPLATE_TOP_LEVEL_KEYS = {
    "instructions",
    "llm",
    "tools",
    "mcps",
    "skills",
    "harness",
    "runner",
    "sandbox",
}


def test_commit_revision_delta_set_advertises_the_shallow_agent_template():
    # (a) The advertised agent shape is the top-level keys plus one-liners — the model still learns
    # what a `parameters.agent` payload contains from the schema, but the ~6.4k-token expansion of
    # every subtree is replaced by a pointer to the reference doc that already ships with the skill.
    agent = _commit_agent_subtree()
    assert agent["type"] == "object"
    assert set(agent["properties"]) == AGENT_TEMPLATE_TOP_LEVEL_KEYS
    for name, node in agent["properties"].items():
        # A collapsed node carries its type and a one-liner and nothing else: no `properties`, no
        # `items`, no `enum`, no `required`, no `additionalProperties`.
        assert set(node) <= {"type", "description"}, name
        assert node.get("description", "").strip(), name
    assert "references/config-schema.md" in agent["description"]
    # Type-refs are still expanded before the projection, so no marker leaks to the model.
    assert "x-ag-type-ref" not in json.dumps(agent["properties"])


def test_commit_revision_delta_set_agent_subtree_has_no_required():
    # (b) A delta is a deep partial: EVERY field is optional, so no `required` array may survive
    # anywhere under the agent subtree, or a schema-following harness would think it must resend
    # every required field just to change one.
    agent = _commit_agent_subtree()
    assert list(_iter_required_lists(agent)) == []


def test_commit_revision_delta_set_states_the_wholesale_list_and_embed_rule_in_prose():
    # (c) tools/skills/mcps may hold `@ag.embed` build-kit entries, and the model re-sends the whole
    # list. The full schema carried that structurally (an embed arm on each item schema); collapsed,
    # the one-liner must carry it, or the model drops the embeds and wipes its own build-kit tools.
    agent = _commit_agent_subtree()
    for field in ("tools", "skills", "mcps"):
        description = agent["properties"][field]["description"]
        assert "wholesale" in description, field
        assert "@ag.embed" in description, field


def test_test_run_delta_set_matches_commit_revision():
    # (d) test_run's uncommitted delta advertises the identical projection — one source, two ops.
    assert _test_run_agent_subtree() == _commit_agent_subtree()


def test_shallow_agent_template_summaries_cover_every_key():
    # The one-liners are written for this schema rather than clipped from the source docstrings, so
    # a key added to (or dropped from) the catalog type must be reflected here. This is the drift
    # that matters: a new agent-template field silently missing from the advertised schema.
    assert (
        set(op_catalog._AGENT_TEMPLATE_FIELD_SUMMARIES) == AGENT_TEMPLATE_TOP_LEVEL_KEYS
    )
    assert (
        set(op_catalog._AGENT_TEMPLATE_DELTA_SCHEMA_FULL["properties"])
        == AGENT_TEMPLATE_TOP_LEVEL_KEYS
    )


def test_commit_revision_resolved_schema_size_is_bounded():
    # (e) The diet's own regression guard. Pre-diet this schema was ~24k characters (~6.9k tokens)
    # because it inlined the whole agent-template tree; the projection has to keep it small, and a
    # re-expansion (or a runaway type-ref) has to fail here rather than in a token bill.
    schema = get_platform_op("commit_revision").resolved_input_schema()
    size = len(json.dumps(schema))
    assert size < 6_000, size


def test_advertised_op_schemas_match_the_golden(golden):
    """The cross-language anchor for the two dieted ops.

    The runner's Pi and MCP tests read this same file (`tests/utils/shallow-op-schema.ts`) to
    check that a deeply nested config is not rejected pre-relay, so a change to either schema has
    to be made deliberately here rather than silently drifting the two sides apart. Same pattern as
    the `/run` wire contract goldens. Regenerate with the snippet in that TS module's header."""
    expected = golden("advertised_op_schemas.json")
    actual = {
        op: get_platform_op(op).resolved_input_schema()
        for op in ("commit_revision", "test_run")
    }
    assert actual == expected


# --- the depth limit itself ---------------------------------------------------
#
# The projection's one load-bearing property: it may only ever REMOVE constraints. Both harnesses
# validate a call against the advertised schema before it reaches the relay (Pi at
# extensions/agenta.ts, the MCP client against tools/list), so a projection that tightened anything
# would reject a payload the model was right to send, with no server-side recourse.


def test_shallow_schema_collapses_below_the_depth_limit():
    source = {
        "type": "object",
        "additionalProperties": False,
        "required": ["kept"],
        "properties": {
            "kept": {
                "type": "object",
                "description": "A one-liner.",
                "additionalProperties": False,
                "required": ["gone"],
                "properties": {"gone": {"type": "string", "enum": ["a", "b"]}},
            }
        },
    }

    projected = op_catalog._shallow_schema(source, max_depth=1)

    # The root keeps its own constraints; the child collapses to type + description.
    assert projected["required"] == ["kept"]
    assert projected["additionalProperties"] is False
    assert projected["properties"]["kept"] == {
        "type": "object",
        "description": "A one-liner.",
    }
    # Pure: the source is not mutated.
    assert source["properties"]["kept"]["required"] == ["gone"]


def test_shallow_schema_counts_items_as_a_level_but_not_union_branches():
    source = {
        "type": "object",
        "properties": {
            "list": {
                "type": "array",
                "items": {"type": "object", "properties": {"deep": {"type": "string"}}},
            }
        },
    }

    # `properties.list` is depth 1, so at max_depth=2 its `items` collapse.
    projected = op_catalog._shallow_schema(source, max_depth=2)
    assert projected["properties"]["list"]["items"] == {"type": "object"}

    # A union is one node spelled several ways, so its branches are projected at the SAME depth as
    # the union itself — otherwise wrapping a subtree in `anyOf` would silently buy it a level.
    subtree = {
        "type": "object",
        "properties": {"deep": {"type": "object", "properties": {"deeper": {}}}},
    }
    bare = {"type": "object", "properties": {"x": deepcopy(subtree)}}
    wrapped = {
        "type": "object",
        "properties": {"x": {"anyOf": [deepcopy(subtree), {"type": "null"}]}},
    }

    projected_bare = op_catalog._shallow_schema(bare, max_depth=2)
    projected_wrapped = op_catalog._shallow_schema(wrapped, max_depth=2)

    # `deep` sits two levels down either way, so it collapses either way.
    assert projected_bare["properties"]["x"]["properties"]["deep"] == {"type": "object"}
    assert projected_wrapped["properties"]["x"]["anyOf"][0]["properties"]["deep"] == {
        "type": "object"
    }
    assert projected_wrapped["properties"]["x"]["anyOf"][1] == {"type": "null"}


def test_shallow_schema_drops_type_on_a_collapsed_union():
    # `anyOf: [object, null]` accepts null. Keeping `type: "object"` while dropping the union would
    # newly REJECT null — the one way a depth limit can tighten a schema.
    source = {
        "type": "object",
        "properties": {
            "nullable": {
                "type": "object",
                "anyOf": [{"type": "object"}, {"type": "null"}],
                "description": "May be null.",
            }
        },
    }

    projected = op_catalog._shallow_schema(source, max_depth=1)

    assert projected["properties"]["nullable"] == {"description": "May be null."}
    assert "type" not in projected["properties"]["nullable"]


def test_shallow_agent_template_adds_no_constraint_the_full_schema_lacked():
    # Statically: below the top level the projection carries no constraint keyword at all, so there
    # is nothing it could have tightened.
    shallow = op_catalog._AGENT_TEMPLATE_DELTA_SCHEMA
    for name, node in shallow["properties"].items():
        assert "required" not in node, name
        assert node.get("additionalProperties") is not False, name
        assert "enum" not in node, name
    # The root's own `additionalProperties: false` is inherited from the full schema (not added),
    # and it still lists every key, so no payload the full schema accepted is newly rejected.
    full = op_catalog._AGENT_TEMPLATE_DELTA_SCHEMA_FULL
    assert shallow["additionalProperties"] == full["additionalProperties"]
    assert set(shallow["properties"]) == set(full["properties"])


def _required_paths(node, path=""):
    """Every `required` array under ``node``, keyed by its dotted location."""
    found = []
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "required" and isinstance(value, list):
                found.append((path, sorted(value)))
            else:
                found += _required_paths(value, f"{path}.{key}")
    elif isinstance(node, list):
        for index, item in enumerate(node):
            found += _required_paths(item, f"{path}[{index}]")
    return sorted(found)


@pytest.mark.parametrize("op_name", ["commit_revision", "test_run"])
def test_the_diet_drops_no_required_argument_check(op_name):
    """The diet costs NO required-field enforcement — not even nested.

    The plan anticipated losing nested `required` inside the collapsed subtree (the runner's
    `missingRequiredFields` walks `properties` recursively, so a shallower private spec checks
    less). It does not happen here: `_deep_partial_schema` already strips every `required` from the
    agent-template delta — a delta is a deep partial, so nothing under `parameters.agent` was ever
    required — and the projection touches nothing outside that subtree. So the advertised schema
    enforces exactly what the pre-diet schema enforced, at every layer."""
    advertised = get_platform_op(op_name).resolved_input_schema()

    # The pre-diet schema: the same op with the full agent-template tree put back.
    pre_diet = deepcopy(advertised)
    delta = (
        pre_diet["properties"]["workflow_revision"]["properties"]["delta"]
        if op_name == "commit_revision"
        else pre_diet["properties"]["delta"]
    )
    delta["properties"]["set"]["properties"]["parameters"]["properties"]["agent"] = (
        deepcopy(op_catalog._AGENT_TEMPLATE_DELTA_SCHEMA_FULL)
    )

    assert _required_paths(advertised) == _required_paths(pre_diet)
    assert _required_paths(op_catalog._AGENT_TEMPLATE_DELTA_SCHEMA_FULL) == []


def test_full_agent_template_schema_is_retained_for_on_demand_use():
    # The projection's input stays whole: it is what a `load_op`-style lazy schema would hand back,
    # and it is where the embed-tolerant list items still live.
    full = op_catalog._AGENT_TEMPLATE_DELTA_SCHEMA_FULL
    assert list(_iter_required_lists(full)) == []
    for field in ("tools", "skills", "mcps"):
        assert _has_embed_branch(full["properties"][field]["items"]), field


# A real, several-levels-deep agent config using the catalog type's ACTUAL field names, so it is
# valid under the pre-diet schema too. That is what makes it evidence: if it validates under both,
# the collapse cost no acceptance.
DEEP_AGENT_CONFIG = {
    "instructions": {"agents_md": "# Agent\nDo the thing."},
    "llm": {
        "model": "anthropic/claude-opus-4",
        "provider": "anthropic",
        "extras": {"temperature": 0.2},
    },
    "harness": {
        "kind": "claude",
        "permissions": {"default_mode": "default", "allow": ["query_spans"]},
        "extras": {"max_turns": 12},
    },
    "runner": {"kind": "sidecar", "permissions": {"default": "allow_reads"}},
    "sandbox": {"kind": "local", "permissions": {"network": {"egress": "deny"}}},
    "tools": [
        {"type": "builtin", "name": "read"},
        {"type": "platform", "op": "query_spans"},
        {"@ag.embed": {"@ag.references": {"workflow": {"slug": "__ag__x"}}}},
    ],
    "skills": [{"name": "s", "description": "d", "body": "b"}],
    "mcps": [{"name": "m", "command": "npx", "args": ["-y", "srv"]}],
}


def _delta_payload(op_name, agent_config):
    delta = {"set": {"parameters": {"agent": agent_config}}}
    if op_name == "commit_revision":
        return {"workflow_revision": {"message": "m", "delta": delta}}
    return {"inputs": {"messages": [{"role": "user", "content": "hi"}]}, "delta": delta}


@pytest.mark.parametrize("op_name", ["commit_revision", "test_run"])
def test_deeply_nested_agent_config_is_accepted_by_the_advertised_schema(op_name):
    """The behavioral half of "the diet only removes constraints".

    The harnesses validate a call against the ADVERTISED schema before it reaches the relay, so the
    question the collapse raises is whether a deep config still gets through. It does — and the
    second assertion is what makes this evidence rather than a tautology: the same payload is valid
    under the pre-diet schema, so acceptance was not narrowed, only widened."""
    payload = _delta_payload(op_name, DEEP_AGENT_CONFIG)

    jsonschema.validate(payload, get_platform_op(op_name).resolved_input_schema())
    jsonschema.validate(DEEP_AGENT_CONFIG, op_catalog._AGENT_TEMPLATE_DELTA_SCHEMA_FULL)


@pytest.mark.parametrize("op_name", ["commit_revision", "test_run"])
def test_the_advertised_schema_no_longer_rejects_unmodelled_nested_keys(op_name):
    """The one behavior change, in the safe direction.

    The full schema closed every nested object (`additionalProperties: false`), so a config using a
    field the catalog type had not modelled was rejected in the harness before the server ever saw
    it — even though the commit endpoint does not validate this shape at all. Collapsed, those
    payloads now reach the server, which is the authority on them."""
    config = deepcopy(DEEP_AGENT_CONFIG)
    config["llm"]["reasoning_effort"] = "high"  # not in the catalog type
    config["harness"]["kwargs"] = {"max_turns": 12}

    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(config, op_catalog._AGENT_TEMPLATE_DELTA_SCHEMA_FULL)

    jsonschema.validate(
        _delta_payload(op_name, config),
        get_platform_op(op_name).resolved_input_schema(),
    )


# --- resolver: annotate_trace self-targets its own trace/span -----------------


async def test_annotate_trace_binds_own_trace_and_hides_links(connection):
    # "Grade myself": the run's own trace_id/span_id are bound from run context and never
    # model-supplied, so the agent can only ever annotate its OWN current trace.
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="annotate_trace")]
    )
    spec = resolution.tool_specs[0]
    assert spec.call.method == "POST"
    assert spec.call.path == "/api/annotations/"
    assert spec.call.args_into == "annotation"
    # Both self-target ids ride as call.context — the runner fills them from runContext at dispatch.
    assert spec.call.context == {
        "annotation.links.invocation.trace_id": "$ctx.trace.trace_id",
        "annotation.links.invocation.span_id": "$ctx.trace.span_id",
    }
    # The model supplies only the payload (an evaluator slug + the outputs); `links` is never
    # exposed, and the schema is closed so the model cannot smuggle its own target.
    props = spec.input_schema["properties"]
    assert set(props) == {"references", "data"}
    assert "links" not in props
    assert spec.input_schema["additionalProperties"] is False
    assert props["references"]["properties"]["evaluator"]["required"] == ["slug"]
    assert props["data"]["properties"]["outputs"]["additionalProperties"] is True


async def test_annotate_trace_is_not_read_only(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="annotate_trace")]
    )
    spec = resolution.tool_specs[0]
    assert spec.read_only is False
    assert spec.effective_permission() is None


async def test_trigger_builder_ops_have_expected_paths_and_defaults(connection):
    expected_paths = {
        "discover_triggers": ("POST", "/api/triggers/discover"),
        "create_schedule": ("POST", "/api/triggers/schedules/"),
        "create_subscription": ("POST", "/api/triggers/subscriptions/"),
        "list_schedules": ("GET", "/api/triggers/schedules/"),
        "list_subscriptions": ("GET", "/api/triggers/subscriptions/"),
        "list_deliveries": ("GET", "/api/triggers/deliveries"),
        "list_connections": ("POST", "/api/triggers/connections/query"),
        "test_subscription": ("POST", "/api/triggers/subscriptions/test"),
        "remove_schedule": ("DELETE", "/api/triggers/schedules/{id}"),
        "remove_subscription": ("DELETE", "/api/triggers/subscriptions/{id}"),
        "pause_schedule": ("POST", "/api/triggers/schedules/{id}/stop"),
        "resume_schedule": ("POST", "/api/triggers/schedules/{id}/start"),
        "pause_subscription": ("POST", "/api/triggers/subscriptions/{id}/stop"),
        "resume_subscription": ("POST", "/api/triggers/subscriptions/{id}/start"),
    }
    read_only = {
        "discover_triggers",
        "list_schedules",
        "list_subscriptions",
        "list_deliveries",
        "list_connections",
    }

    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op=op) for op in expected_paths]
    )
    specs = {spec.name: spec for spec in resolution.tool_specs}

    for name, (method, path) in expected_paths.items():
        assert specs[name].call.method == method
        assert specs[name].call.path == path
        assert specs[name].read_only is (name in read_only)
        assert specs[name].effective_permission() is None


async def test_create_trigger_ops_bind_self_target_and_hide_destination(connection):
    resolution = await _resolver(connection).resolve(
        [
            PlatformToolConfig(op="create_schedule"),
            PlatformToolConfig(op="create_subscription"),
        ]
    )
    specs = {spec.name: spec for spec in resolution.tool_specs}

    schedule = specs["create_schedule"]
    assert schedule.call.args_into == "schedule"
    assert schedule.call.context == {
        "schedule.data.references.workflow_variant.id": "$ctx.workflow.variant.id"
    }
    schedule_data_props = schedule.input_schema["properties"]["data"]["properties"]
    assert "references" not in schedule_data_props
    assert "selector" not in schedule_data_props
    # Un-pinned triggers bind to the variant's latest revision at creation and do not follow
    # later commits (A1/B2): the description must say so.
    assert "latest revision" in schedule.description
    inputs_fields_description = schedule_data_props["inputs_fields"]["description"]
    assert "JSON Path" in inputs_fields_description
    assert "JSON Pointer" in inputs_fields_description

    subscription = specs["create_subscription"]
    assert subscription.call.args_into == "subscription"
    assert subscription.call.context == {
        "subscription.data.references.workflow_variant.id": "$ctx.workflow.variant.id"
    }
    data_props = subscription.input_schema["properties"]["data"]["properties"]
    assert "references" not in data_props
    assert "selector" not in data_props
    assert "latest revision" in subscription.description
    assert data_props["inputs_fields"]["description"] == inputs_fields_description


async def test_config_permission_rides_with_catalog_read_only_hint(connection):
    resolution = await _resolver(connection).resolve(
        [PlatformToolConfig(op="commit_revision", permission="allow")]
    )
    spec = resolution.tool_specs[0]
    assert spec.read_only is False
    assert spec.effective_permission() == "allow"


# --- resolver: error paths ----------------------------------------------------


async def test_unknown_op_in_config_raises(connection):
    with pytest.raises(UnknownPlatformOpError):
        await _resolver(connection).resolve([PlatformToolConfig(op="nope")])


async def test_missing_api_base_raises_typed_error():
    resolver = _resolver(PlatformConnection())  # no base URL configured
    with pytest.raises(GatewayToolResolutionError, match="API base URL"):
        await resolver.resolve([PlatformToolConfig(op="discover_tools")])


async def test_duplicate_platform_tool_rejected(connection):
    with pytest.raises(GatewayToolResolutionError, match="Duplicate platform tool"):
        await _resolver(connection).resolve(
            [
                PlatformToolConfig(op="discover_tools"),
                PlatformToolConfig(op="discover_tools"),
            ]
        )
