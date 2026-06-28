"""Harness adapters: the neutral ``SessionConfig`` -> per-harness config translation.

Pi and Claude genuinely differ (Pi takes built-ins and never gates tool use; Claude has no
built-ins, delivers tools over MCP, and gates on a permission policy). Agenta is Pi with a
fixed opinion: a forced preamble, persona, tools, and platform skills. The author's resolved
inline skills ride the neutral config and the forced platform skill(s) are unioned in. These
tests lock that the translation honors those differences and that ``make_harness`` validates
support.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents import (
    AgentaAgentConfig,
    AgentaHarness,
    AgentConfig,
    ClaudeAgentConfig,
    ClaudeHarness,
    ClientToolSpec,
    HarnessType,
    PiAgentConfig,
    PiHarness,
    SessionConfig,
    ToolCallback,
    UnsupportedHarnessError,
    make_harness,
)
from agenta.sdk.agents.adapters import harnesses
from agenta.sdk.agents.adapters.agenta_builtins import (
    AGENTA_FORCED_APPEND_SYSTEM,
    AGENTA_FORCED_SKILLS,
    AGENTA_FORCED_TOOLS,
    GETTING_STARTED_WITH_AGENTA_SKILL,
    AGENTA_PREAMBLE,
    force_skills,
)
from agenta.sdk.agents.adapters.harnesses import _normalize_tool_specs, _opt_str

_CALLBACK = ToolCallback(endpoint="https://api.example/tools/call", authorization=None)


def _session_config(**kwargs) -> SessionConfig:
    agent = kwargs.pop("agent", AgentConfig(instructions="hi", model="m"))
    return SessionConfig(agent=agent, **kwargs)


# --------------------------------------------------------------------------- Pi


def test_pi_keeps_builtins_and_native_tools(make_env):
    harness = PiHarness(make_env(supported=[HarnessType.PI]))
    config = _session_config(
        builtin_tools=["read", "write"],
        custom_tools=[{"name": "t", "callRef": "ref"}],
        tool_callback=_CALLBACK,
    )

    result = harness._to_harness_config(config)

    assert isinstance(result, PiAgentConfig)
    assert result.builtin_tools == ["read", "write"]
    assert result.custom_tools[0]["name"] == "t"
    assert result.tool_callback is _CALLBACK
    assert result.agents_md == "hi"
    assert result.model == "m"


def test_pi_reads_its_harness_kwargs_slice(make_env):
    harness = PiHarness(make_env(supported=[HarnessType.PI]))
    agent = AgentConfig(
        instructions="hi",
        harness_kwargs={
            "pi_core": {"system": "You are Pi.", "append_system": "Be terse."},
            "claude": {"system": "ignored for Pi"},
        },
    )
    config = _session_config(agent=agent)

    result = harness._to_harness_config(config)

    assert result.system == "You are Pi."
    assert result.append_system == "Be terse."
    # The Pi prompt overrides reach the wire.
    assert result.wire_prompt() == {
        "systemPrompt": "You are Pi.",
        "appendSystemPrompt": "Be terse.",
    }


def test_pi_drops_blank_harness_kwargs(make_env):
    harness = PiHarness(make_env(supported=[HarnessType.PI]))
    agent = AgentConfig(
        instructions="hi",
        harness_kwargs={"pi_core": {"system": "   ", "append_system": ""}},
    )

    result = harness._to_harness_config(_session_config(agent=agent))

    assert result.system is None
    assert result.append_system is None
    assert result.wire_prompt() == {}


# ------------------------------------------------------------------------- Agenta


def test_agenta_forces_tools_preamble_and_persona_and_carries_skills(make_env):
    harness = AgentaHarness(make_env(supported=[HarnessType.AGENTA]))
    skill = {
        "name": "release-notes",
        "description": "Draft release notes.",
        "body": "Read the changelog, then write notes.",
    }
    config = _session_config(
        agent=AgentConfig(instructions="My project rules.", model="m", skills=[skill]),
        builtin_tools=["web_search"],
        custom_tools=[{"name": "t", "callRef": "ref"}],
        tool_callback=_CALLBACK,
    )

    result = harness._to_harness_config(config)

    assert isinstance(result, AgentaAgentConfig)
    # AGENTS.md is the base preamble with the author's instructions appended after it.
    assert result.agents_md.startswith(AGENTA_PREAMBLE)
    assert result.agents_md.endswith("My project rules.")
    # Forced tools are unioned in (and `read` is present so Pi renders the skills section).
    for forced in AGENTA_FORCED_TOOLS:
        assert forced in result.builtin_tools
    assert "web_search" in result.builtin_tools
    assert "read" in result.builtin_tools
    # The author's resolved inline skills ride the config, plus the forced platform skill(s) the
    # harness always injects. The author's skill comes first; the platform skill is appended.
    skill_names = [s.name for s in result.skills]
    assert skill_names[0] == "release-notes"
    assert GETTING_STARTED_WITH_AGENTA_SKILL.name in skill_names
    assert "skills" not in result.wire_tools()
    assert result.wire_skills()["skills"][0]["name"] == "release-notes"
    # The persona is forced onto append_system; custom tools and callback pass through.
    assert result.append_system.startswith(AGENTA_FORCED_APPEND_SYSTEM)
    assert result.custom_tools[0]["name"] == "t"
    assert result.tool_callback is _CALLBACK


def test_agenta_forces_platform_skill_on_a_skill_less_config(make_env):
    # The actually-forced behavior: a custom pi_agenta config with NO skills (the default
    # template's `_agenta` embed dropped) still carries the platform skill on every run.
    harness = AgentaHarness(make_env(supported=[HarnessType.AGENTA]))
    config = _session_config(
        agent=AgentConfig(instructions="My project rules.", model="m", skills=[])
    )

    result = harness._to_harness_config(config)

    assert [s.name for s in result.skills] == [GETTING_STARTED_WITH_AGENTA_SKILL.name]


def test_agenta_does_not_duplicate_an_already_present_platform_skill(make_env):
    # A config that already carries the resolved platform skill (e.g. via the default template's
    # embed) is not doubled: the author's copy wins on the name clash.
    harness = AgentaHarness(make_env(supported=[HarnessType.AGENTA]))
    existing = GETTING_STARTED_WITH_AGENTA_SKILL.model_dump(mode="json")
    config = _session_config(
        agent=AgentConfig(instructions="hi", model="m", skills=[existing])
    )

    result = harness._to_harness_config(config)

    names = [s.name for s in result.skills]
    assert names.count(GETTING_STARTED_WITH_AGENTA_SKILL.name) == 1


def test_force_skills_unions_forced_after_author_skills():
    from agenta.sdk.agents.skills import SkillConfig

    author = SkillConfig(
        name="release-notes", description="Draft notes.", body="Do it."
    )

    out = force_skills([author])

    assert out[0] is author
    assert {s.name for s in out} == {"release-notes"} | {
        s.name for s in AGENTA_FORCED_SKILLS
    }


def test_agenta_forces_tools_without_duplicates(make_env):
    harness = AgentaHarness(make_env(supported=[HarnessType.AGENTA]))
    # `read` already configured: it must not be duplicated when forced.
    config = _session_config(builtin_tools=["read"])

    result = harness._to_harness_config(config)

    assert result.builtin_tools.count("read") == 1


def test_agenta_passes_through_user_pi_options(make_env):
    harness = AgentaHarness(make_env(supported=[HarnessType.AGENTA]))
    agent = AgentConfig(
        instructions="hi",
        harness_kwargs={
            "pi_core": {"system": "You are Pi.", "append_system": "Be terse."}
        },
    )

    result = harness._to_harness_config(_session_config(agent=agent))

    # `system` passes through; the author's `append_system` is appended after the forced persona.
    assert result.system == "You are Pi."
    assert result.append_system.startswith(AGENTA_FORCED_APPEND_SYSTEM)
    assert result.append_system.endswith("Be terse.")


def test_agenta_is_sandbox_agent_supported():
    # Agenta is Pi with an opinion, so the sandbox-agent backend drives it too (on the `pi` ACP
    # agent, with the runner laying the forced skills into the sandbox). This is what lets
    # `agenta` run on a non-local sandbox (e.g. daytona) instead of raising.
    from agenta.sdk.agents import SandboxAgentBackend

    assert SandboxAgentBackend(url="http://runner").supports(HarnessType.AGENTA)


# ------------------------------------------------------------------------- Claude


def test_claude_drops_builtins_and_warns(make_env, monkeypatch):
    recorded = []
    monkeypatch.setattr(
        harnesses,
        "log",
        type("L", (), {"warning": lambda self, *a, **k: recorded.append(a)})(),
    )
    harness = ClaudeHarness(make_env(supported=[HarnessType.CLAUDE]))
    config = _session_config(
        builtin_tools=["read"],
        custom_tools=[{"name": "t", "callRef": "ref"}],
        permission_policy="deny",
    )

    result = harness._to_harness_config(config)

    assert isinstance(result, ClaudeAgentConfig)
    assert not hasattr(result, "builtin_tools")  # Claude has no built-in tools at all
    assert result.custom_tools[0]["name"] == "t"
    assert result.permission_policy == "deny"  # Claude carries the policy
    assert recorded, "expected a warning when built-ins are dropped"


def test_claude_carries_skills_for_project_local_materialization(make_env):
    harness = ClaudeHarness(make_env(supported=[HarnessType.CLAUDE]))
    skill = {
        "name": "release-notes",
        "description": "Draft release notes.",
        "body": "Read the changelog, then write notes.",
    }
    config = _session_config(
        agent=AgentConfig(instructions="hi", model="m", skills=[skill])
    )

    result = harness._to_harness_config(config)

    # Claude keeps resolved inline packages on the config. The runner materializes them under
    # `.claude/skills/<name>` in the session cwd, matching Claude's project-local skill layout.
    assert [s.name for s in result.skills] == ["release-notes"]
    assert result.wire_skills()["skills"][0]["name"] == "release-notes"


def test_claude_no_warning_without_builtins(make_env, monkeypatch):
    recorded = []
    monkeypatch.setattr(
        harnesses,
        "log",
        type("L", (), {"warning": lambda self, *a, **k: recorded.append(a)})(),
    )
    harness = ClaudeHarness(make_env(supported=[HarnessType.CLAUDE]))

    harness._to_harness_config(_session_config(permission_policy="auto"))

    assert recorded == []


def test_claude_threads_options_and_renders_settings_file(make_env):
    import json

    harness = ClaudeHarness(make_env(supported=[HarnessType.CLAUDE]))
    options = {
        "claude": {
            "permissions": {
                "default_mode": "acceptEdits",
                "allow": ["Read"],
                "deny": ["Write", "Edit"],
            }
        },
        "pi_core": {"system": "ignored for Claude"},
    }
    agent = AgentConfig(instructions="hi", model="m", harness_kwargs=options)

    result = harness._to_harness_config(_session_config(agent=agent))

    # The whole map is threaded onto the config; the claude config's `wire_harness_files` (the
    # Python claude adapter) translates its own `claude.permissions` slice into a rendered file.
    assert result.harness_kwargs == options
    wire = result.wire_harness_files()
    assert wire["harnessFiles"][0]["path"] == ".claude/settings.json"
    assert json.loads(wire["harnessFiles"][0]["content"]) == {
        "permissions": {
            "defaultMode": "acceptEdits",
            "allow": ["Read"],
            "deny": ["Write", "Edit"],
        }
    }


def test_claude_without_harness_kwargs_renders_no_files(make_env):
    harness = ClaudeHarness(make_env(supported=[HarnessType.CLAUDE]))

    result = harness._to_harness_config(_session_config())

    assert result.harness_kwargs == {}
    assert result.wire_harness_files() == {}


# --------------------------------------------------------------- _normalize_tool_specs


def test_compat_normalize_tool_specs_returns_typed_specs():
    specs = [
        {"name": "keep", "callRef": "r1"},  # missing description + inputSchema
        {
            "name": "full",
            "description": "d",
            "inputSchema": {"type": "object", "properties": {"x": {}}},
            "callRef": "r2",
        },
    ]

    out = _normalize_tool_specs(specs)

    assert [spec.name for spec in out] == ["keep", "full"]
    # description falls back to the name; inputSchema falls back to an empty object schema.
    assert out[0].description == "keep"
    assert out[0].input_schema == {"type": "object", "properties": {}}
    assert out[0].call_ref == "r1"
    # provided values are preserved.
    assert out[1].description == "d"
    assert out[1].input_schema["properties"] == {"x": {}}


def test_harness_accepts_typed_tool_specs_without_normalizing_dicts(make_env):
    harness = PiHarness(make_env(supported=[HarnessType.PI]))
    spec = ClientToolSpec(name="pick", description="Pick")
    result = harness._to_harness_config(_session_config(tool_specs=[spec]))
    assert result.tool_specs == [spec]


def test_normalize_tool_specs_empty():
    assert _normalize_tool_specs([]) == []
    assert _normalize_tool_specs(None) == []


def test_opt_str_keeps_only_nonempty_strings():
    assert _opt_str("hi") == "hi"
    assert _opt_str("  ") is None
    assert _opt_str("") is None
    assert _opt_str(None) is None
    assert _opt_str(123) is None


# -------------------------------------------------------------------- make_harness


def test_make_harness_maps_string_to_class(make_env):
    env = make_env(supported=[HarnessType.PI, HarnessType.CLAUDE, HarnessType.AGENTA])
    assert isinstance(make_harness("pi_core", env), PiHarness)
    assert isinstance(
        make_harness("PI_CORE", env), PiHarness
    )  # coerced, case-insensitive
    assert isinstance(make_harness("claude", env), ClaudeHarness)
    assert isinstance(make_harness(HarnessType.CLAUDE, env), ClaudeHarness)
    assert isinstance(make_harness("pi_agenta", env), AgentaHarness)
    assert isinstance(make_harness(HarnessType.AGENTA, env), AgentaHarness)


def test_make_harness_unsupported_backend_raises(make_env):
    env = make_env(supported=[HarnessType.PI])  # backend cannot drive Claude
    with pytest.raises(UnsupportedHarnessError):
        make_harness("claude", env)


def test_make_harness_unknown_name_raises(make_env):
    env = make_env(supported=[HarnessType.PI])
    with pytest.raises(ValueError):
        make_harness("bogus", env)
