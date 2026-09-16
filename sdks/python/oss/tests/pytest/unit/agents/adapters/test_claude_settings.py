"""The Python claude adapter: ``build_claude_settings_files`` (Layer 1 + Layer 2/3 derivation).

This is the translation that used to live in the TS runner's ``claude-settings.ts``. It merges
three rule sources into one ``.claude/settings.json``: the author's first-class harness
``permissions`` slice, the Layer-2 sandbox-boundary derivation, and the per-MCP-server Layer-3
permissions. The runner is now a dumb writer of the rendered ``harnessFiles`` entry this produces.
"""

from __future__ import annotations

import json

import pytest

from agenta.sdk.agents.adapters.claude_settings import (
    INTERNAL_TOOL_MCP_SERVER,
    build_claude_settings_files,
)
from agenta.sdk.agents.dtos import SandboxPermission
from agenta.sdk.agents.mcp import MCPPolicy, ResolvedMCPServer
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


def _mcp(name: str, permission=None) -> ResolvedMCPServer:
    return ResolvedMCPServer(
        name=name,
        url="https://x",
        policy=MCPPolicy(permission=permission),
    )


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
    server = _mcp("github", "deny")
    files = build_claude_settings_files(None, None, [server])
    perms = _settings(files)["permissions"]
    assert perms["deny"] == ["mcp__github"]
    assert "allow" not in perms
    assert "ask" not in perms


def test_mcp_permissions_route_to_their_lists_and_skip_unset():
    servers = [
        _mcp("filesystem", "allow"),
        _mcp("github", "ask"),
        _mcp("shell", "deny"),
        _mcp("unset"),
    ]
    perms = _settings(build_claude_settings_files(None, None, servers))["permissions"]
    assert perms["allow"] == ["mcp__filesystem"]
    assert perms["ask"] == ["mcp__github"]
    assert perms["deny"] == ["mcp__shell"]


def test_per_tool_mcp_permissions_render_per_tool_rules():
    """D2: a denied tool Claude still advertises is a tool the model will try.

    A deny rule is what removes it from this harness's catalog, so the per-tool table has to reach
    the settings file and not only the runner's gate.
    """
    server = ResolvedMCPServer(
        name="acme",
        url="https://x",
        policy=MCPPolicy(
            permission="allow",
            tool_permissions={"purge": "deny", "search": "ask", "read": "allow"},
        ),
    )

    perms = _settings(build_claude_settings_files(None, None, [server]))["permissions"]

    # The server rule carries the resolved default for unnamed tools; a named tool gets its own
    # rule only where it is STRICTER, because Claude takes the most restrictive matching rule
    # rather than the most specific (D37).
    #
    # That default is `ask`, not the server's `allow` (D88): once a per-tool table is declared,
    # the runner's ladder decides the tools it does not name and never consults `permission`, so
    # reading `permission` here let a tool the author never named run unapproved under Claude
    # while the same configuration raised a gate under Pi.
    #
    # `read: allow` is now LOOSER than that default, so no whole-server rule can stand beside it
    # and every named tool carries its own. The tools this table does not name fall to the runner
    # gate, which is the trade-off the case further down documents.
    assert perms["allow"] == ["mcp__acme__read"]
    assert perms["ask"] == ["mcp__acme__search"]
    assert perms["deny"] == ["mcp__acme__purge"]
    assert _claude_decision(perms, "acme", "unnamed") is None


def test_per_tool_rules_render_without_a_whole_server_permission():
    """The per-tool table is an opt-in of its own; it must not need a server permission beside it."""
    server = ResolvedMCPServer(
        name="acme",
        url="https://x",
        policy=MCPPolicy(tool_permissions={"purge": "deny"}),
    )

    perms = _settings(build_claude_settings_files(None, None, [server]))["permissions"]

    assert perms["deny"] == ["mcp__acme__purge"]
    assert "allow" not in perms


def test_an_unset_per_tool_permission_contributes_no_rule():
    server = ResolvedMCPServer(
        name="acme",
        url="https://x",
        policy=MCPPolicy(permission="ask"),
    )

    perms = _settings(build_claude_settings_files(None, None, [server]))["permissions"]

    assert perms["ask"] == ["mcp__acme"]
    assert "deny" not in perms


