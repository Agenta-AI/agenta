import copy
import json
from typing import Any, Callable

from pydantic import ValidationError

from agenta.sdk.utils.types import AgentTemplateSchema

from oss.src.core.agent_templates.exceptions import TemplatePackageInvalid
from oss.src.core.agent_templates.models import (
    CompiledTemplate,
    ParsedTemplatePackage,
    TemplateBindingPlan,
)
from oss.src.core.skills.dtos import InstalledSkillRef
from oss.src.core.workflows.dtos import WorkflowRevisionData


def skill_embed(skill: InstalledSkillRef) -> dict[str, Any]:
    return {
        "@ag.embed": {
            "@ag.references": {
                "workflow": {
                    "id": str(skill.workflow_id),
                    "slug": skill.workflow_slug,
                }
            },
            "@ag.selector": {"path": "parameters.skill"},
        }
    }


def _fallback_key(value: dict[str, Any]) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _skill_key(value: dict[str, Any]) -> str:
    embed = value.get("@ag.embed")
    references = embed.get("@ag.references") if isinstance(embed, dict) else None
    workflow = references.get("workflow") if isinstance(references, dict) else None
    if isinstance(workflow, dict):
        identity = workflow.get("slug") or workflow.get("id")
        if isinstance(identity, str):
            return f"workflow:{identity}"
    name = value.get("name")
    return f"name:{name}" if isinstance(name, str) else _fallback_key(value)


def _tool_key(value: dict[str, Any]) -> str:
    if value.get("type") == "gateway_connection":
        connection = value.get("connection")
        if isinstance(connection, dict):
            return "gateway:" + ":".join(
                str(connection.get(key, ""))
                for key in ("provider", "integration", "slug")
            )
    return _fallback_key(value)


def _mcp_key(value: dict[str, Any]) -> str:
    connection = value.get("connection")
    if isinstance(connection, dict):
        return "mcp:" + ":".join(
            str(connection.get(key, ""))
            for key in ("type", "namespace", "provider", "slug")
        )
    name = value.get("name")
    return f"name:{name}" if isinstance(name, str) else _fallback_key(value)


def _append_unique(
    existing: list,
    additions: list[dict[str, Any]],
    *,
    key: Callable[[dict[str, Any]], str],
) -> list:
    result = copy.deepcopy(existing)
    seen = {key(item) for item in result if isinstance(item, dict)}
    for item in additions:
        identity = key(item)
        if identity not in seen:
            result.append(copy.deepcopy(item))
            seen.add(identity)
    return result


class TemplateCompiler:
    def compile(
        self,
        *,
        package: ParsedTemplatePackage,
        base_revision: WorkflowRevisionData,
        bindings: TemplateBindingPlan,
        installed_skills: list[InstalledSkillRef],
        first_message: str,
    ) -> CompiledTemplate:
        revision = base_revision.model_copy(deep=True)
        parameters = revision.parameters
        if not isinstance(parameters, dict):
            raise TemplatePackageInvalid(
                "native_agent_invalid", "The ordinary agent configuration is invalid."
            )
        agent = parameters.get("agent")
        if not isinstance(agent, dict):
            raise TemplatePackageInvalid(
                "native_agent_invalid", "The ordinary agent configuration is missing."
            )

        instructions = agent.get("instructions")
        if not isinstance(instructions, dict):
            instructions = {}
        instructions = copy.deepcopy(instructions)
        instructions["agents_md"] = package.agent.instructions
        agent["instructions"] = instructions
        agent["skills"] = _append_unique(
            agent.get("skills") if isinstance(agent.get("skills"), list) else [],
            [skill_embed(skill) for skill in installed_skills],
            key=_skill_key,
        )
        agent["tools"] = _append_unique(
            agent.get("tools") if isinstance(agent.get("tools"), list) else [],
            bindings.tools,
            key=_tool_key,
        )
        agent["mcps"] = _append_unique(
            agent.get("mcps") if isinstance(agent.get("mcps"), list) else [],
            bindings.mcps,
            key=_mcp_key,
        )

        try:
            AgentTemplateSchema.model_validate(agent)
        except (ValidationError, ValueError, TypeError) as exc:
            raise TemplatePackageInvalid(
                "native_agent_invalid",
                "The compiled agent configuration is invalid.",
            ) from exc

        parameters["agent"] = agent
        return CompiledTemplate(
            workflow_name=package.agent.name,
            workflow_description=package.agent.description,
            revision_data=revision,
            workspace=package.workspace.model_copy(deep=True),
            first_message=first_message,
        )
