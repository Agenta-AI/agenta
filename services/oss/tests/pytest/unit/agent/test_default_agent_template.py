"""The `agent-template` default has ONE source: `build_agent_v0_default` in the SDK.

Before this, the default was hand-maintained in three places (the SDK builtin interface, the
service `/inspect` schema, and the catalog field defaults), so a new default field had to be
edited in each and could silently drift. These tests lock that there is now a single builder
and that the `/inspect` default the playground pre-fills is the same value the runtime parses.
"""

from __future__ import annotations

from agenta.sdk.agents import AgentTemplate
from agenta.sdk.engines.running.interfaces import agent_v0_interface
from agenta.sdk.utils.types import AgentTemplateSchema, build_agent_v0_default

from oss.src.agent.schemas import AGENT_SCHEMAS, _DEFAULT_SKILL_SLUG


def _inspect_agent_default() -> dict:
    """The `agent-template` default the service advertises on `/inspect`."""
    return AGENT_SCHEMAS["parameters"]["properties"]["agent"]["default"]


def _builtin_agent_default() -> dict:
    """The `agent-template` default the SDK builtin interface (`agenta:builtin:agent:v0`) carries."""
    return agent_v0_interface.schemas.parameters["properties"]["agent"]["default"]


def test_builtin_default_is_the_bare_builder():
    # The SDK builtin uses the builder with no service-only extras.
    assert _builtin_agent_default() == build_agent_v0_default()


def test_service_default_is_the_builder_plus_service_only_choices():
    # The service default is the same builder plus the two service-only choices, passed as
    # named args (not a second copy): the platform default skill and the declared sandbox boundary.
    assert _inspect_agent_default() == build_agent_v0_default(
        skill_slug=_DEFAULT_SKILL_SLUG,
        include_sandbox_permission=True,
    )


def test_inspect_default_parses_into_the_runtime_selection():
    # The default the playground pre-fills on `/inspect` must parse cleanly into the same runtime
    # values `AgentTemplate.from_params` produces, so what the user sees is what the agent runs. The
    # `@ag.embed` skill resolves server-side before this parse, so the config-level round-trip is
    # asserted on the non-skill fields plus the run-selection fields (now on `AgentTemplate`).
    inspect_default = _inspect_agent_default()
    no_skill = {k: v for k, v in inspect_default.items() if k != "skills"}
    params = {"agent": no_skill}

    config = AgentTemplate.from_params(params)

    assert config.model == inspect_default["model"]
    assert config.instructions == inspect_default["agents_md"]
    assert (
        config.sandbox_permission is not None
    )  # the service boundary survives the parse
    assert config.harness == "pi_core"
    assert config.sandbox == "local"
    assert config.permission_policy == "auto"


def test_service_only_extras_present_in_inspect_absent_from_builtin():
    # The platform default skill and sandbox_permission ride the SERVICE default (the playground
    # pre-fill + the runtime fallback) and are intentionally ABSENT from the SDK builtin, which is
    # the minimal harness-agnostic shape with no platform opinion. They are in both inspect and
    # runtime via the SAME service default object, so they cannot drift between the two.
    inspect_default = _inspect_agent_default()
    builtin_default = _builtin_agent_default()

    assert "sandbox_permission" in inspect_default
    assert (
        inspect_default["skills"][0]["@ag.embed"]["@ag.references"]["workflow"]["slug"]
        == _DEFAULT_SKILL_SLUG
    )

    assert "sandbox_permission" not in builtin_default
    assert "skills" not in builtin_default


def test_harness_default_is_pi_core_in_every_source():
    # The renamed harness default is the single builder value, surfaced identically by the SDK
    # builtin, the service `/inspect`, and the catalog field default.
    assert build_agent_v0_default()["harness"] == "pi_core"
    assert _builtin_agent_default()["harness"] == "pi_core"
    assert _inspect_agent_default()["harness"] == "pi_core"
    assert AgentTemplateSchema.model_fields["harness"].default == "pi_core"
