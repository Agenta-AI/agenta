"""Needs setup for `"user"` items: the run's resolver, for the person who asks."""

from typing import Any, List
from uuid import uuid4

import pytest

from oss.src.core.account_choices.dtos import AccountMatch, ItemAccount
from oss.src.core.agent_requirements import service as service_module

from .test_agent_requirements_service import (
    _AccountChoices,
    _Allowed,
    _Connections,
    _Mcp,
    _Vault,
    _no,
    _scope,
    _service,
    _yes,
)

pytestmark = pytest.mark.asyncio

GMAIL = "app_connection:user/gmail"
LINEAR = "mcp_server:user/linear"
TOKEN = "secret:user/GITHUB_TOKEN"
CLAUDE = "subscription:user/claude"


def _gmail_tool() -> dict:
    return {
        "type": "gateway",
        "action": "GMAIL_SEND_EMAIL",
        "connection": {
            "provider": "composio",
            "integration": "gmail",
            "account_source": "user",
        },
    }


def _linear_mcp() -> dict:
    return {
        "name": "linear",
        "connection": {
            "type": "gateway",
            "namespace": "custom",
            "slug": "linear",
            "account_source": "user",
        },
    }


def _token_credential() -> dict:
    return {
        "secret": {"account_source": "user"},
        "binding": {"type": "env", "name": "GITHUB_TOKEN"},
    }


def _agent(**agent: Any) -> dict:
    return {"agent": {"llm": {"model": "gpt-5.5", "provider": "openai"}, **agent}}


def _claude_login_agent() -> dict:
    return {
        "agent": {
            "llm": {
                "model": "claude-sonnet-4-5",
                "provider": "anthropic",
                "connection": {"mode": "self_managed", "account_source": "user"},
            }
        }
    }


class _Decision:
    def __init__(self, value: bool):
        self.value = value
        self.calls = 0

    async def __call__(self) -> bool:
        self.calls += 1
        return self.value


async def _check(service, parameters, *, person=True, may_run=None, allowed=None):
    return await service.check(
        scope=_scope(),
        parameters=parameters,
        artifact_id=uuid4(),
        run_person_id=uuid4() if person else None,
        can_edit_agent=_no,
        allowed=allowed or _Allowed(),
        may_run_agent=may_run or _yes,
        manages_organization=_no,
    )


def _by_key(result) -> dict:
    return {requirement.key: requirement for requirement in result.requirements}


async def test_a_person_with_no_account_gets_a_personal_account_requirement():
    result = await _check(
        _service(
            accounts=_AccountChoices(
                {
                    GMAIL: ItemAccount(item_key=GMAIL, candidates=0),
                    TOKEN: ItemAccount(item_key=TOKEN, candidates=3),
                    LINEAR: ItemAccount(item_key=LINEAR, candidates=0),
                }
            )
        ),
        _agent(
            tools=[_gmail_tool()],
            mcps=[_linear_mcp()],
            sandbox={"credentials": [_token_credential()]},
        ),
    )
    found = _by_key(result)
    assert set(found) == {GMAIL, LINEAR, TOKEN}
    for requirement in found.values():
        assert requirement.account_source == "user"
        assert requirement.reason.value == "needs_personal_account"
        assert requirement.blocks_run is False
        assert requirement.fix.ask is None

    gmail = found[GMAIL]
    assert gmail.kind.value == "app_connection"
    assert gmail.reference == {
        "provider": "composio",
        "integration": "gmail",
        "account_source": "user",
    }
    assert gmail.paths == ["agent.tools[0].connection"]
    assert (gmail.fix.can_connect, gmail.fix.can_sign_in) == (True, False)
    assert gmail.fix.candidates == 0

    token = found[TOKEN]
    assert (token.fix.can_connect, token.fix.candidates) == (True, 3)

    linear = found[LINEAR]
    assert linear.kind.value == "mcp_server"
    assert (linear.fix.can_connect, linear.fix.can_sign_in) == (False, True)


