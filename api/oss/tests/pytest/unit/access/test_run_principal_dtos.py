from datetime import datetime, timezone
from uuid import uuid4

import pytest
from pydantic import ValidationError

from oss.src.core.access.context import (
    get_request_access,
    reset_request_access,
    set_request_access,
)
from oss.src.core.access.dtos import (
    Decision,
    DecisionReason,
    PrincipalKind,
    PrincipalRecord,
    PrincipalRef,
    RequestAccess,
    RequestCredentialKind,
    RunApproval,
    RunAuthority,
    RunContext,
    RunOrigin,
    RunSender,
)
from oss.src.core.access.principals import (
    access_denied_error,
    approval_from_request,
    child_envelope,
    envelope_from_claims,
    envelope_from_json,
    envelope_to_claims,
    envelope_to_json,
    resumed_envelope,
    stored_work_envelope,
)
from oss.src.core.access.types import AccessError, InvalidRunClaims
from oss.src.utils import caching
from oss.tests.pytest.utils.principals import make_envelope, make_request_access


U = uuid4()
BOB = uuid4()
B = uuid4()
K = uuid4()
O = uuid4()  # noqa: E741
P = uuid4()


def test_claims_round_trip():
    env = make_envelope(
        kind="api_key",
        origin="api",
        origin_id="k1",
        sender=None,
        approved_by=RunApproval(principal=PrincipalRef(kind="human", id=U), user_id=U),
    )
    claims = envelope_to_claims(envelope=env)
    assert set(claims) == {
        "principal",
        "restrictions",
        "authority",
        "run",
        "approved_by",
    }
    assert claims["restrictions"] == {"agent": None}
    assert envelope_from_claims(claims=claims) == env
    assert envelope_to_json(envelope=env)["v"] == 1
    assert envelope_from_json(data=envelope_to_json(envelope=env)) == env


def test_claims_shape_matches_the_interface():
    env = make_envelope(kind="human", principal_id=U, project_id=P, organization_id=O)
    claims = envelope_to_claims(envelope=env)
    assert claims["principal"] == {"kind": "human", "id": str(U)}
    assert claims["authority"] == {
        "organization_id": str(O),
        "project_id": str(P),
        "linked_user_id": None,
    }
    assert claims["run"] == {
        "run_id": None,
        "parent_run_id": None,
        "origin": "web",
        "origin_id": None,
    }
    assert claims["sender"] == {"user_id": str(U), "external_key": None}


@pytest.mark.parametrize(
    "mutate",
    [
        lambda c: c["principal"].update(kind="service_account"),
        lambda c: c["run"].update(origin="cron"),
        lambda c: c.update(extra_key=1),
        lambda c: c["authority"].update(surprise=1),
        lambda c: c.pop("authority"),
        lambda c: c.update(authority="x"),
    ],
)
def test_unknown_kind_origin_or_key_is_refused(mutate):
    claims = envelope_to_claims(envelope=make_envelope())
    mutate(claims)
    with pytest.raises(InvalidRunClaims):
        envelope_from_claims(claims=claims)


def test_invalid_run_claims_is_an_access_error():
    assert issubclass(InvalidRunClaims, AccessError)


def test_missing_principal_returns_none():
    assert envelope_from_claims(claims={"user_id": "x", "project_id": "y"}) is None
    assert envelope_from_json(data=None) is None


def test_stored_envelope_with_unknown_version_is_refused():
    data = envelope_to_json(envelope=make_envelope())
    data["v"] = 2
    with pytest.raises(InvalidRunClaims):
        envelope_from_json(data=data)


def test_child_and_resumed_envelope():
    parent = make_envelope(run_id="t1")
    child = child_envelope(parent=parent)
    assert child.authority == parent.authority and child.sender == parent.sender
    assert child.context == RunContext(
        run_id=None, parent_run_id="t1", origin=RunOrigin.CHILD
    )
    approval = RunApproval(principal=PrincipalRef(kind="human", id=BOB), user_id=BOB)
    resumed = resumed_envelope(asked=parent, run_id="t2", approved_by=approval)
    assert resumed.context.run_id == "t2"
    assert resumed.context.origin == parent.context.origin
    assert resumed.sender == parent.sender and resumed.approved_by == approval


def test_stored_work_envelope_sets_linked_user_only_for_installation():
    inst = stored_work_envelope(
        principal=PrincipalRef(kind="installation", id=B),
        organization_id=O,
        project_id=P,
        origin=RunOrigin.SCHEDULE,
        origin_id="s1",
        created_by_id=U,
    )
    assert inst.authority.linked_user_id == U
    human = stored_work_envelope(
        principal=PrincipalRef(kind="human", id=U),
        organization_id=O,
        project_id=P,
        origin=RunOrigin.SCHEDULE,
        origin_id="s1",
        created_by_id=U,
    )
    assert human.authority.linked_user_id is None
    assert human.context.origin_id == "s1" and human.sender is None
    with pytest.raises(ValidationError):
        RunAuthority(
            principal=PrincipalRef(kind="api_key", id=K),
            organization_id=O,
            project_id=P,
            linked_user_id=U,
        )


def test_sender_needs_one_field():
    with pytest.raises(ValidationError):
        RunSender()


