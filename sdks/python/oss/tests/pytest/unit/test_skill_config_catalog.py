"""The ``skill_config`` catalog type and the ``skills`` field on the agent-config twin.

These pin that the playground gets a typed editor for an inline skill package and that the
agent-config control renders a list of those skills, where each item is EITHER an inline
``skill_config`` package OR an ``@ag.embed`` reference the backend inlines server-side.
"""

import jsonschema

from agenta.sdk.utils.types import CATALOG_TYPES, SkillConfigSchema


def test_skill_config_registered_in_catalog():
    assert SkillConfigSchema.ag_type() == "skill_config"
    assert "skill_config" in CATALOG_TYPES


def test_skill_config_schema_shape():
    schema = CATALOG_TYPES["skill_config"]

    assert schema["x-ag-type"] == "skill_config"
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


def test_agent_config_catalog_exposes_skills_as_inline_or_embed_union():
    agent_config = CATALOG_TYPES["agent_config"]

    assert "skills" in agent_config["properties"]
    skills_item = agent_config["properties"]["skills"]["items"]

    # Each entry is a union: an inline skill_config package, or an @ag.embed reference.
    variants = skills_item["anyOf"]
    assert len(variants) == 2

    inline = next(v for v in variants if v.get("x-ag-type") == "skill_config")
    assert {"name", "description", "body"}.issubset(inline["properties"])

    embed = next(v for v in variants if "@ag.embed" in v.get("properties", {}))
    assert embed["required"] == ["@ag.embed"]


def _base_agent_config() -> dict:
    """The shape ``services/oss/src/agent/schemas.py::_DEFAULT_AGENT_CONFIG`` seeds, minus skills."""
    return {
        "agents_md": "hi",
        "model": "gpt-4o",
        "tools": [],
        "mcp_servers": [],
        "harness": "pi",
        "sandbox": "local",
        "permission_policy": "auto",
    }


def test_seeded_default_agent_config_with_embed_skill_validates():
    """The seeded default ships an @ag.embed skill entry; the catalog schema must accept it."""
    agent_config = CATALOG_TYPES["agent_config"]

    config = _base_agent_config()
    config["skills"] = [
        {
            "@ag.embed": {
                "@ag.references": {"workflow": {"slug": "agenta-getting-started"}},
                "@ag.selector": {"path": "parameters.skill"},
            }
        }
    ]

    jsonschema.validate(config, agent_config)


def test_inline_skill_entry_validates():
    agent_config = CATALOG_TYPES["agent_config"]

    config = _base_agent_config()
    config["skills"] = [
        {
            "name": "release-notes",
            "description": "Draft release notes.",
            "body": "Read it.",
        }
    ]

    jsonschema.validate(config, agent_config)