def test_reserved_internal_mcp_server_name_does_not_render_whole_server_rule():
    server = _mcp(INTERNAL_TOOL_MCP_SERVER, "deny")
    tool = CallbackToolSpec(
        name="get_user", description="d", call_ref="tools__x", permission="allow"
    )
    perms = _settings(build_claude_settings_files(None, None, [server], [tool]))[
        "permissions"
    ]

    rendered_rules = [
        rule for rules in perms.values() if isinstance(rules, list) for rule in rules
    ]
    assert perms["allow"] == [_rule("get_user")]
    assert "deny" not in perms
    assert f"mcp__{INTERNAL_TOOL_MCP_SERVER}" not in rendered_rules


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
        [{"name": "github", "policy": {"permission": "deny"}}],
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
    assert build_claude_settings_files(None, None, [_mcp("x")]) == []


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
    spec = CallbackToolSpec(name="mystery", description="d", call_ref="workflow.x")
    assert build_claude_settings_files(None, None, None, [spec]) == []


@pytest.mark.parametrize(
    ("mode", "read_only", "expected_key", "expected_rule"),
    [
        ("allow_reads", True, "allow", _rule("tool")),
        ("allow_reads", False, None, None),
        ("allow_reads", None, None, None),
        ("allow", None, "allow", _rule("tool")),
        ("ask", True, None, None),
        ("deny", True, "deny", _rule("tool")),
    ],
)
def test_unset_tool_rules_follow_runner_mode(
    mode, read_only, expected_key, expected_rule
):
    spec = CallbackToolSpec(
        name="tool", description="d", call_ref="workflow.x", read_only=read_only
    )
    files = build_claude_settings_files(None, None, None, [spec], mode)
    if expected_key is None:
        assert files == []
        return
    perms = _settings(files)["permissions"]
    assert perms[expected_key] == [expected_rule]


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


def test_client_tool_allow_renders_allow_rule():
    # `client` tools now ride the same `agenta-tools` channel (the runner advertises them and
    # pauses their tools/call for the browser), so an explicit `allow` renders an allow rule —
    # without it Claude's own gate fires first and the pause path is bypassed.
    spec = ClientToolSpec(name="ui_pick", description="d", permission="allow")
    perms = _settings(build_claude_settings_files(None, None, None, [spec]))[
        "permissions"
    ]
    assert perms["allow"] == [_rule("ui_pick")]
    assert "ask" not in perms
    assert "deny" not in perms


def test_client_tool_unset_renders_allow_rule():
    # Unset -> allow too: the runner-side pause seam is the authoritative gate (pausing for the
    # browser IS the ask flow), so the Claude gate must stand down by default.
    spec = ClientToolSpec(name="request_connection", description="d")
    perms = _settings(build_claude_settings_files(None, None, None, [spec]))[
        "permissions"
    ]
    assert perms["allow"] == [_rule("request_connection")]


def test_client_tool_ask_renders_allow_rule():
    # An explicit `ask` ALSO renders allow (not an ask rule): a Claude-side ask would duplicate
    # the runner's pause gate in a worse place — the pause is the ask for a client tool.
    spec = ClientToolSpec(name="ui_pick", description="d", permission="ask")
    perms = _settings(build_claude_settings_files(None, None, None, [spec]))[
        "permissions"
    ]
    assert perms["allow"] == [_rule("ui_pick")]
    assert "ask" not in perms


def test_client_tool_deny_renders_deny_rule():
    # Deny stays deny — the one verdict Claude should enforce before the runner is reached.
    spec = ClientToolSpec(name="ui_pick", description="d", permission="deny")
    perms = _settings(build_claude_settings_files(None, None, None, [spec]))[
        "permissions"
    ]
    assert perms["deny"] == [_rule("ui_pick")]
    assert "allow" not in perms


def test_tool_rules_merge_with_author_and_mcp():
    # Author allow/deny first, then the per-MCP-server rule, then the per-tool rule append (deduped,
    # first-seen order preserved).
    server = _mcp("github", "allow")
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
    # renders its allow-by-default rule alongside the executable tool's derived allow.
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
    assert perms["allow"] == [_rule("get_user"), _rule("ui_pick")]


# --- D37: the generated rules must resolve the way the runner's gate does -------------------

_STRICTNESS = {"allow": 0, "ask": 1, "deny": 2}