def test_models_are_frozen_and_forbid_extra_keys():
    ref = PrincipalRef(kind="human", id=U)
    with pytest.raises(ValidationError):
        ref.kind = PrincipalKind.API_KEY  # type: ignore[misc]
    with pytest.raises(ValidationError):
        PrincipalRef(kind="human", id=U, extra=1)


def _cached_models():
    envelope = make_envelope(kind="human", principal_id=U)
    return [
        PrincipalRecord(
            principal=PrincipalRef(kind="human", id=U), acting_user_id=U, is_active=True
        ),
        PrincipalRecord(
            principal=PrincipalRef(kind="api_key", id=K), project_id=P, is_active=False
        ),
        PrincipalRecord(
            principal=PrincipalRef(kind="api_key", id=K),
            project_id=P,
            acting_user_id=U,
            is_active=True,
            expires_at=datetime(2030, 1, 1, tzinfo=timezone.utc),
        ),
        RequestAccess(
            principal=envelope.authority.principal,
            authority=envelope.authority,
            credential_kind="bearer_session",
            acting_user_id=U,
        ),
        make_request_access(envelope=envelope, credential_kind="run_credential"),
    ]


@pytest.mark.parametrize("model", _cached_models())
def test_cached_models_survive_the_real_serializer(model):
    raw = caching._serialize(model)
    assert caching._deserialize(raw, model=type(model)) == model


def test_request_access_context_set_and_reset():
    assert get_request_access() is None
    access = make_request_access(
        envelope=make_envelope(), credential_kind="bearer_session"
    )
    token = set_request_access(access)
    assert get_request_access() == access
    reset_request_access(token)
    assert get_request_access() is None


def test_access_denied_error_shape():
    err = access_denied_error(
        decision=Decision(allowed=False, reason=DecisionReason.NOT_MEMBER),
        principal_kind=PrincipalKind.API_KEY,
        project_id=P,
    )
    assert err.code == "access_denied" and err.retryable is False
    assert err.next_step == "Ask a project admin for access."
    assert err.details == {
        "reason": "not_member",
        "principal_kind": "api_key",
        "project_id": str(P),
    }


def test_new_decision_reasons():
    assert DecisionReason.PRINCIPAL_INACTIVE.value == "principal_inactive"
    assert DecisionReason.RESTRICTED_BY_AUTHORITY.value == "restricted_by_authority"


def test_resource_denied_reason_round_trips():
    reason = DecisionReason.RESOURCE_DENIED
    assert reason.value == "resource_denied"
    assert DecisionReason("resource_denied") is reason
    decision = Decision(allowed=False, reason=reason)
    assert Decision.model_validate_json(decision.model_dump_json()) == decision
    err = access_denied_error(
        decision=decision, principal_kind=PrincipalKind.HUMAN, project_id=P
    )
    assert err.details["reason"] == "resource_denied"


@pytest.mark.parametrize(
    "kind, credential_kind, is_run_credential",
    [
        ("human", RequestCredentialKind.BEARER_SESSION, False),
        ("human", RequestCredentialKind.API_KEY, False),
        ("human", RequestCredentialKind.RUN_CREDENTIAL, True),
        ("installation", RequestCredentialKind.RUN_CREDENTIAL, True),
        # A channel answer has no request credential.
        ("installation", None, False),
        # Any other answer without a known credential counts as a run credential.
        ("human", None, True),
        ("api_key", None, True),
    ],
)
def test_approval_from_request_sets_is_run_credential(
    kind, credential_kind, is_run_credential
):
    approval = approval_from_request(
        principal=PrincipalRef(kind=kind, id=U),
        credential_kind=credential_kind,
        user_id=U,
    )
    assert approval.is_run_credential is is_run_credential
    assert approval.principal == PrincipalRef(kind=kind, id=U)
    assert approval.user_id == U


def test_is_run_credential_is_serialized_only_when_true():
    person = RunApproval(principal=PrincipalRef(kind="human", id=U), user_id=U)
    agent = RunApproval(
        principal=PrincipalRef(kind="human", id=U), user_id=U, is_run_credential=True
    )
    assert "is_run_credential" not in person.model_dump(mode="json")
    assert agent.model_dump(mode="json")["is_run_credential"] is True
    # The stored envelope of a person's answer carries no new key, so an older pod,
    # which refuses unknown keys, still reads it.
    stored = envelope_to_json(
        envelope=resumed_envelope(
            asked=make_envelope(), run_id="r2", approved_by=person
        )
    )
    assert stored["approved_by"] == {
        "principal": {"kind": "human", "id": str(U)},
        "user_id": str(U),
        "external_key": None,
    }


def test_an_envelope_stored_before_the_field_reads_as_not_a_run_credential():
    """An approval answered before the deploy, delivered after it."""
    stored = envelope_to_json(envelope=make_envelope(kind="human", principal_id=U))
    stored["approved_by"] = {
        "principal": {"kind": "installation", "id": str(B)},
        "user_id": str(U),
        "external_key": "slack:U1",
    }
    envelope = envelope_from_json(data=stored)
    assert envelope.approved_by.is_run_credential is False
    assert envelope.approved_by.external_key == "slack:U1"
