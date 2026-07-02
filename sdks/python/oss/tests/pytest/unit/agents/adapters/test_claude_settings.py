"""The Python claude adapter: ``build_claude_settings_files`` (Layer 1 + Layer 2/3 derivation).

This is the translation that used to live in the TS runner's ``claude-settings.ts``. It merges
three rule sources into one ``.claude/settings.json``: the author's first-class harness
``permissions`` slice, the Layer-2 sandbox-boundary derivation, and the per-MCP-server Layer-3
permissions. The runner is now a dumb writer of the rendered ``harnessFiles`` entry this produces.
"""

from __future__ import annotations

import json

from agenta.sdk.agents.adapters.claude_settings import (
    INTERNAL_TOOL_MCP_SERVER,
    build_claude_settings_files,
)
from agenta.sdk.agents.dtos import SandboxPermission
from agenta.sdk.agents.mcp import ResolvedMCPServer
from agenta.sdk.agents.tools.models import (
    CallbackToolSpec,
    ClientToolSpec,
    CodeToolSpec,
)


def _rule(name: str) -> str:
    return f"mcp__{INTERNAL_TOOL_MCP_SERVER}__{name}"


def _settings(files):
    """Unwrap the single rendered file and parse its JSON content."""
    assert len(files) == 1
    assert files[0]["path"] == ".claude/settings.json"
    return json.loads(files[0]["content"])


def _claude(permissions):
    # The first arg to build_claude_settings_files is the harness's `permissions` slice directly.
    return permissions


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


def test_malformed_permissions_slice_renders_nothing():
    # A non-permissions dict (e.g. a stray Pi prompt slice mistakenly passed) yields no rules.
    assert build_claude_settings_files({"system": "You are Pi."}) == []


# --------------------------------------------------------------------------- F-046:
# per-resolved-tool rules for the internal `agenta-tools` MCP server. Backend-resolved
# executable tools (callback/code) are delivered to Claude as `mcp__agenta-tools__<name>`;
# Claude's own permission gate fires before the runner relay, so the tool's permission must be
# rendered here or an `allow` tool always parks.


def test_allow_executable_tool_renders_allow_rule():
    # An explicit-`allow` callback tool produces `mcp__agenta-tools__<name>` in `permissions.allow`
    # so Claude runs it without raising its gate (no park).
    spec = CallbackToolSpec(
        name="capital_lookup",
        description="d",
        call_ref="workflow.x",
        permission="allow",
    )
    perms = _settings(build_claude_settings_files(None, None, None, [spec]))[
        "permissions"
    ]
    assert perms["allow"] == [_rule("capital_lookup")]
    assert "ask" not in perms
    assert "deny" not in perms


def test_read_only_executable_tool_derives_allow_rule():
    # No explicit permission + read_only=True -> effective `allow` -> an allow rule.
    spec = CallbackToolSpec(
        name="get_user", description="d", call_ref="tools__x", read_only=True
    )
    perms = _settings(build_claude_settings_files(None, None, None, [spec]))[
        "permissions"
    ]
    assert perms["allow"] == [_rule("get_user")]


def test_code_tool_allow_renders_allow_rule():
    # `code` tools are executable too, so they get a rule.
    spec = CodeToolSpec(
        name="calc", description="d", code="print(1)", permission="allow"
    )
    perms = _settings(build_claude_settings_files(None, None, None, [spec]))[
        "permissions"
    ]
    assert perms["allow"] == [_rule("calc")]


def test_ask_tool_not_in_allow():
    # An `ask` tool emits no allow rule -> the gate stays raised -> HITL park preserved. It rides
    # the `ask` list (mirrors the per-MCP-server helper), never the `allow` list.
    spec = CallbackToolSpec(
        name="writer", description="d", call_ref="workflow.x", permission="ask"
    )
    perms = _settings(build_claude_settings_files(None, None, None, [spec]))[
        "permissions"
    ]
    assert perms["ask"] == [_rule("writer")]
    assert "allow" not in perms


def test_unset_tool_renders_no_rule():
    # No explicit permission, no read_only, no needs_approval -> effective permission is None ->
    # no rule at all (falls back to the global `permission_policy`). With nothing else to write,
    # the whole file is omitted.
    spec = CallbackToolSpec(name="mystery", description="d", call_ref="workflow.x")
    assert build_claude_settings_files(None, None, None, [spec]) == []


def test_deny_tool_renders_deny_rule():
    # `deny` emits a deny rule (also closes a local-Claude execution-path gap).
    spec = CallbackToolSpec(
        name="danger", description="d", call_ref="workflow.x", permission="deny"
    )
    perms = _settings(build_claude_settings_files(None, None, None, [spec]))[
        "permissions"
    ]
    assert perms["deny"] == [_rule("danger")]
    assert "allow" not in perms


def test_client_tool_excluded():
    # `client` tools are browser-fulfilled, never delivered over the `agenta-tools` channel, so
    # they contribute no rule even with an explicit `allow`.
    spec = ClientToolSpec(name="ui_pick", description="d", permission="allow")
    assert build_claude_settings_files(None, None, None, [spec]) == []


def test_tool_rules_merge_with_author_and_mcp():
    # Author allow/deny first, then the per-MCP-server rule, then the per-tool rule append (deduped,
    # first-seen order preserved).
    server = ResolvedMCPServer(
        name="github", transport="http", url="https://x", permission="allow"
    )
    allow_tool = CallbackToolSpec(
        name="capital_lookup",
        description="d",
        call_ref="workflow.x",
        permission="allow",
    )
    deny_tool = CodeToolSpec(name="rm", description="d", code="x", permission="deny")
    perms = _settings(
        build_claude_settings_files(
            _claude({"allow": ["Read"], "deny": ["Write"]}),
            None,
            [server],
            [allow_tool, deny_tool],
        )
    )["permissions"]
    assert perms["allow"] == ["Read", "mcp__github", _rule("capital_lookup")]
    assert perms["deny"] == ["Write", _rule("rm")]


def test_tool_rules_accept_plain_dicts():
    # The builder coerces plain wire dicts so the same permission ladder applies; a `client` dict
    # is excluded.
    perms = _settings(
        build_claude_settings_files(
            None,
            None,
            None,
            [
                {
                    "name": "get_user",
                    "description": "d",
                    "callRef": "tools__x",
                    "kind": "callback",
                    "readOnly": True,
                },
                {"name": "ui_pick", "description": "d", "kind": "client"},
            ],
        )
    )["permissions"]
    assert perms["allow"] == [_rule("get_user")]
