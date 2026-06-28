"""The ``skill-template`` catalog type and the ``skills`` field on the agent-template twin.

These pin that the playground gets a typed editor for an inline skill package and that the
agent-template control renders a list of those skills, where each item is EITHER a
``skill-template`` ref OR an ``@ag.embed`` reference the backend inlines server-side.
"""

import jsonschema

from agenta.sdk.utils.types import CATALOG_TYPES, SkillTemplateSchema


def test_skill_template_registered_in_catalog():
    assert SkillTemplateSchema.ag_type() == "skill-template"
    assert "skill-template" in CATALOG_TYPES


def test_skill_template_schema_shape():
    schema = CATALOG_TYPES["skill-template"]

    assert schema["x-ag-type"] == "skill-template"
    assert set(schema["properties"]) == {
        "name",
        "description",
        "body",
        "files",
        "disable_model_invocation",
        "allow_executable_files",
    }
    # name carries the harness skill-name rule.
    assert schema["properties"]["name"]["pattern"] == r"^[a-z0-9]+(-[a-z0-9]+)*$"
    # body renders as a textarea in the form.
    assert schema["properties"]["body"]["x-ag-type"] == "textarea"

    file_item = schema["properties"]["files"]["items"]
    assert set(file_item["properties"]) == {"path", "content", "executable"}


def test_agent_template_catalog_exposes_skills_as_ref_or_embed_union():
    agent_template = CATALOG_TYPES["agent-template"]

    assert "skills" in agent_template["properties"]
    skills_item = agent_template["properties"]["skills"]["items"]

    # Each entry is a union: a skill-template ref (resolved from /catalog/types/skill-template),
    # or an @ag.embed reference. The full inline shape lives in the skill-template catalog type,
    # not inlined here (mirrors how inputs reference `messages`).
    variants = skills_item["anyOf"]
    assert len(variants) == 2

    ref = next(v for v in variants if v.get("x-ag-type-ref") == "skill-template")
    assert "properties" not in ref  # a bare ref node, not the inlined schema

    embed = next(v for v in variants if "@ag.embed" in v.get("properties", {}))
    assert embed["required"] == ["@ag.embed"]


def _base_agent_template() -> dict:
    """The shape ``services/oss/src/agent/schemas.py::_DEFAULT_AGENT_TEMPLATE`` seeds, minus skills."""
    return {
        "agents_md": "hi",
        "model": "gpt-4o",
        "tools": [],
        "mcp_servers": [],
        "harness": "pi_core",
        "sandbox": "local",
        "permission_policy": "auto",
        "sandbox_permission": {
            "network": {"mode": "on", "allowlist": []},
            "enforcement": "strict",
        },
    }


def test_platform_default_agent_template_with_embed_skill_validates():
    """The platform default ships an @ag.embed skill entry; the catalog schema must accept it."""
    agent_template = CATALOG_TYPES["agent-template"]

    config = _base_agent_template()
    config["skills"] = [
        {
            "@ag.embed": {
                "@ag.references": {
                    "workflow": {"slug": "__ag__getting_started_with_agenta"}
                },
                "@ag.selector": {"path": "parameters.skill"},
            }
        }
    ]

    jsonschema.validate(config, agent_template)


def test_inline_skill_entry_validates():
    agent_template = CATALOG_TYPES["agent-template"]

    config = _base_agent_template()
    config["skills"] = [
        {
            "name": "release-notes",
            "description": "Draft release notes.",
            "body": "Read it.",
        }
    ]

    jsonschema.validate(config, agent_template)


# --- tools: @ag.embed (inline) + type:"reference" arms -----------------------


def _flatten_union(variants):
    """Flatten nested anyOf/oneOf members (the concrete tool variants live in a discriminated
    oneOf nested inside the tools anyOf)."""
    for variant in variants:
        nested = variant.get("anyOf") or variant.get("oneOf")
        if nested:
            yield from _flatten_union(nested)
        else:
            yield variant


def _type_const(variant):
    """The discriminator const/enum of a tool union variant, if any."""
    type_schema = variant.get("properties", {}).get("type", {})
    if "const" in type_schema:
        return type_schema["const"]
    enum = type_schema.get("enum")
    if isinstance(enum, list) and len(enum) == 1:
        return enum[0]
    return None


def test_agent_template_tools_accepts_embed_and_reference_arms():
    """The tools field is a union: a concrete tool variant (incl. type:"reference", a workflow
    run server-side), or an @ag.embed (inline a client tool value)."""
    agent_template = CATALOG_TYPES["agent-template"]
    tools_item = agent_template["properties"]["tools"]["items"]
    variants = list(_flatten_union(tools_item["anyOf"]))

    # The embed arm and the type:"reference" arm are present alongside the concrete tool variants.
    has_embed = any("@ag.embed" in v.get("properties", {}) for v in variants)
    has_reference = any(_type_const(v) == "reference" for v in variants)
    assert has_embed, "tools union must include an @ag.embed arm"
    assert has_reference, 'tools union must include a type:"reference" arm'


def test_agent_template_tools_accepts_platform_arm():
    """The tools union includes a type:"platform" arm (an existing Agenta endpoint exposed)."""
    agent_template = CATALOG_TYPES["agent-template"]
    tools_item = agent_template["properties"]["tools"]["items"]
    variants = list(_flatten_union(tools_item["anyOf"]))
    has_platform = any(_type_const(v) == "platform" for v in variants)
    assert has_platform, 'tools union must include a type:"platform" arm'


def test_agent_template_with_platform_tool_validates():
    agent_template = CATALOG_TYPES["agent-template"]

    config = _base_agent_template()
    config["tools"] = [{"type": "platform", "op": "find_capabilities"}]

    jsonschema.validate(config, agent_template)


def test_agent_template_with_reference_tool_validates():
    agent_template = CATALOG_TYPES["agent-template"]

    config = _base_agent_template()
    config["tools"] = [
        {
            "type": "reference",
            "ref_by": "variant",
            "slug": "summarize",
            "name": "summarize",
            "description": "Summarize text",
            "input_schema": {"type": "object", "properties": {}},
        }
    ]

    jsonschema.validate(config, agent_template)


def test_agent_template_with_embed_tool_validates():
    agent_template = CATALOG_TYPES["agent-template"]

    config = _base_agent_template()
    config["tools"] = [
        {
            "@ag.embed": {
                "@ag.references": {"workflow": {"slug": "my-client-tool"}},
                "@ag.selector": {"path": "parameters.tool"},
            }
        }
    ]

    jsonschema.validate(config, agent_template)
