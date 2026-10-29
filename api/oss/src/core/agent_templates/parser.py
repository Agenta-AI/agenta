import json
import stat
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import Any, Iterator

from jsonschema import Draft202012Validator
from pydantic import BaseModel, ConfigDict, ValidationError

from agenta.sdk.agents import SkillTemplate

from oss.src.core.agent_templates.dtos import ResolvedTemplateSource
from oss.src.core.agent_templates.exceptions import TemplatePackageInvalid
from oss.src.core.agent_templates.models import (
    AgentaExtensionManifest,
    MCPConnectionOption,
    ParsedMCPServer,
    ParsedTemplateAgent,
    ParsedTemplatePackage,
    ParsedWorkspace,
    ParsedWorkspaceFile,
)
from oss.src.core.skills.parser import parse_skill_dir

_RESERVED_WORKSPACE_ROOTS = {
    ".agenta",
    ".agents",
    ".claude",
    ".env",
    ".github",
    ".pi",
    "agents.md",
    "claude.md",
}


class _ExtensionPointer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    manifest: str


def _package_error(
    code: str, message: str, **details: object
) -> TemplatePackageInvalid:
    return TemplatePackageInvalid(code, message, details=details or None)


@contextmanager
def _located(*, path: str | None = None, field: str | None = None) -> Iterator[None]:
    """Name the package file and manifest field an error came from, if it has none yet."""
    try:
        yield
    except TemplatePackageInvalid as exc:
        if path is not None:
            exc.details.setdefault("path", path)
        if field is not None:
            exc.details.setdefault("field", field)
        raise