def _runner_decision(server, new_tool, tool):
    """Mirror of `mcpToolPermission` in `services/runner/src/mcp-permission.ts`.

    Written out rather than imported because it lives in the runner's TypeScript; keeping a copy
    here is what lets this file assert the two agree. If the runner's ladder changes, this mirror
    has to change with it and the matrix below will say so.
    """
    opted_in = tool is not None or new_tool is not None
    if not opted_in:
        return server  # None means "the run's own default ladder decides"
    if tool is not None:
        return tool
    return new_tool or server or "ask"


def _claude_decision(perms, server_name, tool_name):
    """Resolve Claude's rules for one tool: every matching rule, most restrictive wins.

    This is the precedence D37 turned on — Claude does not prefer the most specific pattern — so
    the test has to model it rather than assume layering.
    """
    matching = [
        permission
        for permission, rules in perms.items()
        for rule in rules
        if rule in (f"mcp__{server_name}", f"mcp__{server_name}__{tool_name}")
    ]
    if not matching:
        return None  # no rule: Claude's global policy decides
    return max(matching, key=lambda value: _STRICTNESS[value])


@pytest.mark.parametrize("server_permission", ["allow", "ask", "deny", None])
@pytest.mark.parametrize("tool_permission", ["allow", "ask", "deny", None])
def test_generated_rules_resolve_the_way_the_runner_gate_does(
    server_permission, tool_permission
):
    """Every server decision crossed with every per-tool decision, for a NAMED tool.

    D37: the adapter used to emit the server's `permission` beside the per-tool table, and Claude
    resolves those together most-restrictively — so `deny` + `{echo: allow}` hid `echo` entirely.
    """
    policy_kwargs = {"permission": server_permission}
    if tool_permission is not None:
        policy_kwargs["tool_permissions"] = {"echo": tool_permission}
    server = ResolvedMCPServer(
        name="acme", url="https://x", policy=MCPPolicy(**policy_kwargs)
    )

    files = build_claude_settings_files(None, None, [server])
    perms = _settings(files)["permissions"] if files else {}

    expected = _runner_decision(server_permission, None, tool_permission)
    assert _claude_decision(perms, "acme", "echo") == expected


@pytest.mark.parametrize("server_permission", ["allow", "ask", "deny", None])
@pytest.mark.parametrize("new_tool_permission", ["allow", "ask", "deny", None])
@pytest.mark.parametrize("tool_permission", ["allow", "ask", "deny", None])
def test_the_new_tool_default_is_translated_too(
    server_permission, new_tool_permission, tool_permission
):
    """`new_tool_permission` reaches the rules, and a named tool still resolves exactly.

    It used not to be translated at all, so a tool with no entry fell to Claude's global policy
    instead of the resolved default.
    """
    policy_kwargs = {"permission": server_permission}
    if new_tool_permission is not None:
        policy_kwargs["new_tool_permission"] = new_tool_permission
    if tool_permission is not None:
        policy_kwargs["tool_permissions"] = {"echo": tool_permission}
    server = ResolvedMCPServer(
        name="acme", url="https://x", policy=MCPPolicy(**policy_kwargs)
    )

    files = build_claude_settings_files(None, None, [server])
    perms = _settings(files)["permissions"] if files else {}

    expected = _runner_decision(server_permission, new_tool_permission, tool_permission)
    assert _claude_decision(perms, "acme", "echo") == expected


@pytest.mark.parametrize(
    "server_permission,new_tool_permission,tool_permission",
    [
        ("deny", None, "allow"),
        ("ask", None, "allow"),
        (None, "deny", "allow"),
        (None, "ask", "allow"),
    ],
)
def test_a_tool_looser_than_the_default_keeps_its_rule_and_drops_the_server_rule(
    server_permission, new_tool_permission, tool_permission
):
    """The one shape Claude's rule language cannot express, and what is done instead.

    A server rule beside a looser named tool would win and take the tool with it — which for a
    `deny` server rule means the allowed tool vanishes from the catalog. So the server rule is
    dropped: the named tool resolves correctly, and the tools the table does not name become the
    runner gate's responsibility.
    """
    policy_kwargs = {
        "permission": server_permission,
        "tool_permissions": {"echo": tool_permission},
    }
    if new_tool_permission is not None:
        policy_kwargs["new_tool_permission"] = new_tool_permission
    server = ResolvedMCPServer(
        name="acme", url="https://x", policy=MCPPolicy(**policy_kwargs)
    )

    perms = _settings(build_claude_settings_files(None, None, [server]))["permissions"]

    assert _claude_decision(perms, "acme", "echo") == tool_permission
    # No whole-server rule, so an unnamed tool has no rule here at all.
    assert not any(
        "mcp__acme" in rules and "mcp__acme" == rule
        for rules in perms.values()
        for rule in rules
    )
    assert _claude_decision(perms, "acme", "unnamed") is None


