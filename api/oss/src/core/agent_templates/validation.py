import json
from pathlib import Path
from uuid import UUID

from oss.src.core.agent_templates.dtos import (
    TemplateSource,
    TemplateSourcePin,
    TemplateValidationIssue,
    TemplateValidationResult,
)
from oss.src.core.agent_templates.exceptions import (
    AgentTemplateError,
    TemplatePackageInvalid,
    TemplateSourceDigestMismatch,
    TemplateSourceInvalid,
)
from oss.src.core.agent_templates.interfaces import TemplateSourceResolver
from oss.src.core.agent_templates.parser import TemplatePackageParser

_EXTENSION_SCHEMA = (
    Path(__file__).resolve().parents[2]
    / "resources"
    / "agent_templates"
    / "schemas"
    / "ai.agenta-agents.schema.json"
)

# Transport and authorization failures stay normal errors, not validation results.
_SOURCE_ERRORS = {"template_source_unsupported"}

_NEXT_STEPS = {
    "file_not_found": "Create the missing file in the package, or correct the path in this field.",
    "plugin_manifest_invalid": "Put a valid plugin.json object at the package root.",
    "plugin_schema_invalid": "Make plugin.json match the plugin schema at the named field.",
    "plugin_name_invalid": "Set plugin.json name to lowercase words joined by hyphens.",
    "plugin_version_invalid": "Set plugin.json version, for example 1.0.0.",
    "package_version_mismatch": "Make plugin.json version match the version you publish.",
    "extension_manifest_missing": 'Set plugin.json extensions."ai.agenta".manifest to the Agenta manifest path.',
    "extension_manifest_invalid": "Make the Agenta manifest a valid JSON object.",
    "extension_schema_invalid": "Change the named manifest field to match the Agenta extension schema; remove fields it does not allow.",
    "single_agent_required": "Keep exactly one agent in the manifest.",
    "subagents_not_supported": "Remove subagents; a template has one agent.",
    "agent_entry_invalid": "Set entry to the key of the one agent.",
    "duplicate_connection_key": "Give each connection requirement its own key.",
    "duplicate_automation_key": "Give each automation its own key.",
    "missing_mcp_server": "Declare the MCP server in mcp.json, or remove the connection option.",
    "mcp_manifest_invalid": "Make mcp.json a valid JSON object with mcpServers.",
    "mcp_schema_invalid": "Make mcp.json match the MCP schema at the named field.",
    "unsupported_mcp_transport": "Use a streamable-http MCP server.",
    "mcp_headers_not_supported": "Remove MCP headers; describe the credential as a connection the recipient sets up.",
    "missing_skill": "Add skills/<name>/SKILL.md for each listed skill, or remove the name from the list.",
    "skill_invalid": "Fix the skill's SKILL.md front matter and files.",
    "unsafe_package_path": "Use a relative path inside the package, without '..' or symbolic links.",
    "unsafe_workspace_path": "Use a relative workspace path inside the agent's files.",
    "reserved_workspace_path": "Choose a workspace path outside startup and configuration folders.",
    "duplicate_workspace_path": "Give each workspace entry its own destination.",
    "package_text_invalid": "Save the file as UTF-8 text.",
    "executable_package_file": "Remove the execute permission from the file.",
    "template_archive_invalid": "Rebuild the zip from the package folder.",
    "template_archive_too_large": "Remove large files, then rebuild the zip.",
    "template_archive_path_unsafe": "Rebuild the zip with relative paths inside the package folder.",
    "template_archive_duplicate_path": "Rebuild the zip so each path appears once.",
    "template_archive_entry_unsupported": "Rebuild the zip with regular, unencrypted files only.",
    "template_source_limit_exceeded": "Keep the package within 256 files, 1 MiB per file, 4 MiB in total and 12 folder levels.",
    "template_source_symlink": "Replace symbolic links with regular files.",
    "template_source_digest_mismatch": "Validate the current file again and use the new version and digest.",
}


def _supported_schema_versions() -> list[str]:
    schema = json.loads(_EXTENSION_SCHEMA.read_text(encoding="utf-8"))
    version = schema["properties"]["schema_version"]["const"]
    return [f"ai.agenta/{version}"]


def _issue(exc: AgentTemplateError) -> TemplateValidationIssue:
    details = exc.details
    path = details.get("path")
    field = details.get("field")
    return TemplateValidationIssue(
        code=exc.code,
        path=path if isinstance(path, str) else None,
        field=field if isinstance(field, str) else None,
        message=exc.message,
        next_step=_NEXT_STEPS.get(exc.code),
    )


class AgentTemplateValidator:
    """Check one package source with the loader's own resolver and parser.

    It only reads: no workflow, session, skill or automation is created, and any
    staged copy is deleted when the check ends.
    """

    def __init__(
        self,
        *,
        source_resolver: TemplateSourceResolver,
        package_parser: TemplatePackageParser,
    ) -> None:
        self._source_resolver = source_resolver
        self._package_parser = package_parser
        self._supported = _supported_schema_versions()

    async def validate(
        self,
        *,
        project_id: UUID,
        source: TemplateSource,
        pin: TemplateSourcePin | None = None,
    ) -> TemplateValidationResult:
        try:
            async with self._source_resolver.open(
                project_id=project_id,
                source=source,
                pin=pin,
            ) as resolved:
                self._package_parser.parse(resolved)
        except (
            TemplatePackageInvalid,
            TemplateSourceInvalid,
            TemplateSourceDigestMismatch,
        ) as exc:
            if exc.code in _SOURCE_ERRORS:
                raise
            return TemplateValidationResult(
                valid=False,
                supported_schema_versions=self._supported,
                issues=[_issue(exc)],
            )
        return TemplateValidationResult(
            valid=True,
            version=resolved.version,
            digest=resolved.digest,
            supported_schema_versions=self._supported,
        )
