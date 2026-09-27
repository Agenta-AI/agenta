"""The Agenta tools list served for the settings UI, and the build kit it leaves unchanged."""

from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS
from agenta.sdk.agents.tools import AGENTA_TOOLS

from oss.src.core.workflows.build_kit import DEFAULT_BUILD_KIT_OPS
from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog


def test_the_build_kit_keeps_every_tool_it_has_today():
    assert DEFAULT_BUILD_KIT_OPS == (
        "discover_tools",
        "search_skills",
        "check_skill_updates",
        "apply_skill_update",
        "read_config",
        "commit_revision",
        "test_run",
        "get_current_session",
        "rename_session",
        "rename_agent",
        "discover_triggers",
        "create_schedule",
        "create_subscription",
        "list_schedules",
        "list_deliveries",
        "test_subscription",
        "list_subscriptions",
        "remove_schedule",
        "remove_subscription",
        "list_starters",
        "create_app",
    )


def test_the_agenta_tools_are_served_with_their_read_only_flag():
    revision = StaticWorkflowCatalog().retrieve_revision(slug="__ag__agenta_tools")

    assert revision.data.parameters == {
        "op_access": {
            op: "read" if PLATFORM_OPS[op].read_only else "write" for op in AGENTA_TOOLS
        }
    }
    assert revision.data.parameters["op_access"]["get_current_session"] == "read"
    assert revision.data.parameters["op_access"]["rename_session"] == "write"


def test_every_agenta_tool_is_also_a_build_kit_tool():
    assert set(AGENTA_TOOLS) <= set(DEFAULT_BUILD_KIT_OPS)
