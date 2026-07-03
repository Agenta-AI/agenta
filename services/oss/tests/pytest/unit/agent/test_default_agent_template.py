"""The agent-template default has ONE source: `build_agent_v0_default` in the SDK.

Before this, the default was hand-maintained in three places (the SDK builtin interface, the
service `/inspect` schema, and the catalog field defaults), so a new default field had to be
edited in each and could silently drift. These tests lock that there is now a single builder
and that the `/inspect` default the playground pre-fills is the same value the runtime parses.

The default is the nested `{agent, harness, runner, sandbox}` envelope (Step 1 of the
agent-template migration): the portable definition lives under `agent`, the execution selectors
under the `harness` / `runner` / `sandbox` siblings.
"""

from __future__ import annotations

from agenta.sdk.agents import AgentTemplate
from agenta.sdk.engines.running.interfaces import agent_v0_interface
from agenta.sdk.utils.types import build_agent_v0_default

from oss.src.agent.schemas import AGENT_SCHEMAS


def _inspect_agent_default() -> dict:
    """The agent-template envelope default the service advertises on `/inspect`."""
    return AGENT_SCHEMAS["parameters"]["properties"]["agent"]["default"]


def _builtin_agent_default() -> dict:
    """The agent-template envelope default the SDK builtin interface (`agenta:builtin:agent:v0`)
    carries."""
    return agent_v0_interface.schemas.parameters["properties"]["agent"]["default"]


def test_builtin_default_is_the_bare_builder():
    # The SDK builtin uses the builder with no service-only extras.
    assert _builtin_agent_default() == build_agent_v0_default()


def test_service_default_is_the_bare_builder():
    # The playground build kit carries authoring extras; the published default stays bare.
    assert _inspect_agent_default() == build_agent_v0_default()


def test_inspect_default_parses_into_the_runtime_selection():
    # The default the playground pre-fills on `/inspect` must parse cleanly into the same runtime
    # values `AgentTemplate.from_params` produces, so what the user sees is what the agent runs.
    inspect_default = _inspect_agent_default()
    params = {"agent": inspect_default}

    config = AgentTemplate.from_params(params)

    # The runtime selection is provider-qualified (F-017): `llm.provider` + `llm.model`
    # combine into the `provider/model` ref credentials resolve against.
    llm = inspect_default["llm"]
    assert config.model == f"{llm['provider']}/{llm['model']}"
    assert config.instructions == inspect_default["instructions"]["agents_md"]
    assert config.sandbox_permission is None
    assert config.harness == "pi_core"
    assert config.sandbox == "local"
    assert config.permission_default == "allow_reads"


def test_authoring_extras_absent_from_every_published_default():
    # Platform tools, the authoring skill, and elevated sandbox permissions belong to the
    # playground build-kit overlay, not to the published default template.
    inspect_default = _inspect_agent_default()
    builtin_default = _builtin_agent_default()

    assert inspect_default["tools"] == []
    assert "skills" not in inspect_default
    assert "permissions" not in inspect_default["sandbox"]
    assert "execute_code" not in inspect_default["sandbox"]
    assert "write_files" not in inspect_default["sandbox"]

    assert builtin_default["tools"] == []
    assert "permissions" not in builtin_default["sandbox"]
    assert "skills" not in builtin_default


def test_harness_default_is_pi_core_in_every_source():
    # The harness default is the single builder value (`harness.kind`), surfaced identically by the
    # SDK builtin and the service `/inspect`.
    assert build_agent_v0_default()["harness"]["kind"] == "pi_core"
    assert _builtin_agent_default()["harness"]["kind"] == "pi_core"
    assert _inspect_agent_default()["harness"]["kind"] == "pi_core"
