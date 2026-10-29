"""Meters without a workspace (workspace removal step 2, MS "scope").

A meter is scoped by organization, project and user. The organization-scope ids (every
billed meter) do not change; the user-scope id loses its `wrk` part. Rows that a step-1
pod writes during the rollout keep their stored id, so the report bumps them, and the
current-row read never takes them.
"""

from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid5

import pytest

from ee.src.core.access.entitlements.types import Counter, Gauge, Quota, Scope
from ee.src.core.meters.types import (
    AGENTA_METERS_NAMESPACE_UUID,
    MeterDTO,
    MeterPeriod,
    MeterScope,
    Meters,
    compute_meter_id,
)
from ee.src.dbs.postgres.meters import dao as meters_dao
from ee.src.dbs.postgres.meters.dao import MetersDAO, _dbe_to_dto
from ee.src.dbs.postgres.subscriptions.dbes import SubscriptionDBE  # noqa: F401
from oss.src.utils.context import (
    ApiKeyCredentials,
    AuthContext,
    AuthScope,
    reset_auth_context,
    set_auth_context,
)

ORG = UUID("a1111111-1111-1111-1111-111111111111")
WRK = UUID("b2222222-2222-2222-2222-222222222222")
PRJ = UUID("c3333333-3333-3333-3333-333333333333")
USR = UUID("d4444444-4444-4444-4444-444444444444")
DAY = MeterPeriod(year=2026, month=10, day=25)
MONTH = MeterPeriod(year=2026, month=10)


def _step1_compute_meter_id(
    *, organization_id, workspace_id, project_id, user_id, period, key
):
    """Verbatim copy of the step-1 canonical form (with the `wrk` part)."""

    parts = {"key": str(getattr(key, "value", key))}
    if organization_id is not None:
        parts["org"] = str(organization_id).lower()
    if workspace_id is not None:
        parts["wrk"] = str(workspace_id).lower()
    if project_id is not None:
        parts["prj"] = str(project_id).lower()
    if user_id is not None:
        parts["usr"] = str(user_id).lower()
    if period.year is not None:
        parts["y"] = str(int(period.year))
    if period.month is not None:
        parts["m"] = str(int(period.month))
    if period.day is not None:
        parts["d"] = str(int(period.day))
    canonical = "|".join(f"{k}={parts[k]}" for k in sorted(parts))
    return uuid5(AGENTA_METERS_NAMESPACE_UUID, canonical)


def test_meter_scope_has_no_workspace():
    assert "workspace_id" not in MeterScope.model_fields
    assert "workspace_id" not in MeterDTO.model_fields


@pytest.mark.parametrize(
    "key,period",
    [
        (Counter.TRACES_INGESTED, MONTH),
        (Counter.EVALUATIONS_RUN, MONTH),
        (Gauge.USERS, MeterPeriod()),
    ],
)
def test_org_scope_ids_are_unchanged(key, period):
    step1 = _step1_compute_meter_id(
        organization_id=ORG,
        workspace_id=None,
        project_id=None,
        user_id=None,
        period=period,
        key=key,
    )
    step2 = compute_meter_id(
        scope=MeterScope(organization_id=ORG), period=period, key=key
    )
    assert step1 == step2


def test_user_scope_id_drops_wrk():
    step2 = compute_meter_id(
        scope=MeterScope(organization_id=ORG, project_id=PRJ, user_id=USR),
        period=DAY,
        key=Counter.TRACES_RETRIEVED,
    )
    assert step2 == uuid5(
        AGENTA_METERS_NAMESPACE_UUID,
        f"d=25|key=traces_retrieved|m=10|org={ORG}|prj={PRJ}|usr={USR}|y=2026",
    )
    assert step2 != _step1_compute_meter_id(
        organization_id=ORG,
        workspace_id=WRK,
        project_id=PRJ,
        user_id=USR,
        period=DAY,
        key=Counter.TRACES_RETRIEVED,
    )


def test_meter_scope_project_requires_the_organization():
    with pytest.raises(ValueError, match="project_id requires organization_id"):
        MeterScope(project_id=PRJ)


@pytest.fixture
def auth_context():
    ctx = AuthContext(
        credentials=ApiKeyCredentials(value="test-token"),
        # The ambient workspace (step-1 shape; gone with Task 3) is never read.
        scope=AuthScope(
            organization_id=ORG, workspace_id=WRK, project_id=PRJ, user_id=USR
        ),
    )
    token = set_auth_context(ctx)
    try:
        yield ctx
    finally:
        reset_auth_context(token)


