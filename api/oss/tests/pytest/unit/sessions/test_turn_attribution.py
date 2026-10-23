"""Turn attribution (M2): a turn records the principal, sender, run context and
approver of the credential that appended it, never of the request body."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import oss.src.apis.fastapi.sessions.router as router_module
from oss.src.apis.fastapi.sessions.models import (
    SessionTurnAppendRequest,
    SessionTurnCompleteRequest,
)
from oss.src.apis.fastapi.sessions.router import SessionTurnsRouter
from oss.src.core.access.dtos import (
    PrincipalKind,
    PrincipalRef,
    RequestCredentialKind,
    RunApproval,
    RunAuthority,
    RunSender,
)
from oss.src.core.access.principals import resumed_envelope
from oss.src.core.sessions.turns.dtos import HarnessKind
from oss.src.dbs.postgres.sessions.turns.mappings import (
    map_turn_attribution_to_columns,
)
from oss.tests.pytest.utils.principals import make_envelope


@pytest.fixture(autouse=True)
def _allow(monkeypatch):
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )


def _router():
    turns = AsyncMock()
    turns.append_turn = AsyncMock(side_effect=lambda **kw: None)
    turns.complete_turn = AsyncMock(side_effect=lambda **kw: None)
    return SessionTurnsRouter(turns_service=turns), turns


def _bearer_request(user_id, project_id, organization_id):
    principal = PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)
    return SimpleNamespace(
        state=SimpleNamespace(
            project_id=project_id,
            user_id=user_id,
            principal=principal,
            authority=RunAuthority(
                principal=principal,
                organization_id=organization_id,
                project_id=project_id,
            ),
            credential_kind=RequestCredentialKind.BEARER_SESSION,
            run_envelope=None,
        )
    )


def _secret_request(envelope):
    return SimpleNamespace(
        state=SimpleNamespace(
            project_id=envelope.authority.project_id,
            user_id=uuid4(),
            principal=envelope.authority.principal,
            authority=envelope.authority,
            credential_kind=RequestCredentialKind.RUN_CREDENTIAL,
            run_envelope=envelope,
        )
    )


def _append_body(index=0):
    return SessionTurnAppendRequest(
        session_id="s1",
        stream_id=uuid4(),
        turn_index=index,
        harness_kind=HarnessKind.PI,
    )


async def test_two_people_in_one_session():
    router, turns = _router()
    project_id, organization_id = uuid4(), uuid4()
    alice, bob = uuid4(), uuid4()
    for index, user in enumerate((alice, bob)):
        try:
            await router.append_turn(
                _bearer_request(user, project_id, organization_id), _append_body(index)
            )
        except Exception:  # noqa: BLE001 - the stub returns no turn
            pass
    created = [call.kwargs["turn"] for call in turns.append_turn.await_args_list]
    columns = [map_turn_attribution_to_columns(envelope=t.envelope) for t in created]
    assert [c["sender_user_id"] for c in columns] == [alice, bob]
    assert [c["principal_id"] for c in columns] == [alice, bob]
    assert {c["origin"] for c in columns} == {"web"}


def test_body_cannot_set_sender():
    # The append body has no envelope or attribution field: whatever a client adds is
    # dropped, and the route builds the attribution from the credential.
    body = SessionTurnAppendRequest.model_validate(
        {
            "session_id": "s1",
            "stream_id": str(uuid4()),
            "turn_index": 0,
            "harness_kind": "pi_core",
            "envelope": {"sender": {"user_id": str(uuid4())}},
            "sender": {"user_id": str(uuid4())},
        }
    )
    assert "envelope" not in body.model_dump() and "sender" not in body.model_dump()


def test_unlinked_slack_user_turn():
    binding = uuid4()
    envelope = make_envelope(
        kind="installation",
        principal_id=binding,
        origin="installation",
        origin_id=str(binding),
        sender=RunSender(external_key="slack:T1:U9"),
    )
    columns = map_turn_attribution_to_columns(envelope=envelope)
    assert columns["principal_kind"] == "installation"
    assert columns["principal_id"] == binding
    assert columns["sender_user_id"] is None
    assert columns["sender_external_key"] == "slack:T1:U9"
    assert columns["origin"] == "installation"


def test_resumed_turn_keeps_sender_records_approver():
    alice, bob = uuid4(), uuid4()
    asked = make_envelope(principal_id=alice, run_id="t1")
    approval = RunApproval(principal=PrincipalRef(kind="human", id=bob), user_id=bob)
    resumed = resumed_envelope(asked=asked, run_id="t2", approved_by=approval)
    columns = map_turn_attribution_to_columns(envelope=resumed)
    assert columns["sender_user_id"] == alice and columns["principal_id"] == alice
    assert columns["approved_by"] == approval.model_dump(mode="json")


def test_api_key_approval_records_key_and_creator():
    key, creator = uuid4(), uuid4()
    asked = make_envelope(run_id="t1")
    approval = RunApproval(
        principal=PrincipalRef(kind="api_key", id=key), user_id=creator
    )
    columns = map_turn_attribution_to_columns(
        envelope=resumed_envelope(asked=asked, run_id="t2", approved_by=approval)
    )
    assert columns["approved_by"]["principal"] == {"kind": "api_key", "id": str(key)}
    assert columns["approved_by"]["user_id"] == str(creator)


async def test_append_and_complete_pass_the_run_credential_envelope():
    router, turns = _router()
    envelope = make_envelope(kind="api_key", origin="api", origin_id="k", sender=None)
    request = _secret_request(envelope)
    for call in (
        router.append_turn(request, _append_body()),
        router.complete_turn(
            request,
            SessionTurnCompleteRequest(
                session_id="s1", turn_index=0, end_time="2026-10-23T00:00:00Z"
            ),
        ),
    ):
        try:
            await call
        except Exception:  # noqa: BLE001 - the stub returns no turn
            pass
    assert turns.append_turn.await_args.kwargs["turn"].envelope == envelope
    assert turns.complete_turn.await_args.kwargs["turn"].envelope == envelope
