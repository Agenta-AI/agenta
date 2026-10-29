"""Meter rows without a workspace (written and re-keyed by workspace removal step 2).

A step-1 pod must read them: the usage report converts every row it reports, and a row
that fails conversion is skipped and never synced, which stalls the report run during a
step-2 rollout or rollback. Their `meter_id` is the step-2 id: `compute_meter_id` omits
the missing workspace part.
"""

from types import SimpleNamespace
from uuid import UUID, uuid5

from ee.src.core.access.entitlements.types import Counter
from ee.src.core.meters.types import (
    AGENTA_METERS_NAMESPACE_UUID,
    MeterPeriod,
    MeterScope,
    compute_meter_id,
)
from ee.src.dbs.postgres.meters.dao import _dbe_to_dto

ORG = UUID("11111111-1111-1111-1111-111111111111")
WS = UUID("22222222-2222-2222-2222-222222222222")
PRJ = UUID("33333333-3333-3333-3333-333333333333")
USR = UUID("44444444-4444-4444-4444-444444444444")
PERIOD = MeterPeriod(year=2026, month=10, day=25)


def test_meter_scope_accepts_a_project_without_a_workspace():
    scope = MeterScope(organization_id=ORG, project_id=PRJ, user_id=USR)
    assert scope.project_id == PRJ


def test_compute_meter_id_of_a_switch_row_equals_the_step2_id():
    # Frozen copy of the step-2 canonical string: no `wrk` part.
    step2 = uuid5(
        AGENTA_METERS_NAMESPACE_UUID,
        f"d=25|key=traces_retrieved|m=10|org={ORG}|prj={PRJ}|usr={USR}|y=2026",
    )
    assert (
        compute_meter_id(
            scope=MeterScope(organization_id=ORG, project_id=PRJ, user_id=USR),
            period=PERIOD,
            key=Counter.TRACES_RETRIEVED,
        )
        == step2
    )


def test_dump_converts_a_row_without_a_workspace():
    stored = compute_meter_id(
        scope=MeterScope(organization_id=ORG, project_id=PRJ, user_id=USR),
        period=PERIOD,
        key=Counter.TRACES_RETRIEVED,
    )
    row = SimpleNamespace(
        organization_id=ORG,
        workspace_id=None,
        project_id=PRJ,
        user_id=USR,
        year=2026,
        month=10,
        day=25,
        key=Counter.TRACES_RETRIEVED,
        value=5,
        synced=3,
        meter_id=stored,
        subscription=None,
    )
    dto = _dbe_to_dto(row)
    assert dto.meter_id == stored