async def test_connections_but_no_default_tells_how_many_the_person_has():
    result = await _check(
        _service(
            accounts=_AccountChoices({GMAIL: ItemAccount(item_key=GMAIL, candidates=2)})
        ),
        _agent(tools=[_gmail_tool()]),
    )
    [gmail] = result.requirements
    assert gmail.reason.value == "needs_personal_account"
    assert gmail.fix.candidates == 2


async def test_a_matched_account_that_is_not_ready_asks_to_sign_in_again():
    result = await _check(
        _service(
            accounts=_AccountChoices(
                {
                    GMAIL: ItemAccount(
                        item_key=GMAIL,
                        match=AccountMatch.DEFAULT,
                        gateway_connection_id=uuid4(),
                        candidates=1,
                    ),
                    LINEAR: ItemAccount(
                        item_key=LINEAR,
                        match=AccountMatch.SIGN_IN,
                        secret_id=uuid4(),
                        candidates=1,
                    ),
                }
            )
        ),
        _agent(tools=[_gmail_tool()], mcps=[_linear_mcp()]),
    )
    found = _by_key(result)
    gmail = found[GMAIL]
    assert (gmail.kind.value, gmail.reason.value) == ("app_connection", "needs_sign_in")
    assert (gmail.fix.can_connect, gmail.fix.can_sign_in) == (False, True)

    sign_in = found["mcp_sign_in:user/linear"]
    assert (sign_in.kind.value, sign_in.reason.value) == (
        "mcp_sign_in",
        "needs_sign_in",
    )
    assert sign_in.fix.can_sign_in is True and sign_in.fix.candidates == 1
    assert sign_in.reference["slug"] == "linear"


async def test_a_ready_account_gives_no_requirement():
    result = await _check(
        _service(
            accounts=_AccountChoices(
                {
                    GMAIL: ItemAccount(
                        item_key=GMAIL,
                        match=AccountMatch.CHOICE,
                        gateway_connection_id=uuid4(),
                        is_ready=True,
                        candidates=2,
                    )
                }
            )
        ),
        _agent(tools=[_gmail_tool()]),
    )
    assert result.status.value == "ready" and result.requirements == []


async def test_a_user_mcp_item_has_one_reader_and_no_project_sign_in_requirement():
    """The `"user"` MCP item keeps its slug, so without the one-reader rule it would
    also get an `"agent"` requirement for the project's own sign-in."""
    mcp = _Mcp()
    result = await _check(
        _service(mcp=mcp, accounts=_AccountChoices()), _agent(mcps=[_linear_mcp()])
    )
    assert [requirement.key for requirement in result.requirements] == [LINEAR]
    assert mcp.calls == 0


async def test_a_user_login_blocks_the_run_and_offers_no_fix():
    result = await _check(_service(), _claude_login_agent())
    [login] = result.requirements
    assert login.key == CLAUDE
    assert (login.kind.value, login.reason.value) == (
        "subscription",
        "needs_personal_account",
    )
    assert login.blocks_run is True
    assert login.fix is None
    assert result.status.value == "needs_setup"


async def test_no_person_reads_nothing_and_offers_no_fix():
    accounts = _AccountChoices()
    may_run = _Decision(True)
    result = await _check(
        _service(accounts=accounts),
        _agent(tools=[_gmail_tool()]),
        person=False,
        may_run=may_run,
    )
    [gmail] = result.requirements
    assert gmail.reason.value == "needs_personal_account"
    assert gmail.fix is None and gmail.blocks_run is False
    assert accounts.calls == [] and may_run.calls == 0


async def test_with_personal_accounts_off_every_user_item_has_no_fix(monkeypatch):
    monkeypatch.setattr(service_module, "personal_accounts_enabled", lambda: False)
    accounts = _AccountChoices()
    result = await _check(_service(accounts=accounts), _agent(tools=[_gmail_tool()]))
    [gmail] = result.requirements
    assert gmail.reason.value == "needs_personal_account" and gmail.fix is None
    assert accounts.calls == []


