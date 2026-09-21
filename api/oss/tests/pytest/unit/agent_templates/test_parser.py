import json
import shutil
from pathlib import Path

import pytest

from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    ResolvedTemplateSource,
)
from oss.src.core.agent_templates.exceptions import TemplatePackageInvalid
from oss.src.core.agent_templates.parser import TemplatePackageParser
from oss.src.core.agent_templates.sources import package_digest


FIXTURES = Path(__file__).with_name("fixtures")


def _resolved(
    root: Path, *, key: str = "outbound-prospecting"
) -> ResolvedTemplateSource:
    return ResolvedTemplateSource(
        source=InternalTemplateSource(key=key),
        root=root,
        version="1.0.0",
        digest=package_digest(root),
    )


def _copy_fixture(tmp_path: Path, name: str = "current") -> Path:
    destination = tmp_path / name
    shutil.copytree(FIXTURES / name, destination)
    return destination


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def test_parser_returns_one_agent_and_declared_resources():
    package = TemplatePackageParser().parse(_resolved(FIXTURES / "current"))

    assert package.agent.key == "outbound"
    assert package.agent.name == "Outbound Prospecting"
    assert package.agent.instructions.startswith("# Outbound Prospecting")
    assert package.skills[0].name == "prospect-research"
    assert package.workspace.files[0].path == "target-profile.md"
    assert package.workspace.files[0].content.startswith(b"# Target customer")
    assert package.workspace.directories == ["reports"]
    assert package.mcp_servers["mail-drafts"].url == "https://mcp.example.com/mail"


def test_minimal_package_omits_optional_resources():
    package = TemplatePackageParser().parse(
        _resolved(FIXTURES / "minimal", key="minimal-assistant")
    )

    assert package.agent.key == "assistant"
    assert package.agent.setup is None
    assert package.skills == []
    assert package.workspace.files == []
    assert package.workspace.directories == []
    assert package.mcp_servers == {}


def test_future_multi_agent_fixture_is_rejected():
    with pytest.raises(TemplatePackageInvalid) as error:
        TemplatePackageParser().parse(
            _resolved(FIXTURES / "future", key="outbound-team")
        )

    assert error.value.code == "subagents_not_supported"


@pytest.mark.parametrize(
    ("case", "expected_code"),
    [
        ("two-agents", "single_agent_required"),
        ("subagents", "subagents_not_supported"),
        ("path-traversal", "unsafe_package_path"),
        ("workspace-agents-md", "reserved_workspace_path"),
        ("workspace-dot", "unsafe_workspace_path"),
        ("stdio-mcp", "unsupported_mcp_transport"),
        ("sse-mcp", "unsupported_mcp_transport"),
        ("mcp-headers", "mcp_headers_not_supported"),
        ("missing-skill", "missing_skill"),
        ("entry-mismatch", "agent_entry_invalid"),
        ("duplicate-destination", "duplicate_workspace_path"),
        ("model-override", "extension_schema_invalid"),
        ("configuration-override", "extension_schema_invalid"),
    ],
)
def test_invalid_package_fails_before_writes(
    tmp_path: Path, case: str, expected_code: str
):
    root = _copy_fixture(tmp_path)
    manifest_path = root / "ai.agenta" / "agents.json"
    manifest = _read_json(manifest_path)
    agent = manifest["agents"]["outbound"]

    if case == "two-agents":
        manifest["agents"]["second"] = dict(agent)
    elif case == "subagents":
        agent["subagents"] = ["second"]
    elif case == "path-traversal":
        agent["instructions"] = "./ai.agenta/../plugin.json"
    elif case == "workspace-agents-md":
        agent["workspace"]["entries"][0]["path"] = "AGENTS.md"
    elif case == "workspace-dot":
        agent["workspace"]["entries"][0]["path"] = "."
    elif case == "stdio-mcp":
        mcp_path = root / "mcp.json"
        mcp = _read_json(mcp_path)
        mcp["mcpServers"]["mail-drafts"] = {"type": "stdio", "command": "node"}
        _write_json(mcp_path, mcp)
    elif case == "sse-mcp":
        mcp_path = root / "mcp.json"
        mcp = _read_json(mcp_path)
        mcp["mcpServers"]["mail-drafts"]["type"] = "sse"
        _write_json(mcp_path, mcp)
    elif case == "mcp-headers":
        mcp_path = root / "mcp.json"
        mcp = _read_json(mcp_path)
        mcp["mcpServers"]["mail-drafts"]["headers"] = {"Authorization": "secret"}
        _write_json(mcp_path, mcp)
    elif case == "missing-skill":
        shutil.rmtree(root / "skills" / "prospect-research")
    elif case == "entry-mismatch":
        manifest["entry"] = "missing"
    elif case == "duplicate-destination":
        agent["workspace"]["entries"].append(
            {"type": "directory", "path": "target-profile.md"}
        )
    elif case == "model-override":
        agent["llm"] = {"model": "forbidden"}
    elif case == "configuration-override":
        agent["configuration"] = {"runner": "forbidden"}

    _write_json(manifest_path, manifest)

    with pytest.raises(TemplatePackageInvalid) as error:
        TemplatePackageParser().parse(_resolved(root))

    assert error.value.code == expected_code


def test_invalid_utf8_in_instructions_is_rejected(tmp_path: Path):
    root = _copy_fixture(tmp_path)
    (root / "ai.agenta" / "agents" / "outbound" / "AGENTS.md").write_bytes(b"\xff")

    with pytest.raises(TemplatePackageInvalid) as error:
        TemplatePackageParser().parse(_resolved(root))

    assert error.value.code == "package_text_invalid"


def test_symlinked_workspace_source_is_rejected(tmp_path: Path):
    root = _copy_fixture(tmp_path)
    source = root / "ai.agenta" / "agents" / "outbound" / "files" / "target-profile.md"
    source.unlink()
    source.symlink_to(root / "README.md")

    with pytest.raises(TemplatePackageInvalid) as error:
        TemplatePackageParser().parse(
            ResolvedTemplateSource(
                source=InternalTemplateSource(key="outbound-prospecting"),
                root=root,
                version="1.0.0",
                digest="sha256:" + "0" * 64,
            )
        )

    assert error.value.code == "unsafe_package_path"


def test_executable_workspace_file_is_rejected(tmp_path: Path):
    root = _copy_fixture(tmp_path)
    source = root / "ai.agenta" / "agents" / "outbound" / "files" / "target-profile.md"
    source.chmod(0o755)

    with pytest.raises(TemplatePackageInvalid) as error:
        TemplatePackageParser().parse(_resolved(root))

    assert error.value.code == "executable_package_file"