def test_scope_from_user_has_no_workspace(auth_context):
    from ee.src.core.access.entitlements.service import scope_from

    assert scope_from(scope=Scope.USER) == MeterScope(
        organization_id=ORG, project_id=PRJ, user_id=USR
    )
    assert scope_from(scope=Scope.PROJECT) == MeterScope(
        organization_id=ORG, project_id=PRJ
    )


def test_operator_plan_with_workspace_scope_reads_as_organization(monkeypatch):
    from ee.src.core.access.entitlements import types as entitlements_types

    warnings = []
    monkeypatch.setattr(
        entitlements_types,
        "log",
        SimpleNamespace(warning=lambda message, *a, **k: warnings.append(message)),
    )
    assert not hasattr(Scope, "WORKSPACE")
    quota = Quota(limit=10, scope="workspace")
    assert quota.scope == Scope.ORGANIZATION
    assert len(warnings) == 1 and "workspace" in warnings[0]
    assert Quota(limit=10, scope="user").scope == Scope.USER
    assert len(warnings) == 1


# --- DAO ------------------------------------------------------------------------- #


class _Scalars:
    def __init__(self, rows=()):
        self._rows = list(rows)

    def all(self):
        return self._rows


class _Result:
    def __init__(self, rows=(), rowcount=1):
        self._rows = rows
        self.rowcount = rowcount

    def scalars(self):
        return _Scalars(self._rows)

    def fetchone(self):
        return (1,)


class _Session:
    def __init__(self, rows=(), rowcount=1):
        self.statements: list[Any] = []
        self._rows = rows
        self._rowcount = rowcount

    async def execute(self, statement):
        self.statements.append(statement)
        return _Result(self._rows, self._rowcount)

    async def commit(self):
        return None

    async def rollback(self):
        return None


class _Engine:
    def __init__(self, session):
        self._session = session

    def session(self):
        session = self._session

        class _Context:
            async def __aenter__(self):
                return session

            async def __aexit__(self, *args):
                return False

        return _Context()


def _sql(statement) -> str:
    from sqlalchemy.dialects import postgresql

    return str(
        statement.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    ).lower()


async def test_fetch_ignores_a_row_with_a_workspace():
    session = _Session()
    dao = MetersDAO(engine=_Engine(session))
    await dao.fetch(
        scope=MeterScope(organization_id=ORG, project_id=PRJ, user_id=USR),
        key=Meters.TRACES_RETRIEVED,
        period=DAY,
    )
    assert "meters.workspace_id is null" in _sql(session.statements[0])


def _row(**overrides):
    values = dict(
        organization_id=ORG,
        workspace_id=WRK,
        project_id=PRJ,
        user_id=USR,
        year=2026,
        month=10,
        day=25,
        key=Meters.TRACES_RETRIEVED,
        value=5,
        synced=3,
        subscription=None,
    )
    values.update(overrides)
    values.setdefault(
        "meter_id",
        _step1_compute_meter_id(
            organization_id=ORG,
            workspace_id=values["workspace_id"],
            project_id=PRJ,
            user_id=USR,
            period=DAY,
            key=Counter.TRACES_RETRIEVED,
        ),
    )
    return SimpleNamespace(**values)


async def test_dump_keeps_the_stored_meter_id():
    row = _row()
    dto = _dbe_to_dto(row)
    assert dto.meter_id == row.meter_id
    # The report bumps that row, by its stored id, with compare-and-set.
    session = _Session()
    dao = MetersDAO(engine=_Engine(session))
    dto.synced = dto.value
    await dao.bump(meters=[dto], synced_read={dto.meter_id: 3})
    sql = _sql(session.statements[0])
    assert f"meters.meter_id = '{row.meter_id}'" in sql
    assert "meters.synced = 3" in sql
    assert "meters.value >= 5" in sql


async def test_adjust_writes_no_workspace():
    session = _Session()
    dao = MetersDAO(engine=_Engine(session))
    meter = MeterDTO(
        organization_id=ORG,
        project_id=PRJ,
        user_id=USR,
        year=2026,
        month=10,
        day=25,
        key=Meters.TRACES_RETRIEVED,
        delta=1,
    )
    await dao.adjust(meter=meter, quota=Quota(limit=None))
    assert "workspace_id" not in _sql(session.statements[0])


async def test_bump_counts_are_unchanged():
    session = _Session()
    dao = MetersDAO(engine=_Engine(session))
    meters = []
    for user in range(3):
        dto = _dbe_to_dto(_row(workspace_id=None, user_id=UUID(int=user + 1)))
        meters.append(dto)
    await dao.bump(meters=meters, synced_read={m.meter_id: m.synced for m in meters})
    assert len(session.statements) == 3


def test_format_meter_for_log_has_no_workspace():
    dto = _dbe_to_dto(_row(workspace_id=None))
    assert str(WRK) not in meters_dao._format_meter_for_log(dto)