async def test_only_people_who_may_run_the_agent_get_the_fix():
    may_run = _Decision(False)
    allowed = _Allowed(allowed=True)
    result = await _check(
        _service(),
        _agent(tools=[_gmail_tool()], mcps=[_linear_mcp()]),
        may_run=may_run,
        allowed=allowed,
    )
    for requirement in result.requirements:
        assert requirement.fix.can_connect is False
        assert requirement.fix.can_sign_in is False
    # Asked once, and the manage permissions of "agent" items are never asked.
    assert may_run.calls == 1
    assert allowed.asked == []


# --- round trips ------------------------------------------------------------------- #


async def test_an_agent_without_user_items_never_calls_the_resolver():
    accounts = _AccountChoices()
    vault, mcp, connections = _Vault(), _Mcp(), _Connections()
    await _check(
        _service(vault=vault, mcp=mcp, connections=connections, accounts=accounts),
        _agent(),
    )
    assert accounts.calls == []
    assert mcp.calls == 0 and connections.calls == 0


async def test_user_items_cost_one_resolve_for_the_person_who_asks():
    accounts = _AccountChoices()
    mcp, connections = _Mcp(), _Connections()
    scope = _scope()
    person, artifact = uuid4(), uuid4()
    await _service(mcp=mcp, connections=connections, accounts=accounts).check(
        scope=scope,
        parameters=_agent(
            tools=[_gmail_tool(), _gmail_tool()],
            mcps=[_linear_mcp()],
            sandbox={"credentials": [_token_credential()]},
        ),
        artifact_id=artifact,
        run_person_id=person,
        can_edit_agent=_no,
        allowed=_Allowed(),
        may_run_agent=_yes,
        manages_organization=_no,
    )
    [call] = accounts.calls
    assert call["user_id"] == person and call["artifact_id"] == artifact
    assert call["organization_id"] == scope.organization_id
    assert call["project_id"] == scope.project_id
    assert [item.item_key for item in call["items"]] == [GMAIL, LINEAR, TOKEN]
    # The "user" items read no project store.
    assert mcp.calls == 0 and connections.calls == 0


# --- the turn-on check --------------------------------------------------------------- #


async def test_the_turn_on_check_resolves_only_the_login_for_the_run_person():
    accounts = _AccountChoices()
    person = uuid4()
    parameters = _claude_login_agent()
    parameters["agent"]["tools"] = [_gmail_tool()]
    requirements = await _service(accounts=accounts).model_requirements(
        scope=_scope(),
        parameters=parameters,
        artifact_id=uuid4(),
        run_person_id=person,
    )
    assert [requirement.key for requirement in requirements] == [CLAUDE]
    assert requirements[0].blocks_run is True
    [call] = accounts.calls
    assert call["user_id"] == person
    assert [item.item_key for item in call["items"]] == [CLAUDE]


async def test_the_turn_on_check_skips_the_resolver_without_a_user_login():
    accounts = _AccountChoices()
    requirements = await _service(accounts=accounts).model_requirements(
        scope=_scope(),
        parameters=_agent(tools=[_gmail_tool()]),
        artifact_id=uuid4(),
        run_person_id=uuid4(),
    )
    assert requirements == [] and accounts.calls == []


async def test_a_ready_user_login_lets_the_automation_turn_on():
    """Logins each person brings do not exist yet; when they do, the resolver's answer
    is the one rule, for the automation's run person."""
    accounts = _AccountChoices(
        {
            CLAUDE: ItemAccount(
                item_key=CLAUDE,
                match=AccountMatch.CHOICE,
                secret_id=uuid4(),
                is_ready=True,
            )
        }
    )
    requirements = await _service(accounts=accounts).model_requirements(
        scope=_scope(),
        parameters=_claude_login_agent(),
        artifact_id=uuid4(),
        run_person_id=uuid4(),
    )
    assert requirements == []


async def test_the_turn_on_check_without_a_run_person_refuses_a_user_login():
    accounts = _AccountChoices()
    requirements: List[Any] = await _service(accounts=accounts).model_requirements(
        scope=_scope(),
        parameters=_claude_login_agent(),
        artifact_id=uuid4(),
        run_person_id=None,
    )
    assert [requirement.key for requirement in requirements] == [CLAUDE]
    assert accounts.calls == []