def test_a_server_rule_survives_when_every_named_tool_is_stricter():
    """The expressible shape, which must keep its server rule: unnamed tools stay covered.

    The surviving rule carries `ask`, the runner's default for a declared table with no floor
    beside it, rather than the server's `allow` (D88).
    """
    server = ResolvedMCPServer(
        name="acme",
        url="https://x",
        policy=MCPPolicy(permission="allow", tool_permissions={"purge": "deny"}),
    )

    perms = _settings(build_claude_settings_files(None, None, [server]))["permissions"]

    assert perms["ask"] == ["mcp__acme"]
    assert perms["deny"] == ["mcp__acme__purge"]
    assert _claude_decision(perms, "acme", "unnamed") == "ask"


# --- D88: the matrices above only ever resolve a tool the table NAMES -----------------------
#
# Every case above asks what happens to `echo`, which is the tool `tool_permissions` names. The
# other half of the ladder was unmeasured on the Claude side: a tool the table does NOT mention,
# which is what `new_tool_permission` exists to decide and what an MCP server adds between two
# runs. For a named tool the table answers first, so those cases could never reach it.


def _runner_decision_unnamed(server_permission, new_tool_permission, has_tool_table):
    """Mirror of `mcpToolPermission` for a tool the per-tool table does not name.

    The opt-in is what the policy DECLARED, not what this tool matched:
    `normalizeMcpServerPermissions` treats a declared `toolPermissions` as opting in even with no
    `newToolPermission` beside it, and gives the tools it does not name `ask` — "a human decides
    for anything the table does not name". With nothing declared, the whole-server permission
    decides, and `None` there means the run's own default ladder does.
    """
    opted_in = new_tool_permission is not None or has_tool_table
    if not opted_in:
        return server_permission
    if new_tool_permission is not None:
        return new_tool_permission
    return "ask"


@pytest.mark.parametrize("server_permission", ["allow", "ask", "deny", None])
@pytest.mark.parametrize("new_tool_permission", ["allow", "ask", "deny", None])
@pytest.mark.parametrize("named_permission", ["allow", "ask", "deny", None])
def test_an_unnamed_tool_resolves_the_way_the_runner_gate_does(
    server_permission, new_tool_permission, named_permission
):
    """Every server decision crossed with every new-tool default and every named-tool entry,
    asked about a tool nobody named.

    Two outcomes are correct, and which one applies is not a detail: Claude either carries the
    resolved default as a whole-server rule, or carries no rule for this tool at all. The second
    is the deliberate trade-off the case above this one documents — a whole-server rule beside a
    LOOSER named tool would win and take that tool down with it, so the server rule is dropped and
    the tools the table does not name become the runner gate's responsibility. This asserts that
    the second outcome happens only in that shape, which is what nothing checked before.
    """
    policy_kwargs = {"permission": server_permission}
    if new_tool_permission is not None:
        policy_kwargs["new_tool_permission"] = new_tool_permission
    if named_permission is not None:
        policy_kwargs["tool_permissions"] = {"echo": named_permission}
    server = ResolvedMCPServer(
        name="acme", url="https://x", policy=MCPPolicy(**policy_kwargs)
    )

    files = build_claude_settings_files(None, None, [server])
    perms = _settings(files)["permissions"] if files else {}

    default = _runner_decision_unnamed(
        server_permission, new_tool_permission, named_permission is not None
    )
    looser_named_tool = (
        named_permission is not None
        and default is not None
        and _STRICTNESS[named_permission] < _STRICTNESS[default]
    )
    decided = _claude_decision(perms, "acme", "a_tool_nobody_named")

    if looser_named_tool:
        assert decided is None, (
            "a whole-server rule here would out-restrict the looser named tool and hide it; "
            "the runner gate covers the unnamed tools instead"
        )
    else:
        assert decided == default

    # Whichever branch applied, the named tool must still resolve exactly as the runner decides.
    if named_permission is not None:
        assert _claude_decision(perms, "acme", "echo") == named_permission