def _read_json(path: Path, *, code: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise _package_error(code, f"{path.name} is missing or invalid JSON.") from exc
    if not isinstance(value, dict):
        raise _package_error(code, f"{path.name} must contain a JSON object.")
    return value


def _validate_schema(value: dict, schema_path: Path, *, code: str) -> None:
    schema = _read_json(schema_path, code="template_schema_invalid")
    errors = sorted(Draft202012Validator(schema).iter_errors(value), key=str)
    if errors:
        first = errors[0]
        location = ".".join(str(part) for part in first.absolute_path)
        raise _package_error(
            code,
            f"The template package does not match its schema: {first.message}",
            **({"field": location} if location else {}),
        )


def _relative_parts(value: str) -> tuple[str, ...]:
    if not value or "\\" in value or "\x00" in value:
        raise _package_error(
            "unsafe_package_path", "Package paths must use safe POSIX syntax."
        )
    normalized = value[2:] if value.startswith("./") else value
    path = PurePosixPath(normalized)
    if (
        path.is_absolute()
        or not path.parts
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise _package_error(
            "unsafe_package_path", "Package paths must remain inside the package."
        )
    return path.parts


def _resolve_file(root: Path, value: str) -> Path:
    parts = _relative_parts(value)
    current = root
    try:
        for part in parts:
            current = current / part
            if current.is_symlink():
                raise _package_error(
                    "unsafe_package_path", "Package paths cannot use symbolic links."
                )
        resolved = current.resolve(strict=True)
        resolved.relative_to(root.resolve(strict=True))
    except TemplatePackageInvalid:
        raise
    except FileNotFoundError as exc:
        raise _package_error(
            "file_not_found",
            f"The declared file {value} does not exist.",
            missing=value,
        ) from exc
    except (RuntimeError, ValueError) as exc:
        raise _package_error(
            "unsafe_package_path", "A declared package file is missing or unsafe."
        ) from exc
    if not resolved.is_file():
        raise _package_error(
            "unsafe_package_path", "A declared package source must be a regular file."
        )
    return resolved


def _read_text(root: Path, value: str) -> str:
    path = _resolve_file(root, value)
    try:
        return path.read_bytes().decode("utf-8")
    except UnicodeDecodeError as exc:
        raise _package_error(
            "package_text_invalid", "Declared template text must be valid UTF-8."
        ) from exc


def _workspace_path(value: str) -> str:
    if (
        not value
        or value.startswith("/")
        or "\\" in value
        or "\x00" in value
        or any(ord(char) < 32 or ord(char) == 127 for char in value)
    ):
        raise _package_error(
            "unsafe_workspace_path",
            "Workspace paths must use safe relative POSIX syntax.",
        )
    path = PurePosixPath(value)
    if not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise _package_error(
            "unsafe_workspace_path",
            "Workspace paths must remain inside the agent mount.",
        )
    if path.parts[0].lower() in _RESERVED_WORKSPACE_ROOTS:
        raise _package_error(
            "reserved_workspace_path",
            "The template cannot write an automatic startup or configuration path.",
            workspace_path=value,
        )
    return path.as_posix()


def _validate_package_tree(root: Path) -> None:
    if root.is_symlink() or not root.is_dir():
        raise _package_error(
            "unsafe_package_path", "The package root must be a regular directory."
        )
    for path in root.rglob("*"):
        if path.is_symlink():
            raise _package_error(
                "unsafe_package_path", "Package paths cannot use symbolic links."
            )
        if path.is_file() and stat.S_IMODE(path.stat().st_mode) & 0o111:
            raise _package_error(
                "executable_package_file",
                "Template package files cannot be executable.",
                path=path.relative_to(root).as_posix(),
            )


def _reject_unsupported_shape(extension: dict[str, Any]) -> None:
    agents = extension.get("agents")
    if isinstance(agents, dict):
        if any(
            isinstance(agent, dict) and "subagents" in agent
            for agent in agents.values()
        ):
            raise _package_error(
                "subagents_not_supported",
                "This loader accepts one agent and no subagents.",
            )
        if len(agents) != 1:
            raise _package_error(
                "single_agent_required", "This loader requires exactly one agent."
            )
        for agent in agents.values():
            if not isinstance(agent, dict):
                continue
            for key in ("instructions", "setup"):
                value = agent.get(key)
                if isinstance(value, str):
                    _relative_parts(value)
            workspace = agent.get("workspace")
            entries = workspace.get("entries") if isinstance(workspace, dict) else []
            if isinstance(entries, list):
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    if isinstance(entry.get("source"), str):
                        _relative_parts(entry["source"])
                    if isinstance(entry.get("path"), str):
                        _workspace_path(entry["path"])


class TemplatePackageParser:
    def __init__(self, *, schemas_path: Path | None = None) -> None:
        self._schemas_path = schemas_path or (
            Path(__file__).resolve().parents[2]
            / "resources"
            / "agent_templates"
            / "schemas"
        )

    def parse(self, resolved: ResolvedTemplateSource) -> ParsedTemplatePackage:
        root = resolved.root
        _validate_package_tree(root)
        with _located(path="plugin.json"):
            plugin = _read_json(root / "plugin.json", code="plugin_manifest_invalid")
            _validate_schema(
                plugin,
                self._schemas_path / "plugin.schema.json",
                code="plugin_schema_invalid",
            )

            if plugin.get("version") != resolved.version:
                raise _package_error(
                    "package_version_mismatch",
                    "The package version does not match the catalog version.",
                    field="version",
                )

            extensions = plugin.get("extensions")
            extension_value = (
                extensions.get("ai.agenta") if isinstance(extensions, dict) else None
            )
            try:
                pointer = _ExtensionPointer.model_validate(extension_value)
            except ValidationError as exc:
                raise _package_error(
                    "extension_manifest_missing",
                    "plugin.json must declare the ai.agenta manifest.",
                    field="extensions.ai.agenta.manifest",
                ) from exc

            with _located(field="extensions.ai.agenta.manifest"):
                extension_path = _resolve_file(root, pointer.manifest)
        manifest = extension_path.relative_to(root.resolve(strict=True)).as_posix()

        with _located(path=manifest):
            extension = _read_json(extension_path, code="extension_manifest_invalid")
            _reject_unsupported_shape(extension)
            _validate_schema(
                extension,
                self._schemas_path / "ai.agenta-agents.schema.json",
                code="extension_schema_invalid",
            )
            try:
                declaration = AgentaExtensionManifest.model_validate(extension)
            except ValidationError as exc:
                raise _package_error(
                    "extension_schema_invalid", "The Agenta extension is invalid."
                ) from exc

            if len(declaration.agents) != 1:
                raise _package_error(
                    "single_agent_required",
                    "This loader requires exactly one agent.",
                    field="agents",
                )
            agent_key, agent = next(iter(declaration.agents.items()))
            field = f"agents.{agent_key}"
            if declaration.entry != agent_key:
                raise _package_error(
                    "agent_entry_invalid",
                    "The package entry must name its sole agent.",
                    field="entry",
                )

            connection_keys = [requirement.key for requirement in agent.connections]
            if len(connection_keys) != len(set(connection_keys)):
                raise _package_error(
                    "duplicate_connection_key",
                    "Connection requirement keys must be unique.",
                    field=f"{field}.connections",
                )
            automation_keys = [recipe.key for recipe in agent.automations]
            if len(automation_keys) != len(set(automation_keys)):
                raise _package_error(
                    "duplicate_automation_key",
                    "Automation recipe keys must be unique.",
                    field=f"{field}.automations",
                )

        mcp_servers = self._parse_mcp(root)
        with _located(path=manifest, field=f"{field}.connections"):
            for requirement in agent.connections:
                for option in requirement.options:
                    if (
                        isinstance(option, MCPConnectionOption)
                        and option.server not in mcp_servers
                    ):
                        raise _package_error(
                            "missing_mcp_server",
                            "A connection option names an undeclared MCP server.",
                            server=option.server,
                        )

        skills = []
        for name in sorted(agent.skills):
            with _located(path=f"skills/{name}", field=f"{field}.skills"):
                skills.append(self._parse_skill(root, name))
        with _located(path=manifest, field=f"{field}.workspace.entries"):
            workspace = self._parse_workspace(root, agent.workspace.entries)
        with _located(path=manifest, field=f"{field}.instructions"):
            instructions = _read_text(root, agent.instructions)
        setup = None
        if agent.setup:
            with _located(path=manifest, field=f"{field}.setup"):
                setup = _read_text(root, agent.setup)

        return ParsedTemplatePackage(
            source=resolved.source,
            version=resolved.version,
            digest=resolved.digest,
            agent=ParsedTemplateAgent(
                key=agent_key,
                name=agent.name,
                description=agent.description,
                instructions=instructions,
                setup=setup,
                connections=agent.connections,
                automations=agent.automations,
            ),
            skills=skills,
            workspace=workspace,
            mcp_servers=mcp_servers,
        )

    def _parse_mcp(self, root: Path) -> dict[str, ParsedMCPServer]:
        path = root / "mcp.json"
        if not path.exists():
            return {}
        with _located(path="mcp.json"):
            return self._read_mcp(path)

    def _read_mcp(self, path: Path) -> dict[str, ParsedMCPServer]:
        if path.is_symlink():
            raise _package_error(
                "unsafe_package_path", "Package paths cannot use symbolic links."
            )
        value = _read_json(path, code="mcp_manifest_invalid")
        _validate_schema(
            value,
            self._schemas_path / "mcp.schema.json",
            code="mcp_schema_invalid",
        )
        result: dict[str, ParsedMCPServer] = {}
        for name, server in value["mcpServers"].items():
            if server["type"] != "streamable-http":
                raise _package_error(
                    "unsupported_mcp_transport",
                    "Only Streamable HTTP MCP declarations are supported.",
                    server=name,
                    transport=server["type"],
                )
            if server.get("headers"):
                raise _package_error(
                    "mcp_headers_not_supported",
                    "Template packages cannot provide MCP credentials or headers.",
                    server=name,
                )
            result[name] = ParsedMCPServer(name=name, url=server["url"])
        return result

    def _parse_skill(self, root: Path, name: str) -> SkillTemplate:
        skill_root = root / "skills" / name
        if skill_root.is_symlink() or not skill_root.is_dir():
            raise _package_error(
                "missing_skill", "A declared skill directory is missing.", skill=name
            )
        candidate = parse_skill_dir(skill_root, path_in_repo=f"skills/{name}")
        if not candidate.valid or candidate.skill is None or candidate.warnings:
            issues = [issue.code for issue in candidate.issues + candidate.warnings]
            code = (
                "executable_package_file"
                if "executable_disabled" in issues
                else "skill_invalid"
            )
            raise _package_error(
                code,
                "A declared skill is invalid.",
                skill=name,
                issues=issues,
            )
        try:
            return SkillTemplate.model_validate(
                candidate.skill.model_dump(exclude_none=True)
            )
        except ValidationError as exc:
            raise _package_error(
                "skill_invalid", "A declared skill is invalid.", skill=name
            ) from exc

    def _parse_workspace(self, root: Path, entries: list) -> ParsedWorkspace:
        files: list[ParsedWorkspaceFile] = []
        directories: list[str] = []
        destinations: set[str] = set()
        for entry in entries:
            destination = _workspace_path(entry.path)
            if destination in destinations:
                raise _package_error(
                    "duplicate_workspace_path",
                    "Workspace destinations must be unique.",
                    workspace_path=destination,
                )
            destinations.add(destination)
            if entry.type == "directory":
                directories.append(destination)
                continue

            source = _resolve_file(root, entry.source)
            files.append(
                ParsedWorkspaceFile(
                    source=entry.source,
                    path=destination,
                    content=source.read_bytes(),
                )
            )
        return ParsedWorkspace(files=files, directories=directories)
