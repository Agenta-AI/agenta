"""The configuration `create_agent` starts from, and the attribution its writes carry.

"New agent" in the web app reads the catalog template with key `agent` and seeds a sandbox the
deployment enables. `create_agent` must start in the same place, or an agent built by another
agent and one built by a person drift apart without anyone noticing.
"""

import pytest

from agenta.sdk.agents.tools import DEFAULT_AGENTA_TOOLS

from oss.src.core.workflows.commit_support import agent_attribution
from oss.src.core.workflows.new_agent import (
    ensure_enabled_sandbox,
    new_agent_revision_data,
)
from oss.src.resources.workflows.catalog import (
    get_filtered_workflow_catalog_templates,
)


def _web_template_data() -> dict:
    """What the web's New agent reads: `GET /workflows/catalog/templates/?is_application=true`,
    the entry whose key is `agent`."""
    template = next(
        template
        for template in get_filtered_workflow_catalog_templates(is_application=True)
        if template.key == "agent"
    )
    return template.data.model_dump(mode="json", exclude_none=True)


class TestTemplateParity:
    def test_with_local_enabled_it_is_the_template_new_agent_reads(self):
        web = _web_template_data()

        assert new_agent_revision_data(enabled_sandbox_providers=["local"]) == {
            "uri": web["uri"],
            "parameters": web["parameters"],
            "schemas": web["schemas"],
        }

    def test_a_daytona_only_deployment_gets_a_runnable_sandbox_like_the_web(self):
        data = new_agent_revision_data(
            enabled_sandbox_providers=["daytona", "inprocess"]
        )

        assert data["parameters"]["agent"]["sandbox"]["kind"] == "daytona"
        web = _web_template_data()["parameters"]["agent"]
        rest = {k: v for k, v in data["parameters"]["agent"].items() if k != "sandbox"}
        assert rest == {k: v for k, v in web.items() if k != "sandbox"}

    def test_a_new_agent_gets_the_four_agent_tools_on_allow(self):
        tools = new_agent_revision_data(enabled_sandbox_providers=["local"])[
            "parameters"
        ]["agent"]["tools"]

        entry = next(tool for tool in tools if tool["type"] == "agenta_tools")
        assert entry["tools"] == dict(DEFAULT_AGENTA_TOOLS)
        for op in (
            "list_agents",
            "read_agent_config",
            "create_agent",
            "edit_agent_config",
        ):
            assert entry["tools"][op] == "allow"


class TestEnsureEnabledSandbox:
    """The web's `ensureEnabledSandbox`, case by case."""

    @pytest.mark.parametrize(
        "agent,enabled,kind",
        [
            ({"sandbox": {"kind": "local"}}, ["local"], "local"),
            ({"sandbox": {"kind": "local"}}, ["daytona"], "daytona"),
            ({"sandbox": {"kind": "daytona"}}, ["local", "daytona"], "daytona"),
            ({}, ["daytona", "inprocess"], "daytona"),
            ({}, ["local"], None),
        ],
        ids=["kept", "replaced", "enabled-kept", "unset-replaced", "unset-local-kept"],
    )
    def test_cases(self, agent, enabled, kind):
        result = ensure_enabled_sandbox(agent, enabled)
        assert (result.get("sandbox") or {}).get("kind") == kind

    def test_no_enabled_providers_changes_nothing(self):
        agent = {"sandbox": {"kind": "local", "extras": {"a": 1}}}
        assert ensure_enabled_sandbox(agent, []) is agent

    def test_other_sandbox_fields_survive_a_replacement(self):
        agent = {"sandbox": {"kind": "local", "extras": {"a": 1}}}
        assert ensure_enabled_sandbox(agent, ["daytona"])["sandbox"] == {
            "kind": "daytona",
            "extras": {"a": 1},
        }


class TestAttribution:
    def test_names_the_agent_its_id_and_the_session(self):
        assert (
            agent_attribution(
                agent_id="019f", agent_name="Support Triage", session_id="01a1"
            )
            == 'by agent "Support Triage" 019f, session 01a1'
        )

    def test_an_unnamed_agent_is_named_by_its_id(self):
        assert (
            agent_attribution(agent_id="019f", agent_name=None, session_id="01a1")
            == "by agent 019f, session 01a1"
        )

    def test_a_run_without_a_session_says_none(self):
        assert agent_attribution(
            agent_id="019f", agent_name="A", session_id=None
        ).endswith("session none")
