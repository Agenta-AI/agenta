"""A run that may use at least one of the caller's cloud browser logins gets the browser tools and
a run context that binds them, without a change to its saved configuration."""

from __future__ import annotations

from typing import Any, List, Optional, Union

import pytest

from agenta.sdk.agents.dtos import (
    RunContext,
    RunContextReference,
    RunContextWorkflow,
)
from agenta.sdk.agents.handler import AgentComposition, make_agent_handler
from agenta.sdk.agents.tools import (
    ClientToolConfig,
    PlatformToolConfig,
    ResolvedToolSet,
    ToolConfigurationError,
)

from .test_agent_composition_seam import _FakeBackend, _no_connection, _request

pytestmark = pytest.mark.asyncio


async def _run(
    *,
    browser: Optional[dict] = None,
    logins: Union[List[str], Exception, None, str] = None,
    authored: Optional[List[dict]] = None,
    permission_default: str = "allow",
    run_context: Optional[RunContext] = None,
    checks: Optional[List[dict]] = None,
):
    seen: List[Any] = []
    backend = _FakeBackend()
    checks = [] if checks is None else checks

    async def _logins(**kwargs):
        checks.append(kwargs)
        if isinstance(logins, Exception):
            raise logins
        if logins == "ineligible":
            return None
        return ["prof-1", "prof-2"] if logins is None else logins

    async def _resolve_tools(tools, **kwargs):
        seen.append(list(tools))
        return ResolvedToolSet()

    async def _no_channel_tools(*, workflow_id):
        return []

    comp = AgentComposition(
        select_backend=lambda template: backend,
        resolve_connection=_no_connection,
        resolve_tools=_resolve_tools,
        resolve_channel_tools=_no_channel_tools,
        resolve_browser_profiles=_logins,
        run_context=lambda: run_context,
    )
    template: dict = {
        "harness": {"kind": "pi_core"},
        "runner": {"permissions": {"default": permission_default}},
        "tools": authored or [],
    }
    if browser is not None:
        template["browser"] = browser
    await make_agent_handler(comp)(
        request=_request(),
        messages=[{"role": "user", "content": "hi"}],
        parameters={"agent": template},
    )
    return seen[0], backend.created_run_contexts[0]


def _permissions(tools):
    return {
        (t.op if isinstance(t, PlatformToolConfig) else t.name): t.permission
        for t in tools
    }


async def test_by_default_every_login_adds_the_browser_tools_and_pay_and_delete_ask():
    checks: List[dict] = []
    tools, rc = await _run(checks=checks)

    assert _permissions(tools) == {
        "browser_navigate": None,
        "browser_read_page": None,
        "browser_find": None,
        "browser_click": None,
        "browser_type": None,
        "browser_form_input": None,
        "browser_pay": "ask",
        "browser_delete": "ask",
        "browser_wait_for_user": None,
        "browser_request_login": None,
    }
    renders = [t.render for t in tools if isinstance(t, ClientToolConfig)]
    assert renders == [{"kind": "browser"}, {"kind": "browser_login"}]
    assert rc.to_wire() == {
        "browser": {
            "profile_ids": ["prof-1", "prof-2"],
            "all_logins": True,
            "revision_id": None,
            "is_draft": False,
        }
    }
    assert checks == [{"revision_id": None, "is_draft": False}]


async def test_selected_keeps_only_the_chosen_ready_logins():
    tools, rc = await _run(
        browser={"mode": "selected", "profiles": ["prof-2", "prof-9"]}
    )

    assert rc.to_wire()["browser"]["profile_ids"] == ["prof-2"]
    assert rc.to_wire()["browser"]["all_logins"] is False
    assert "browser_request_login" not in _permissions(tools)


async def test_off_skips_the_check_and_adds_nothing():
    checks: List[dict] = []
    tools, rc = await _run(browser={"mode": "off"}, checks=checks)

    assert (tools, rc, checks) == ([], None, [])


async def test_no_ready_login_offers_only_the_login_request():
    tools, rc = await _run(logins=[])

    assert [t.name for t in tools] == ["browser_request_login"]
    assert rc is None


async def test_a_run_that_may_not_use_the_logins_adds_nothing():
    tools, rc = await _run(logins="ineligible")

    assert (tools, rc) == ([], None)


async def test_a_selection_with_no_ready_login_adds_nothing():
    tools, rc = await _run(browser={"mode": "selected", "profiles": ["prof-9"]})

    assert (tools, rc) == ([], None)


async def test_a_failed_check_adds_nothing():
    tools, rc = await _run(logins=RuntimeError("api down"))

    assert (tools, rc) == ([], None)


async def test_a_committed_run_binds_its_revision():
    committed = RunContext(
        workflow=RunContextWorkflow(
            revision=RunContextReference(id="rev-1"), is_draft=False
        )
    )

    checks: List[dict] = []
    _, rc = await _run(run_context=committed, checks=checks)

    assert rc.to_wire()["browser"] == {
        "profile_ids": ["prof-1", "prof-2"],
        "all_logins": True,
        "revision_id": "rev-1",
        "is_draft": False,
    }
    assert checks == [{"revision_id": "rev-1", "is_draft": False}]
    assert committed.browser is None


async def test_a_draft_run_checks_as_a_draft():
    draft = RunContext(workflow=RunContextWorkflow(is_draft=True))
    checks: List[dict] = []

    _, rc = await _run(run_context=draft, checks=checks)

    assert checks == [{"revision_id": None, "is_draft": True}]
    assert rc.to_wire()["browser"]["is_draft"] is True


async def test_an_authored_pay_entry_still_asks():
    tools, _ = await _run(
        authored=[{"type": "platform", "op": "browser_pay", "permission": "allow"}],
    )

    perms = _permissions(tools)
    assert perms["browser_pay"] == "ask"
    assert [t.op for t in tools if isinstance(t, PlatformToolConfig)].count(
        "browser_pay"
    ) == 1


async def test_a_deny_agent_does_not_turn_pay_into_ask():
    tools, _ = await _run(permission_default="deny")

    assert _permissions(tools)["browser_pay"] is None


async def test_disabled_platform_handlers_fail_loudly_for_chosen_logins(monkeypatch):
    monkeypatch.setenv("AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS", "false")

    with pytest.raises(ToolConfigurationError, match="browser_navigate"):
        await _run(browser={"mode": "selected", "profiles": ["prof-1"]})


async def test_disabled_platform_handlers_quietly_drop_the_default_browser(monkeypatch):
    monkeypatch.setenv("AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS", "false")

    tools, rc = await _run()

    assert (tools, rc) == ([], None)


async def test_disabled_platform_handlers_with_no_ready_login_run(monkeypatch):
    monkeypatch.setenv("AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS", "false")

    tools, rc = await _run(logins=[])

    assert (tools, rc) == ([], None)
