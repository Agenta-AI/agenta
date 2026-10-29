"""The run person, the `run_accounts` claim, and the one read at run start."""

from uuid import uuid4

import pytest

import oss.src.core.account_choices.policy as policy_module
import oss.src.core.account_choices.service as service_module
from agenta.sdk.agents.accounts import read_user_items
from oss.src.core.access.dtos import RunOrigin
from oss.src.core.access.types import InvalidRunClaims
from oss.src.core.account_choices.claims import (
    run_account,
    run_accounts_claim,
    run_accounts_from_claim,
    sign_run_accounts,
)
from oss.src.core.account_choices.dtos import AccountMatch, ItemAccount
from oss.src.core.account_choices.items import run_person_id, user_items_of_revision
from oss.src.core.workflows.dtos import WorkflowRevisionData
from oss.tests.pytest.utils.principals import make_envelope, make_request_access

GMAIL = "app_connection:user/gmail"
TOKEN = "secret:user/GITHUB_TOKEN"

AGENT = {
    "agent": {
        "tools": [
            {
                "type": "gateway_connection",
                "connection": {
                    "provider": "composio",
                    "integration": "gmail",
                    "account_source": "user",
                },
            }
        ],
        "sandbox": {
            "credentials": [
                {
                    "secret": {"account_source": "user"},
                    "binding": {"type": "env", "name": "GITHUB_TOKEN"},
                }
            ]
        },
    }
}


@pytest.fixture
def switch_on(monkeypatch):
    monkeypatch.setattr(
        policy_module.env.agenta.access, "personal_accounts_enabled", True
    )


class _Service:
    def __init__(self):
        self.calls = []

    async def resolve(self, **kwargs):
        self.calls.append(kwargs)
        return [
            ItemAccount(
                item_key=GMAIL,
                match=AccountMatch.DEFAULT,
                gateway_connection_id=uuid4(),
                is_ready=True,
            ),
            ItemAccount(item_key=TOKEN),  # no account: left out of the claim
        ]


@pytest.fixture
def service(monkeypatch):
    fake = _Service()
    monkeypatch.setattr(service_module, "_account_choices_service", fake)
    return fake


def test_the_run_person_is_a_human_principal_only():
    person = uuid4()
    assert run_person_id(make_envelope(kind="human", principal_id=person)) == person
    assert run_person_id(make_envelope(kind="api_key")) is None
    assert run_person_id(make_envelope(kind="installation")) is None
    assert run_person_id(make_envelope(kind="human", origin=RunOrigin.CHILD)) is None
    assert run_person_id(None) is None


def test_the_claim_lists_only_ready_accounts_and_round_trips():
    ready = ItemAccount(
        item_key=GMAIL,
        match=AccountMatch.DEFAULT,
        gateway_connection_id=uuid4(),
        is_ready=True,
    )
    not_ready = ItemAccount(
        item_key=TOKEN, match=AccountMatch.CHOICE, secret_id=uuid4(), is_ready=False
    )
    claim = run_accounts_claim([ready, not_ready])
    assert claim == [
        {"item_key": GMAIL, "gateway_connection_id": str(ready.gateway_connection_id)}
    ]
    accounts = run_accounts_from_claim(claim)
    access = make_request_access(
        envelope=make_envelope(kind="human"), credential_kind="run_credential"
    ).model_copy(update={"run_accounts": accounts})
    assert (
        run_account(access, GMAIL).gateway_connection_id == ready.gateway_connection_id
    )
    assert run_account(access, TOKEN) is None
    assert run_account(None, GMAIL) is None


@pytest.mark.parametrize(
    "value",
    [
        "not-a-list",
        [{"item_key": GMAIL}],  # no account id
        [
            {
                "item_key": GMAIL,
                "secret_id": str(uuid4()),
                "gateway_connection_id": str(uuid4()),
            }
        ],
        [{"item_key": "gmail", "secret_id": str(uuid4())}],  # not an item key
        [{"item_key": GMAIL, "secret_id": str(uuid4()), "value": "x"}],
    ],
)
def test_a_malformed_claim_is_refused(value):
    with pytest.raises(InvalidRunClaims):
        run_accounts_from_claim(value)


def test_the_item_reader_reads_the_revision_parameters():
    revision = WorkflowRevisionData(parameters=AGENT)
    keys = [item.item_key for item in user_items_of_revision(revision)]
    assert keys == [GMAIL, TOKEN]
    assert user_items_of_revision(None) == []


async def test_no_user_items_means_no_read(switch_on, service):
    envelope = make_envelope(kind="human")
    assert (
        await sign_run_accounts(
            envelope=envelope, items=read_user_items({"agent": {}}), artifact_id=uuid4()
        )
        is None
    )
    assert service.calls == []


async def test_user_items_resolve_once_for_the_run_person(switch_on, service):
    person = uuid4()
    envelope = make_envelope(kind="human", principal_id=person)
    claim = await sign_run_accounts(
        envelope=envelope, items=read_user_items(AGENT), artifact_id=uuid4()
    )
    assert len(service.calls) == 1
    assert service.calls[0]["user_id"] == person
    assert [entry["item_key"] for entry in claim] == [GMAIL]


async def test_an_api_key_run_resolves_for_no_person(switch_on, service):
    await sign_run_accounts(
        envelope=make_envelope(kind="api_key"),
        items=read_user_items(AGENT),
        artifact_id=uuid4(),
    )
    assert service.calls[0]["user_id"] is None


async def test_the_switch_off_reads_nothing(monkeypatch, service):
    monkeypatch.setattr(
        policy_module.env.agenta.access, "personal_accounts_enabled", False
    )
    assert (
        await sign_run_accounts(
            envelope=make_envelope(kind="human"),
            items=read_user_items(AGENT),
            artifact_id=uuid4(),
        )
        is None
    )
    assert service.calls == []
