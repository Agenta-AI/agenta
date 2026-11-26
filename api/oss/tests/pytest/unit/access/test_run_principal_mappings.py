"""Read mappings of the run principal columns (C7)."""

from types import SimpleNamespace
from uuid import uuid4

from oss.src.core.access.dtos import PrincipalKind, PrincipalRef, RunApproval
from oss.src.core.access.principals import envelope_to_json
from oss.src.dbs.postgres.access.mappings import (
    map_envelope_column,
    map_principal_columns,
    map_principal_to_columns,
)
from oss.src.dbs.postgres.sessions.turns.mappings import (
    map_turn_attribution_dbe_to_dto,
)
from oss.tests.pytest.utils.principals import make_envelope


def _turn(**columns):
    fields = dict(
        turn_id=None,
        principal_kind=None,
        principal_id=None,
        sender_user_id=None,
        sender_external_key=None,
        origin=None,
        origin_id=None,
        parent_run_id=None,
        approved_by=None,
    )
    fields.update(columns)
    return SimpleNamespace(**fields)


def test_historical_turn_reads_null():
    assert map_turn_attribution_dbe_to_dto(turn_dbe=_turn()) == {
        "principal": None,
        "sender": None,
        "context": None,
        "approved_by": None,
    }


def test_turn_attribution_maps_every_column():
    user, bob, turn_id = uuid4(), uuid4(), uuid4()
    approval = RunApproval(principal=PrincipalRef(kind="human", id=bob), user_id=bob)
    mapped = map_turn_attribution_dbe_to_dto(
        turn_dbe=_turn(
            turn_id=turn_id,
            principal_kind="installation",
            principal_id=user,
            sender_user_id=None,
            sender_external_key="slack:U1",
            origin="installation",
            origin_id="b1",
            approved_by=approval.model_dump(mode="json"),
        )
    )
    assert mapped["principal"].kind == PrincipalKind.INSTALLATION
    assert mapped["sender"].external_key == "slack:U1"
    assert mapped["context"].run_id == str(turn_id)
    assert mapped["context"].origin_id == "b1"
    assert mapped["approved_by"] == approval


def test_unknown_principal_kind_reads_as_none():
    assert map_principal_columns(kind="service_account", id=uuid4()) is None
    assert map_principal_columns(kind=None, id=None) is None


def test_principal_columns_round_trip():
    ref = PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())
    columns = map_principal_to_columns(principal=ref)
    assert (
        map_principal_columns(
            kind=columns["principal_kind"], id=columns["principal_id"]
        )
        == ref
    )
    assert map_principal_to_columns(principal=None) == {
        "principal_kind": None,
        "principal_id": None,
    }


def test_unreadable_envelope_reads_as_none():
    assert map_envelope_column(data=None) is None
    assert map_envelope_column(data={"v": 9}) is None
    envelope = make_envelope()
    assert map_envelope_column(data=envelope_to_json(envelope=envelope)) == envelope


def test_envelope_fields_are_not_in_responses():
    from oss.src.core.sessions.inputs.dtos import PendingInput
    from oss.src.core.sessions.interactions.dtos import SessionInteraction

    for model in (PendingInput, SessionInteraction):
        schema = model.model_json_schema(mode="serialization")
        assert "run_envelope" not in schema.get("properties", {}), model
