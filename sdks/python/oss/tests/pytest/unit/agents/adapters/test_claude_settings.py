"""The Python claude adapter: ``build_claude_settings_files`` (Layer 1 + Layer 2/3 derivation).

This is the translation that used to live in the TS runner's ``claude-settings.ts``. It merges
three rule sources into one ``.claude/settings.json``: the author's
``harness_kwargs["claude"]["permissions"]`` slice, the Layer-2 sandbox-boundary derivation, and
the per-MCP-server Layer-3 permissions. The runner is now a dumb writer of the rendered
``harnessFiles`` entry this produces.
"""

from __future__ import annotations

import json

from agenta.sdk.agents.adapters.claude_settings import build_claude_settings_files
from agenta.sdk.agents.dtos import SandboxPermission
from agenta.sdk.agents.mcp import ResolvedMCPServer


def _settings(files):
    """Unwrap the single rendered file and parse its JSON content."""
    assert len(files) == 1
    assert files[0]["path"] == ".claude/settings.json"
    return json.loads(files[0]["content"])


def _claude(permissions):
    return {"claude": {"permissions": permissions}}


def test_renders_author_mode_and_rules():
    files = build_claude_settings_files(
        _claude(
            {
                "default_mode": "acceptEdits",
                "allow": ["Read", "Bash(npm run:*)"],
                "deny": ["Write"],
                "ask": ["mcp__github__create_issue"],
            }
        )
    )
    assert _settings(files) == {
        "permissions": {
            "defaultMode": "acceptEdits",
            "allow": ["Read", "Bash(npm run:*)"],
            "deny": ["Write"],
            "ask": ["mcp__github__create_issue"],
        }
    }


def test_content_is_json_dumps_indent_2():
    # The exact serialization matters (it is pinned by the golden); assert the indent-2 form.
    files = build_claude_settings_files(_claude({"deny": ["Write"]}))
    assert files[0]["content"] == json.dumps(
        {"permissions": {"deny": ["Write"]}}, indent=2
    )


def test_network_off_denies_web_tools():
    files = build_claude_settings_files(
        None, SandboxPermission(network={"mode": "off"})
    )
    assert _settings(files)["permissions"]["deny"] == ["WebFetch", "WebSearch"]


def test_network_allowlist_denies_web_tools():
    files = build_claude_settings_files(
        None,
        SandboxPermission(network={"mode": "allowlist", "allowlist": ["10.0.0.0/8"]}),
    )
    assert _settings(files)["permissions"]["deny"] == ["WebFetch", "WebSearch"]


def test_filesystem_readonly_denies_write_edit():
    files = build_claude_settings_files(None, SandboxPermission(filesystem="readonly"))
    assert _settings(files)["permissions"]["deny"] == ["Write", "Edit"]


def test_filesystem_off_denies_write_edit():
    files = build_claude_settings_files(None, SandboxPermission(filesystem="off"))
    assert _settings(files)["permissions"]["deny"] == ["Write", "Edit"]


def test_mcp_permission_deny_renders_server_rule():
    server = ResolvedMCPServer(
        name="github", transport="http", url="https://x", permission="deny"
    )
    files = build_claude_settings_files(None, None, [server])
    perms = _settings(files)["permissions"]
    assert perms["deny"] == ["mcp__github"]
    assert "allow" not in perms
    assert "ask" not in perms


def test_mcp_permissions_route_to_their_lists_and_skip_unset():
    servers = [
        ResolvedMCPServer(
            name="filesystem", transport="http", url="https://x", permission="allow"
        ),
        ResolvedMCPServer(
            name="github", transport="http", url="https://x", permission="ask"
        ),
        ResolvedMCPServer(
            name="shell", transport="http", url="https://x", permission="deny"
        ),
        ResolvedMCPServer(name="unset", transport="http", url="https://x"),
    ]
    perms = _settings(build_claude_settings_files(None, None, servers))["permissions"]
    assert perms["allow"] == ["mcp__filesystem"]
    assert perms["ask"] == ["mcp__github"]
    assert perms["deny"] == ["mcp__shell"]


def test_merges_author_with_derived_and_dedupes():
    # Author `WebFetch` keeps its position; the network-derived `WebFetch` is deduped, and the
    # filesystem-derived `Write`/`Edit` append.
    files = build_claude_settings_files(
        _claude({"default_mode": "plan", "deny": ["WebFetch"]}),
        SandboxPermission(
            network={"mode": "allowlist", "allowlist": ["10.0.0.0/8"]},
            filesystem="readonly",
        ),
    )
    perms = _settings(files)["permissions"]
    assert perms["deny"] == ["WebFetch", "WebSearch", "Write", "Edit"]
    assert perms["defaultMode"] == "plan"


def test_invalid_default_mode_dropped():
    files = build_claude_settings_files(
        _claude({"default_mode": "yolo", "deny": ["Write"]})
    )
    perms = _settings(files)["permissions"]
    assert "defaultMode" not in perms
    assert perms["deny"] == ["Write"]


def test_accepts_camelcase_default_mode_alias():
    files = build_claude_settings_files(_claude({"defaultMode": "plan"}))
    assert _settings(files)["permissions"]["defaultMode"] == "plan"


def test_accepts_plain_dicts_for_sandbox_and_mcp():
    # The builder duck-types its inputs, so plain dicts (not pydantic models) work too.
    files = build_claude_settings_files(
        None,
        {"network": {"mode": "off"}},
        [{"name": "github", "permission": "deny"}],
    )
    perms = _settings(files)["permissions"]
    assert perms["deny"] == ["WebFetch", "WebSearch", "mcp__github"]


def test_empty_inputs_render_nothing():
    assert build_claude_settings_files(None) == []
    assert build_claude_settings_files({}) == []
    assert build_claude_settings_files(_claude({})) == []
    # network `on` + filesystem `on` derive nothing.
    assert (
        build_claude_settings_files(
            None, SandboxPermission(network={"mode": "on"}, filesystem="on")
        )
        == []
    )
    # an MCP server with no permission contributes nothing.
    assert (
        build_claude_settings_files(
            None, None, [ResolvedMCPServer(name="x", transport="http", url="https://x")]
        )
        == []
    )


def test_non_claude_slice_renders_nothing():
    # Only the `claude` slice is the claude adapter's concern; a `pi` slice contributes nothing.
    assert build_claude_settings_files({"pi": {"system": "You are Pi."}}) == []
