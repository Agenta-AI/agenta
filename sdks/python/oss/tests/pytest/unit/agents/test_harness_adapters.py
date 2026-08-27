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
    AgentaAgentTemplate,
    AgentaHarness,
    AgentTemplate,
    ClaudeAgentTemplate,
    ClaudeHarness,
    ClientToolSpec,
    CodexAgentTemplate,
    CodexHarness,
    HarnessKind,
    PiAgentTemplate,
    PiHarness,
    SessionConfig,
    ToolCallback,
    UnsupportedHarnessError,
    make_harness,
)
from agenta.sdk.agents.adapters.agenta_builtins import (
    AGENTA_FORCED_APPEND_SYSTEM,
    AGENTA_FORCED_SKILLS,
    GETTING_STARTED_WITH_AGENTA_SKILL,
    AGENTA_PREAMBLE,
    force_skills,
    gateway_guidance,
)
from agenta.sdk.agents.adapters.harnesses import _normalize_tool_specs, _opt_str
from agenta.sdk.agents.tools import (
    CompiledTool,
    ResolvedGatewayIntegration,
    ResolvedGatewayPolicy,
)

_CALLBACK = ToolCallback(endpoint="https://api.example/tools/call", authorization=None)


def _session_config(**kwargs) -> SessionConfig:
    agent = kwargs.pop("agent", AgentTemplate(instructions="hi", model="m"))
    return SessionConfig(agent=agent, **kwargs)


# --------------------------------------------------------------------------- Pi


def test_pi_keeps_native_tools(make_env):
    harness = PiHarness(make_env(supported=[HarnessKind.PI]))
    config = _session_config(
        custom_tools=[{"name": "t", "callRef": "ref"}],
        tool_callback=_CALLBACK,
    )

    result = harness._to_harness_config(config)

    assert isinstance(result, PiAgentTemplate)
    assert result.custom_tools[0]["name"] == "t"
    assert result.tool_callback is _CALLBACK
    assert result.agents_md == "hi"
    assert result.model == "m"


def test_pi_threads_model_ref_so_connection_reaches_resolver(make_env):
    """Regression: a named custom connection's ``{mode, slug}`` must survive the adapter.

    ``_to_harness_config`` builds the wire-producing harness template. If it drops
    ``model_ref`` (passing only the plain ``model`` string), the connection resolver never
    sees the slug, so it cannot select the OpenAI-compatible custom connection (the run then
    falls back to a default provider). Author intent itself no longer rides the ``/run``
    wire — only the resolved ``modelConnection`` (route + typed credentials) does.
    """
    harness = PiHarness(make_env(supported=[HarnessKind.PI]))
    agent = AgentTemplate(
        instructions="hi",
        model={
            "model": "gpt-4o-mini",
            "connection": {"mode": "agenta", "slug": "my-compat"},
        },
    )

    result = harness._to_harness_config(_session_config(agent=agent))

    assert result.model_ref is not None
    assert result.model_ref.connection.slug == "my-compat"
    # Unresolved author intent never rides the wire; only a resolved connection would.
    assert result.wire_model_connection() == {}


def test_agenta_threads_model_ref_so_connection_reaches_resolver(make_env):
    """Same guarantee as Pi for the ``pi_agenta`` harness (it also runs Pi)."""
    harness = AgentaHarness(make_env(supported=[HarnessKind.AGENTA]))
    agent = AgentTemplate(
        instructions="hi",
        model={
            "model": "gpt-4o-mini",
            "connection": {"mode": "agenta", "slug": "my-compat"},
        },
    )

    result = harness._to_harness_config(_session_config(agent=agent))

    assert result.model_ref is not None
    assert result.model_ref.connection.slug == "my-compat"
    assert result.wire_model_connection() == {}


