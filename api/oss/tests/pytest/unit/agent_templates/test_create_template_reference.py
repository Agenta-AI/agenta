"""Drift protection for the create-template skill's package-format reference.

The reference ships in the SDK (``agenta_builtins.CREATE_TEMPLATE_SKILL``), which cannot import
the API. These tests hold it to the real format: its example package must parse with the
template parser, and it must name every manifest field the parser reads.
"""

import json
import re
from pathlib import Path

from pydantic import BaseModel

from agenta.sdk.agents.adapters.agenta_builtins import CREATE_TEMPLATE_SKILL

from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    ResolvedTemplateSource,
)
from oss.src.core.agent_templates.models import (
    AgentaExtensionManifest,
    GatewayConnectionOption,
    MCPConnectionOption,
    ScheduleTrigger,
    SubscriptionTrigger,
    TemplateAgentDeclaration,
    TemplateAutomationRecipe,
    TemplateConnectionRequirement,
    TemplatePermissions,
    WorkspaceDirectoryDeclaration,
    WorkspaceFileDeclaration,
)
from oss.src.core.agent_templates.parser import TemplatePackageParser
from oss.src.core.agent_templates.sources import package_digest

_SCHEMAS = (
    Path(__file__).resolve().parents[5]
    / "oss"
    / "src"
    / "resources"
    / "agent_templates"
    / "schemas"
)

_EXAMPLE_FILE = re.compile(r"^#### `([^`]+)`\n\n```[a-z]*\n(.*?)\n```$", re.M | re.S)


def _reference() -> str:
    for bundled in CREATE_TEMPLATE_SKILL.files:
        if bundled.path == "references/package-format.md":
            return bundled.content
    raise AssertionError("create-template does not bundle references/package-format.md")


def _example_files() -> dict[str, str]:
    files = dict(_EXAMPLE_FILE.findall(_reference()))
    assert "plugin.json" in files and "ai.agenta/agents.json" in files
    return files


def _write_example(root: Path) -> None:
    for relative, content in _example_files().items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content + "\n", encoding="utf-8")


def test_reference_example_package_parses_with_the_template_parser(tmp_path):
    root = tmp_path / "seo-assistant"
    _write_example(root)
    plugin = json.loads((root / "plugin.json").read_text(encoding="utf-8"))

    package = TemplatePackageParser().parse(
        ResolvedTemplateSource(
            source=InternalTemplateSource(key=plugin["name"]),
            root=root,
            version=plugin["version"],
            digest=package_digest(root),
        )
    )

    assert package.agent.setup
    assert [skill.name for skill in package.skills] == ["article-brief"]
    assert package.agent.connections and package.agent.automations
    assert package.workspace.files and package.workspace.directories


def test_reference_names_every_manifest_field():
    reference = _reference()
    models: list[type[BaseModel]] = [
        AgentaExtensionManifest,
        TemplateAgentDeclaration,
        TemplateConnectionRequirement,
        GatewayConnectionOption,
        MCPConnectionOption,
        TemplatePermissions,
        TemplateAutomationRecipe,
        ScheduleTrigger,
        SubscriptionTrigger,
        WorkspaceFileDeclaration,
        WorkspaceDirectoryDeclaration,
    ]
    fields = {name for model in models for name in model.model_fields}
    missing = sorted(
        field
        for field in fields
        if f"`{field}`" not in reference and f'"{field}"' not in reference
    )
    assert not missing, f"package-format.md does not name: {missing}"


def test_reference_names_every_plugin_manifest_field():
    reference = _reference()
    schema = json.loads((_SCHEMAS / "plugin.schema.json").read_text(encoding="utf-8"))
    missing = sorted(
        field for field in schema["properties"] if f"`{field}`" not in reference
    )
    assert not missing, f"package-format.md does not name: {missing}"
    assert schema["properties"]["$schema"]["const"] in reference


def test_reference_example_package_carries_no_project_bindings():
    files = _example_files()
    manifest = json.loads(files["ai.agenta/agents.json"])
    agent = next(iter(manifest["agents"].values()))
    for requirement in agent["connections"]:
        for option in requirement["options"]:
            assert "slug" not in option and "connection" not in option
    assert "headers" not in files.get("mcp.json", "")
