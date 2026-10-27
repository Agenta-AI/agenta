from uuid import uuid4

import pytest

from oss.src.core.agent_templates.compiler import TemplateCompiler, skill_embed
from oss.src.core.agent_templates.exceptions import TemplatePackageInvalid
from oss.src.core.agent_templates.models import (
    ParsedTemplateAgent,
    ParsedTemplatePackage,
    TemplateBindingPlan,
)
from oss.src.core.skills.dtos import InstalledSkillRef
from oss.src.core.workflows.dtos import WorkflowRevisionData


def _base_revision() -> WorkflowRevisionData:
    return WorkflowRevisionData(
        uri="agenta:workflow:agent:v0",
        parameters={
            "agent": {
                "instructions": {"agents_md": "Old instructions"},
                "llm": {"model": "openai/gpt-5"},
                "harness": {"kind": "pi_core"},
                "runner": {"kind": "sidecar", "permissions": {"default": "allow"}},
                "sandbox": {"kind": "local"},
                "tools": [],
                "skills": [],
                "mcps": [],
            }
        },
    )


def _package() -> ParsedTemplatePackage:
    return ParsedTemplatePackage(
        source={"kind": "internal", "key": "sample"},
        version="1.0.0",
        digest="sha256:" + "1" * 64,
        agent=ParsedTemplateAgent(
            key="sample",
            name="Sample agent",
            description="Does sample work.",
            instructions="# Sample agent\n\nFollow the saved rules.",
        ),
    )


def test_compiler_preserves_ordinary_execution_settings():
    base = _base_revision()
    skill = InstalledSkillRef(
        name="prospect-research",
        workflow_id=uuid4(),
        workflow_slug="prospect-research-abcd1234",
    )
    bindings = TemplateBindingPlan(
        tools=[
            {
                "type": "gateway_connection",
                "connection": {
                    "provider": "composio",
                    "integration": "gmail",
                    "slug": "gmail-primary",
                },
            }
        ],
        mcps=[
            {
                "name": "mail",
                "connection": {
                    "type": "gateway",
                    "namespace": "custom",
                    "slug": "mail",
                },
            }
        ],
    )

    compiled = TemplateCompiler().compile(
        package=_package(),
        base_revision=base,
        bindings=bindings,
        installed_skills=[skill],
        first_message="Configure the agent.",
    )

    agent = compiled.revision_data.parameters["agent"]
    original = base.parameters["agent"]
    # The model is kept; a base revision with no connection gets the explicit project
    # default (M5), so the created agent keeps the connection it was created with.
    assert agent["llm"] == {
        **original["llm"],
        "connection": {"mode": "agenta", "scope": "project"},
    }
    assert agent["harness"] == original["harness"]
    assert agent["runner"] == original["runner"]
    assert agent["sandbox"] == original["sandbox"]
    assert agent["instructions"]["agents_md"] == _package().agent.instructions
    assert agent["tools"] == bindings.tools
    assert agent["mcps"] == bindings.mcps
    assert agent["skills"] == [skill_embed(skill)]
    assert compiled.workflow_name == "Sample agent"
    assert compiled.workflow_description == "Does sample work."
    assert compiled.first_message == "Configure the agent."
    assert base.parameters["agent"]["instructions"]["agents_md"] == "Old instructions"


def test_skill_embed_matches_current_authoring_contract():
    skill = InstalledSkillRef(
        name="prospect-research",
        workflow_id=uuid4(),
        workflow_slug="prospect-research-abcd1234",
    )

    embed = skill_embed(skill, description="Research a prospect.")

    # The same entry the playground's skill picker writes: the label rides beside the embed.
    assert set(embed) == {"@ag.embed", "name", "description"}
    assert embed["name"] == "prospect-research"
    assert embed["description"] == "Research a prospect."
    assert embed["@ag.embed"]["@ag.references"]["workflow"] == {
        "id": str(skill.workflow_id),
        "slug": skill.workflow_slug,
    }
    assert embed["@ag.embed"]["@ag.selector"] == {"path": "parameters.skill"}


def test_compiler_deduplicates_an_existing_skill_reference_by_slug():
    base = _base_revision()
    base.parameters["agent"]["skills"] = [
        {
            "@ag.embed": {
                "@ag.references": {"workflow": {"slug": "prospect-research-abcd1234"}},
                "@ag.selector": {"path": "parameters.skill"},
            }
        }
    ]
    skill = InstalledSkillRef(
        name="prospect-research",
        workflow_id=uuid4(),
        workflow_slug="prospect-research-abcd1234",
    )

    compiled = TemplateCompiler().compile(
        package=_package(),
        base_revision=base,
        bindings=TemplateBindingPlan(),
        installed_skills=[skill],
        first_message="Configure the agent.",
    )

    assert len(compiled.revision_data.parameters["agent"]["skills"]) == 1


def test_compiler_accepts_a_builtin_model_connection_namespace():
    # The /m model picker stores the built-in Agenta model with its gateway namespace.
    base = _base_revision()
    base.parameters["agent"]["llm"] = {
        "provider": "openai",
        "model": "google/gemini-3.7-flash",
        "connection": {"mode": "agenta", "slug": "agenta", "namespace": "builtin"},
    }

    compiled = TemplateCompiler().compile(
        package=_package(),
        base_revision=base,
        bindings=TemplateBindingPlan(),
        installed_skills=[],
        first_message="Configure the agent.",
    )

    assert (
        compiled.revision_data.parameters["agent"]["llm"]
        == base.parameters["agent"]["llm"]
    )


def test_compiler_rejects_invalid_native_agent_configuration():
    base = _base_revision()
    base.parameters["agent"]["harness"] = "pi_core"

    with pytest.raises(TemplatePackageInvalid) as error:
        TemplateCompiler().compile(
            package=_package(),
            base_revision=base,
            bindings=TemplateBindingPlan(),
            installed_skills=[],
            first_message="Configure the agent.",
        )

    assert error.value.code == "native_agent_invalid"


def test_compiler_does_not_replace_a_non_object_model_setting():
    """A string `llm` is judged by the schema check, never replaced by the default."""
    base = _base_revision()
    base.parameters["agent"]["llm"] = "openai/gpt-5"

    with pytest.raises(TemplatePackageInvalid) as error:
        TemplateCompiler().compile(
            package=_package(),
            base_revision=base,
            bindings=TemplateBindingPlan(),
            installed_skills=[],
            first_message="Configure the agent.",
        )

    assert error.value.code == "native_agent_invalid"


def test_compiler_keeps_a_connection_the_base_revision_names():
    """A connection the base revision already names is written through unchanged."""
    named = {"mode": "agenta", "slug": "openai-sales", "scope": "project"}
    base = _base_revision()
    base.parameters["agent"]["llm"] = {"model": "openai/gpt-5", "connection": named}
    compiled = TemplateCompiler().compile(
        package=_package(),
        base_revision=base,
        bindings=TemplateBindingPlan(tools=[], mcps=[]),
        installed_skills=[],
        first_message="hello",
    )
    assert compiled.revision_data.parameters["agent"]["llm"]["connection"] == named