def test_pi_reads_its_harness_extras_slice(make_env):
    harness = PiHarness(make_env(supported=[HarnessKind.PI]))
    agent = AgentTemplate(
        instructions="hi",
        harness_extras={"system": "You are Pi.", "append_system": "Be terse."},
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


def test_pi_drops_blank_harness_extras(make_env):
    harness = PiHarness(make_env(supported=[HarnessKind.PI]))
    agent = AgentTemplate(
        instructions="hi",
        harness_extras={"system": "   ", "append_system": ""},
    )

    result = harness._to_harness_config(_session_config(agent=agent))

    assert result.system is None
    assert result.append_system is None
    assert result.wire_prompt() == {}


# ------------------------------------------------------------------------- Agenta


def test_agenta_forces_preamble_and_persona_and_carries_skills(make_env):
    harness = AgentaHarness(make_env(supported=[HarnessKind.AGENTA]))
    skill = {
        "name": "release-notes",
        "description": "Draft release notes.",
        "body": "Read the changelog, then write notes.",
    }
    config = _session_config(
        agent=AgentTemplate(
            instructions="My project rules.", model="m", skills=[skill]
        ),
        custom_tools=[{"name": "t", "callRef": "ref"}],
        tool_callback=_CALLBACK,
    )

    result = harness._to_harness_config(config)

    assert isinstance(result, AgentaAgentTemplate)
    # AGENTS.md is the base preamble with the author's instructions appended after it.
    assert result.agents_md.startswith(AGENTA_PREAMBLE)
    assert result.agents_md.endswith("My project rules.")
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
    harness = AgentaHarness(make_env(supported=[HarnessKind.AGENTA]))
    config = _session_config(
        agent=AgentTemplate(instructions="My project rules.", model="m", skills=[])
    )

    result = harness._to_harness_config(config)

    assert [s.name for s in result.skills] == [GETTING_STARTED_WITH_AGENTA_SKILL.name]


def test_agenta_does_not_duplicate_an_already_present_platform_skill(make_env):
    # A config that already carries the resolved platform skill (e.g. via the default template's
    # embed) is not doubled: the author's copy wins on the name clash.
    harness = AgentaHarness(make_env(supported=[HarnessKind.AGENTA]))
    existing = GETTING_STARTED_WITH_AGENTA_SKILL.model_dump(mode="json")
    config = _session_config(
        agent=AgentTemplate(instructions="hi", model="m", skills=[existing])
    )

    result = harness._to_harness_config(config)

    names = [s.name for s in result.skills]
    assert names.count(GETTING_STARTED_WITH_AGENTA_SKILL.name) == 1


def test_force_skills_unions_forced_after_author_skills():
    from agenta.sdk.agents.skills import SkillTemplate

    author = SkillTemplate(
        name="release-notes", description="Draft notes.", body="Do it."
    )

    out = force_skills([author])

    assert out[0] is author
    assert {s.name for s in out} == {"release-notes"} | {
        s.name for s in AGENTA_FORCED_SKILLS
    }


def test_agenta_passes_through_user_pi_options(make_env):
    harness = AgentaHarness(make_env(supported=[HarnessKind.AGENTA]))
    agent = AgentTemplate(
        instructions="hi",
        harness_extras={"system": "You are Pi.", "append_system": "Be terse."},
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

    assert SandboxAgentBackend(url="http://runner").supports(HarnessKind.AGENTA)


# ------------------------------------------------------------------------- Claude


def test_claude_has_no_builtins(make_env):
    harness = ClaudeHarness(make_env(supported=[HarnessKind.CLAUDE]))
    config = _session_config(
        custom_tools=[{"name": "t", "callRef": "ref"}],
        permission_default="deny",
    )

    result = harness._to_harness_config(config)

    assert isinstance(result, ClaudeAgentTemplate)
    assert not hasattr(result, "builtin_tools")  # Claude has no built-in tools at all
    assert result.custom_tools[0]["name"] == "t"
    assert result.permission_default == "deny"


def test_claude_carries_skills_for_project_local_materialization(make_env):
    harness = ClaudeHarness(make_env(supported=[HarnessKind.CLAUDE]))
    skill = {
        "name": "release-notes",
        "description": "Draft release notes.",
        "body": "Read the changelog, then write notes.",
    }
    config = _session_config(
        agent=AgentTemplate(instructions="hi", model="m", skills=[skill])
    )

    result = harness._to_harness_config(config)

    # Claude keeps resolved inline packages on the config. The runner materializes them under
    # `.claude/skills/<name>` in the session cwd, matching Claude's project-local skill layout.
    assert [s.name for s in result.skills] == ["release-notes"]
    assert result.wire_skills()["skills"][0]["name"] == "release-notes"


def test_claude_threads_permissions_and_renders_settings_file(make_env):
    import json

    harness = ClaudeHarness(make_env(supported=[HarnessKind.CLAUDE]))
    permissions = {
        "default_mode": "acceptEdits",
        "allow": ["Read"],
        "deny": ["Write", "Edit"],
    }
    agent = AgentTemplate(instructions="hi", model="m", harness_permissions=permissions)

    result = harness._to_harness_config(_session_config(agent=agent))

    # The harness's first-class `permissions` slice is threaded onto the config; the claude
    # config's `wire_harness_files` (the Python claude adapter) renders it into a settings file.
    assert result.harness_permissions == permissions
    wire = result.wire_harness_files()
    assert wire["harnessFiles"][0]["path"] == ".claude/settings.json"
    assert json.loads(wire["harnessFiles"][0]["content"]) == {
        "permissions": {
            "defaultMode": "acceptEdits",
            "allow": ["Read"],
            "deny": ["Write", "Edit"],
        }
    }


def test_claude_without_permissions_renders_no_files(make_env):
    harness = ClaudeHarness(make_env(supported=[HarnessKind.CLAUDE]))

    result = harness._to_harness_config(_session_config())

    assert result.harness_permissions == {}
    assert result.wire_harness_files() == {}


# -------------------------------------------------------------------------- Codex


def test_codex_has_no_builtins(make_env):
    harness = CodexHarness(make_env(supported=[HarnessKind.CODEX]))
    config = _session_config(
        custom_tools=[{"name": "t", "callRef": "ref"}],
        permission_default="deny",
    )

    result = harness._to_harness_config(config)

    assert isinstance(result, CodexAgentTemplate)
    assert not hasattr(result, "builtin_tools")  # Codex has no built-in tools at all
    assert result.custom_tools[0]["name"] == "t"
    assert result.permission_default == "deny"


def test_codex_managed_renders_file_free_provider_block(make_env):
    # An unresolved connection defaults to MANAGED, which renders the file-free auth provider block
    # (env_key OPENAI_API_KEY) even with no authored options (D-002 final ruling). No credential in
    # the file; codex reads the key from the daemon env at request time.
    harness = CodexHarness(make_env(supported=[HarnessKind.CODEX]))

    result = harness._to_harness_config(_session_config())
    files = result.wire_harness_files()["harnessFiles"]

    assert len(files) == 1
    assert files[0]["path"] == ".codex/config.toml"
    content = files[0]["content"]
    assert 'model_provider = "agenta-openai"' in content
    assert "[model_providers.agenta-openai]" in content
    assert 'env_key = "OPENAI_API_KEY"' in content


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
    harness = PiHarness(make_env(supported=[HarnessKind.PI]))
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
    env = make_env(
        supported=[
            HarnessKind.PI,
            HarnessKind.CLAUDE,
            HarnessKind.CODEX,
            HarnessKind.AGENTA,
        ]
    )
    assert isinstance(make_harness("pi_core", env), PiHarness)
    assert isinstance(
        make_harness("PI_CORE", env), PiHarness
    )  # coerced, case-insensitive
    assert isinstance(make_harness("claude", env), ClaudeHarness)
    assert isinstance(make_harness(HarnessKind.CLAUDE, env), ClaudeHarness)
    assert isinstance(make_harness("codex", env), CodexHarness)
    assert isinstance(make_harness(HarnessKind.CODEX, env), CodexHarness)
    assert isinstance(make_harness("pi_agenta", env), AgentaHarness)
    assert isinstance(make_harness(HarnessKind.AGENTA, env), AgentaHarness)


# ------------------------------------------------- gateway connection prompt guidance


_GATEWAY_POLICY = ResolvedGatewayPolicy(
    integrations={
        "github": ResolvedGatewayIntegration(
            provider="composio",
            connection="github-work",
            tools={"GET_ISSUE": CompiledTool(permission="allow", read_only=True)},
        ),
        "slack": ResolvedGatewayIntegration(
            provider="composio",
            connection="slack-main",
            tools={"SEND_MESSAGE": CompiledTool(permission="ask", read_only=False)},
        ),
    }
)

# Which prompt layer each harness puts the guidance in, and the author's own text on that
# layer. Pi's AGENTS.md stays purely authored, so its carrier is `append_system`; the
# file-based harnesses carry it in the instructions file.
_AUTHOR_APPEND = "Be terse."
_AUTHOR_INSTRUCTIONS = "My project rules."
_HARNESS_CASES = [
    (PiHarness, HarnessKind.PI, "append_system", _AUTHOR_APPEND),
    (ClaudeHarness, HarnessKind.CLAUDE, "agents_md", _AUTHOR_INSTRUCTIONS),
    (CodexHarness, HarnessKind.CODEX, "agents_md", _AUTHOR_INSTRUCTIONS),
    (AgentaHarness, HarnessKind.AGENTA, "agents_md", _AUTHOR_INSTRUCTIONS),
]


def test_every_registered_harness_declares_a_guidance_carrier():
    """A new harness must not silently get the two tools with no instructions.

    The cases above are hand-written, so without this the fifth harness someone registers
    gets `search_tools` and `run_tool`, no guidance, and a green test run.
    """
    from agenta.sdk.agents.adapters.harnesses import _HARNESSES

    assert {kind for _cls, kind, _carrier, _author in _HARNESS_CASES} == set(_HARNESSES)


def _guidance_agent() -> AgentTemplate:
    return AgentTemplate(
        instructions=_AUTHOR_INSTRUCTIONS,
        model="m",
        harness_extras={"append_system": _AUTHOR_APPEND},
    )


@pytest.mark.parametrize("harness_cls,kind,carrier,author_text", _HARNESS_CASES)
def test_gateway_guidance_reaches_every_harness(
    make_env, harness_cls, kind, carrier, author_text
):
    """Every harness gets the same two derived tools, so every one gets the instructions.

    A section added to the Agenta preamble alone would leave Pi, Claude, and Codex holding
    `search_tools` and `run_tool` with nothing telling them how to use them.
    """
    harness = harness_cls(make_env(supported=[kind]))
    config = _session_config(agent=_guidance_agent(), gateway_policy=_GATEWAY_POLICY)

    result = harness._to_harness_config(config)

    text = getattr(result, carrier)
    assert "search_tools" in text
    assert "run_tool" in text
    # The configured integration names, and only those.
    assert "github, slack" in text
    # The author's own text on that layer still comes last: the guidance is the platform half.
    assert text.endswith(author_text)
    assert text.index("search_tools") < text.index(author_text)


@pytest.mark.parametrize("harness_cls,kind,carrier,author_text", _HARNESS_CASES)
def test_no_gateway_guidance_without_a_connection(
    make_env, harness_cls, kind, carrier, author_text
):
    """G6's prompt half: an agent with no connection entry gets no gateway section."""
    harness = harness_cls(make_env(supported=[kind]))
    config = _session_config(agent=_guidance_agent())

    result = harness._to_harness_config(config)

    text = getattr(result, carrier) or ""
    assert "search_tools" not in text
    assert "run_tool" not in text


def test_pi_agents_md_stays_purely_authored(make_env):
    """Pi's carrier is ``append_system``; AGENTS.md keeps only what the author wrote.

    AGENTS.md is the project-conventions layer and a bare Pi run has no platform half of it,
    so injecting there would put platform text in a file the author owns outright.
    """
    harness = PiHarness(make_env(supported=[HarnessKind.PI]))
    config = _session_config(agent=_guidance_agent(), gateway_policy=_GATEWAY_POLICY)

    result = harness._to_harness_config(config)

    assert result.agents_md == _AUTHOR_INSTRUCTIONS
    assert "search_tools" in result.append_system


def test_agenta_keeps_its_preamble_first_with_guidance(make_env):
    """The existing prefix rule survives: preamble, then guidance, then the author."""
    harness = AgentaHarness(make_env(supported=[HarnessKind.AGENTA]))
    config = _session_config(
        agent=AgentTemplate(instructions="My project rules.", model="m"),
        gateway_policy=_GATEWAY_POLICY,
    )

    result = harness._to_harness_config(config)

    assert result.agents_md.startswith(AGENTA_PREAMBLE)
    assert result.agents_md.endswith("My project rules.")
    assert result.agents_md.index(AGENTA_PREAMBLE) < result.agents_md.index(
        "search_tools"
    )


def test_gateway_guidance_is_never_stored_in_the_revision(make_env):
    """It is derived at resolve time, like the two tools it describes."""
    harness = PiHarness(make_env(supported=[HarnessKind.PI]))
    agent = _guidance_agent()
    config = _session_config(agent=agent, gateway_policy=_GATEWAY_POLICY)

    result = harness._to_harness_config(config)

    assert "search_tools" in result.append_system
    assert agent.instructions == _AUTHOR_INSTRUCTIONS
    assert agent.harness_extras == {"append_system": _AUTHOR_APPEND}


def test_gateway_guidance_carries_all_six_prompt_items():
    """Every item runtime-tools.md "Prompt guidance" fixes for V1, in one focused test.

    The per-harness tests above prove the section REACHES each prompt surface; this proves
    the section actually says the six things. A rewrite that drops one, for example the
    single-retry rule, changes model behavior in a way no placement test would catch.
    """
    section = gateway_guidance(_GATEWAY_POLICY)

    # 1. The configured integration names.
    assert "Configured integrations: github, slack." in section
    # 2. Search once per task, with a concrete description, and no equivalent repeats.
    assert "Search once per task, with a concrete description" in section
    assert "Never repeat an\n  equivalent query" in section
    # The empty result is a refine-once instruction, not a stop: the runner's own message
    # asks for a more specific description, so the guidance must not contradict it.
    assert "Refine the query ONCE and" in section
    # 3. Use only a returned integration and tool key.
    assert (
        "Use only an integration and a tool key that a search result returned"
        in section
    )
    assert "Never invent one." in section
    # 4. Copy the arguments from the returned schema.
    assert (
        "Copy the arguments from the input schema the search result returned" in section
    )
    # 5. Retry a temporary search failure at most once.
    assert "retry it once and no more" in section
    # 6. Stop searching once a result is usable.
    assert "Stop searching once a result is usable" in section
    # And the two tools the six items are about.
    assert "`search_tools`" in section
    assert "`run_tool`" in section


def test_gateway_guidance_is_absent_for_an_empty_policy():
    assert gateway_guidance(None) is None
    assert gateway_guidance(ResolvedGatewayPolicy()) is None


@pytest.mark.parametrize("harness_cls,kind,carrier,author_text", _HARNESS_CASES)
def test_gateway_policy_reaches_every_harness_config(
    make_env, harness_cls, kind, carrier, author_text
):
    """The propagation seam itself: a config that drops it fails silently as a deny."""
    harness = harness_cls(make_env(supported=[kind]))
    config = _session_config(gateway_policy=_GATEWAY_POLICY)

    result = harness._to_harness_config(config)

    assert result.gateway_policy is _GATEWAY_POLICY
    assert result.wire_gateway_policy()["gatewayPolicy"]["integrations"].keys() == {
        "github",
        "slack",
    }


def test_no_gateway_policy_emits_no_wire_field(make_env):
    harness = PiHarness(make_env(supported=[HarnessKind.PI]))

    result = harness._to_harness_config(_session_config())

    assert result.gateway_policy is None
    assert result.wire_gateway_policy() == {}


def test_make_harness_unsupported_backend_raises(make_env):
    env = make_env(supported=[HarnessKind.PI])  # backend cannot drive Claude
    with pytest.raises(UnsupportedHarnessError):
        make_harness("claude", env)


def test_make_harness_unknown_name_raises(make_env):
    env = make_env(supported=[HarnessKind.PI])
    with pytest.raises(ValueError):
        make_harness("bogus", env)
