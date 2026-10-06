"""The configuration `create_agent` starts from, and the attribution its writes carry.

"New agent" in the web app reads the catalog template with key `agent` and seeds a sandbox the
deployment enables. `create_agent` must start in the same place, or an agent built by another
agent and one built by a person drift apart without anyone noticing.
"""

import pytest

from agenta.sdk.agents.tools import DEFAULT_AGENTA_TOOLS

from oss.src.core.workflows.commit_support import agent_attribution
from oss.src.core.workflows.new_agent import new_agent_revision_data, new_agent_slug
from oss.src.resources.workflows.catalog import (
    get_filtered_workflow_catalog_templates,
)
from oss.src.utils.env import env


def _web_template_data() -> dict:
    """What the web's New agent reads: `GET /workflows/catalog/templates/?is_application=true`,
    the entry whose key is `agent`."""
    template = next(
        template
        for template in get_filtered_workflow_catalog_templates(is_application=True)
        if template.key == "agent"
    )
    return template.data.model_dump(mode="json", exclude_none=True)


@pytest.fixture
def sandboxes(monkeypatch):
    """Set the deployment's enabled sandbox providers and its default one."""

    def set_(enabled, default):
        monkeypatch.setattr(env.runner, "enabled_sandbox_providers", enabled)
        monkeypatch.setattr(env.runner, "default_sandbox_provider", default)

    return set_


class TestTemplateParity:
    def test_with_local_enabled_it_is_the_template_new_agent_reads(self, sandboxes):
        sandboxes(["local"], "local")
        web = _web_template_data()

        assert new_agent_revision_data() == {
            "uri": web["uri"],
            "parameters": web["parameters"],
            "schemas": web["schemas"],
        }

    @pytest.mark.parametrize(
        "enabled,default,kind",
        [
            (["daytona", "inprocess"], "daytona", "daytona"),
            # The runtime's rule: the configured default, not the first enabled provider.
            (["daytona", "inprocess"], "inprocess", "inprocess"),
            (["local", "daytona"], "daytona", "local"),
        ],
        ids=["replaced-by-default", "default-not-first", "enabled-kept"],
    )
    def test_a_template_sandbox_the_deployment_does_not_enable_takes_its_default(
        self, sandboxes, enabled, default, kind
    ):
        sandboxes(enabled, default)

        agent = new_agent_revision_data()["parameters"]["agent"]

        assert agent["sandbox"]["kind"] == kind
        web = _web_template_data()["parameters"]["agent"]
        assert agent["sandbox"] == {**web["sandbox"], "kind": kind}
        rest = {k: v for k, v in agent.items() if k != "sandbox"}
        assert rest == {k: v for k, v in web.items() if k != "sandbox"}

    def test_a_new_agent_gets_the_four_agent_tools_on_allow(self):
        tools = new_agent_revision_data()["parameters"]["agent"]["tools"]

        entry = next(tool for tool in tools if tool["type"] == "agenta_tools")
        assert entry["tools"] == dict(DEFAULT_AGENTA_TOOLS)
        for op in (
            "list_agents",
            "read_agent_config",
            "create_agent",
            "edit_agent_config",
        ):
            assert entry["tools"][op] == "allow"

    def test_a_new_agent_has_an_empty_skills_list_so_the_first_skill_is_an_add(self):
        agent = new_agent_revision_data()["parameters"]["agent"]
        assert agent["skills"] == []
        # The template the web's New agent reads holds it too.
        assert _web_template_data()["parameters"]["agent"]["skills"] == []

    def test_the_template_is_what_the_runtime_accepts(self):
        # The gate every agent write goes through: the runtime's own parse.
        from oss.src.core.workflows.service import _reject_unrunnable_agent

        _reject_unrunnable_agent(new_agent_revision_data())


class TestNewAgentSlug:
    def test_the_web_rule(self):
        assert new_agent_slug("  Invoice Helper (EU)! ") == "invoice-helper-eu"

    def test_a_name_with_no_slug_characters_still_gets_one(self):
        assert new_agent_slug("???") == "agent"


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
