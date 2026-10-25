"""Revision `ee0000000007` (meters re-keyed without the workspace) on a real Postgres.

Each case seeds its own organizations and limits the walk to them
(`rekey(..., organization_ids=...)`), so rows of the shared database and of parallel tests
are never moved. The seed-wide sum check runs in one transaction that is rolled back.
"""

import asyncio
import functools
from types import SimpleNamespace
from uuid import UUID, uuid4, uuid5

import pytest
from sqlalchemy import text

from ee.src.core.access.entitlements.types import Counter
from ee.src.core.meters.service import MetersService
from ee.src.core.meters.types import AGENTA_METERS_NAMESPACE_UUID, Meters
from ee.src.dbs.postgres.meters.dao import MetersDAO
from ee.src.dbs.postgres.subscriptions.dbes import SubscriptionDBE  # noqa: F401
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    fetch_all,
    seed_organization,
)


pytestmark = pytest.mark.integration


@functools.lru_cache(maxsize=1)
def _revision():
    import importlib.util
    from pathlib import Path

    path = (
        Path(__file__).resolve().parents[4]
        / "databases/postgres/migrations/core_ee/versions"
        / "ee0000000007_rekey_meters_without_workspace.py"
    )
    spec = importlib.util.spec_from_file_location("_revision_ee007", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _id(
    *, org, wrk=None, prj=None, usr=None, key="traces_retrieved", y=2026, m=10, d=25
):
    parts = {"key": key, "org": str(org)}
    if wrk:
        parts["wrk"] = str(wrk)
    if prj:
        parts["prj"] = str(prj)
    if usr:
        parts["usr"] = str(usr)
    if y is not None:
        parts["y"] = str(y)
    if m is not None:
        parts["m"] = str(m)
    if d is not None:
        parts["d"] = str(d)
    canonical = "|".join(f"{k}={parts[k]}" for k in sorted(parts))
    return uuid5(AGENTA_METERS_NAMESPACE_UUID, canonical)


async def _insert(*, org, wrk, prj, usr, value, synced, key="TRACES_RETRIEVED", day=25):
    key_value = Meters[key].value
    period = {"y": 2026, "m": 10, "d": day}
    if key != "TRACES_RETRIEVED":
        period = {"y": 2026, "m": 10, "d": None}
    meter_id = _id(org=org, wrk=wrk, prj=prj, usr=usr, key=key_value, **period)
    await execute(
        "INSERT INTO meters (meter_id, organization_id, workspace_id, project_id, user_id, "
        "key, year, month, day, value, synced, created_at) VALUES (:id, :o, :w, :p, :u, "
        "CAST(:k AS meters_type), :y, :m, :d, :v, :s, now())",
        {
            "id": meter_id,
            "o": org,
            "w": wrk,
            "p": prj,
            "u": usr,
            "k": key,
            "y": period["y"],
            "m": period["m"],
            "d": period["d"],
            "v": value,
            "s": synced,
        },
    )
    return meter_id


async def _meters(org):
    return {
        row["meter_id"]: row
        for row in await fetch_all(
            "SELECT meter_id, workspace_id, project_id, user_id, key::text AS key, year, "
            "month, day, value, synced, created_at FROM meters WHERE organization_id = :o",
            {"o": org},
        )
    }


def _autocommit_run(organization_ids, **kwargs):
    async def run():
        engine = get_transactions_engine()._engine
        async with engine.connect() as connection:
            connection = await connection.execution_options(
                isolation_level="AUTOCOMMIT"
            )
            return await connection.run_sync(
                lambda sync: _revision().run(
                    sync, organization_ids=organization_ids, **kwargs
                )
            )

    return run()


class _FakeRedis:
    """SET NX EX, and the owner-checked renew and release scripts."""

    def __init__(self):
        self.values = {}

    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    def eval(self, script, numkeys, key, owner, *args):
        if self.values.get(key) != owner:
            return 0
        if "DEL" in script:
            del self.values[key]
        return 1


def _lock(client=None, **kwargs):
    return _revision().ReportLock(client or _FakeRedis(), **kwargs)


@pytest.fixture
async def org():
    seeded = await seed_organization(members={"m": "editor"})
    yield SimpleNamespace(
        seeded=seeded,
        id=seeded.organization_id,
        ws=seeded.workspace_ids[0],
        prj=seeded.project_ids[0],
        usr=seeded.user_ids["m"],
        other_ws=uuid4(),
    )
    await delete_seeded_organization(seeded)


async def test_ee007_rekeys_a_plain_row(org):
    await _insert(org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=40, synced=30)
    counts = await _autocommit_run([org.id], lock=_lock())
    rows = await _meters(org.id)
    new_id = _id(org=org.id, prj=org.prj, usr=org.usr)
    assert list(rows) == [new_id]
    assert (rows[new_id]["value"], rows[new_id]["synced"]) == (40, 30)
    assert rows[new_id]["workspace_id"] is None
    assert counts["rows"] == 1


async def test_ee007_folds_a_collision(org):
    await _insert(org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=40, synced=30)
    await _insert(
        org=org.id, wrk=org.other_ws, prj=org.prj, usr=org.usr, value=3, synced=1
    )
    # A row a step-2 pod already wrote under the new id.
    await _insert(org=org.id, wrk=None, prj=org.prj, usr=org.usr, value=2, synced=0)
    await _autocommit_run([org.id], lock=_lock(), batch_size=1)
    rows = await _meters(org.id)
    new_id = _id(org=org.id, prj=org.prj, usr=org.usr)
    assert list(rows) == [new_id]
    assert (rows[new_id]["value"], rows[new_id]["synced"]) == (45, 31)


async def test_ee007_leaves_organization_meters_byte_identical(org):
    await _insert(
        org=org.id,
        wrk=None,
        prj=None,
        usr=None,
        value=7,
        synced=4,
        key="TRACES_INGESTED",
    )
    await _insert(org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=1, synced=0)
    before = {
        k: v for k, v in (await _meters(org.id)).items() if v["project_id"] is None
    }
    await _autocommit_run([org.id], lock=_lock())
    after = {
        k: v for k, v in (await _meters(org.id)).items() if v["project_id"] is None
    }
    assert before == after and len(after) == 1


async def test_ee007_refuses_a_workspace_row_without_project(org):
    await _insert(org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=1, synced=0)
    await _insert(
        org=org.id,
        wrk=org.ws,
        prj=None,
        usr=None,
        value=5,
        synced=0,
        key="TRACES_INGESTED",
    )
    before = await _meters(org.id)
    with pytest.raises(_revision().RekeyRefused):
        await _autocommit_run([org.id], lock=_lock())
    assert await _meters(org.id) == before


async def test_ee007_is_idempotent(org):
    await _insert(org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=4, synced=2)
    await _autocommit_run([org.id], lock=_lock())
    after_first = await _meters(org.id)
    counts = await _autocommit_run([org.id], lock=_lock())
    assert counts["rows"] == 0
    assert await _meters(org.id) == after_first


async def test_ee007_keeps_sums_per_logical_meter(org):
    # This test's own organization: colliding rows (two workspaces, one user and day), a
    # plain row, a row already at the new id and an organization row; one transaction
    # that is rolled back.
    other_user = uuid4()
    await _insert(org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=40, synced=30)
    await _insert(
        org=org.id, wrk=org.other_ws, prj=org.prj, usr=org.usr, value=3, synced=1
    )
    await _insert(
        org=org.id, wrk=None, prj=org.prj, usr=org.usr, value=2, synced=0, day=24
    )
    await _insert(
        org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=5, synced=5, day=24
    )
    await _insert(
        org=org.id, wrk=org.ws, prj=org.prj, usr=other_user, value=7, synced=0
    )
    await _insert(
        org=org.id,
        wrk=None,
        prj=None,
        usr=None,
        value=9,
        synced=4,
        key="TRACES_INGESTED",
    )
    scope = "WHERE organization_id = CAST(:o AS uuid)"
    sums_sql = (
        "SELECT organization_id, project_id, user_id, key::text, year, month, day, "
        f"sum(value) AS value, sum(synced) AS synced FROM meters {scope} "
        "GROUP BY 1, 2, 3, 4, 5, 6, 7 ORDER BY 1, 2, 3, 4, 5, 6, 7"
    )
    engine = get_transactions_engine()._engine
    async with engine.connect() as connection:
        transaction = await connection.begin()
        try:
            before = (await connection.execute(text(sums_sql), {"o": org.id})).all()
            await connection.run_sync(
                lambda sync: _revision().rekey(sync, organization_ids=[org.id])
            )
            after = (await connection.execute(text(sums_sql), {"o": org.id})).all()
            rows = (
                await connection.execute(
                    text(f"SELECT count(*) FROM meters {scope}"), {"o": org.id}
                )
            ).scalar()
            left = (
                await connection.execute(
                    text(
                        f"SELECT count(*) FROM meters {scope} AND workspace_id IS NOT NULL"
                    ),
                    {"o": org.id},
                )
            ).scalar()
        finally:
            await transaction.rollback()
    assert before == after
    assert rows == 4  # 6 rows, two folds
    assert left == 0


_STEP1_ADJUST_SQL = (
    "INSERT INTO meters (meter_id, organization_id, workspace_id, project_id, user_id, key, "
    "year, month, day, value, synced) VALUES (:id, :o, :w, :p, :u, "
    "CAST('TRACES_RETRIEVED' AS meters_type), 2026, 10, 25, :delta, 0) "
    "ON CONFLICT (meter_id) DO UPDATE SET value = greatest(meters.value + :delta, 0)"
)


async def test_ee007_loses_no_concurrent_increment(org):
    old_id = await _insert(
        org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=40, synced=30
    )
    engine = get_transactions_engine()._engine
    async with engine.connect() as a:
        transaction = await a.begin()
        rows = (
            await a.execute(
                text(_revision()._PAGE_SQL),
                {"orgs": [org.id], "after": None, "limit": 10},
            )
        ).all()
        await a.run_sync(lambda sync: _revision().move_batch(sync, rows))

        async def step1_adjust():
            async with engine.begin() as b:
                await b.execute(
                    text(_STEP1_ADJUST_SQL),
                    {
                        "id": old_id,
                        "o": org.id,
                        "w": org.ws,
                        "p": org.prj,
                        "u": org.usr,
                        "delta": 5,
                    },
                )

        adjust = asyncio.create_task(step1_adjust())
        await asyncio.sleep(0.4)
        assert not adjust.done()
        await transaction.commit()
    await adjust
    rows = await _meters(org.id)
    new_id = _id(org=org.id, prj=org.prj, usr=org.usr)
    assert rows[new_id]["value"] == 40
    assert rows[old_id]["value"] == 5  # the straggler, folded by step 2b
    assert sum(r["value"] for r in rows.values()) == 45


async def test_ee007_waits_for_an_active_report(org):
    await _insert(org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=1, synced=0)
    revision = _revision()
    redis = _FakeRedis()
    redis.values[revision.report_lock_key()] = "the-report"
    now = [0.0]
    polls = []

    def sleep(seconds):
        polls.append(seconds)
        now[0] += seconds
        if len(polls) == 2:
            del redis.values[revision.report_lock_key()]  # the report finishes

    lock = _lock(redis, sleep=sleep, clock=lambda: now[0])
    counts = await _autocommit_run([org.id], lock=lock)
    assert polls == [5, 5]
    assert counts["rows"] == 1
    assert revision.report_lock_key() not in redis.values  # released


async def test_ee007_fails_cleanly_when_the_report_never_finishes(org):
    await _insert(org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=1, synced=0)
    revision = _revision()
    redis = _FakeRedis()
    redis.values[revision.report_lock_key()] = "the-report"
    now = [0.0]

    def sleep(seconds):
        now[0] += seconds

    before = await _meters(org.id)
    with pytest.raises(revision.ReportLockBusy):
        await _autocommit_run(
            [org.id], lock=_lock(redis, sleep=sleep, clock=lambda: now[0])
        )
    assert await _meters(org.id) == before
    assert redis.values[revision.report_lock_key()] == "the-report"


def test_no_report_starts_during_ee007():
    # ee007 holds exactly the key the report endpoint takes, so `report_usage` answers its
    # existing "skipped" result while the re-key runs.
    from pathlib import Path

    from oss.src.utils.caching import _pack

    assert _revision().report_lock_key() == _pack(
        namespace="lock:meters:report", key={}
    )
    router = (
        Path(__file__).resolve().parents[4] / "src/apis/fastapi/billing/router.py"
    ).read_text()
    assert 'namespace="meters:report",\n                key={},' in router


async def _dumped(org_id):
    return [m for m in await MetersDAO().dump() if m.organization_id == org_id]


async def test_bump_ignores_a_recreated_source_id(org):
    old_id = await _insert(
        org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=40, synced=30
    )
    (dumped,) = await _dumped(org.id)
    assert dumped.meter_id == old_id
    await _autocommit_run([org.id], lock=_lock())
    # A step-1 pod recreates the old id.
    await execute(
        _STEP1_ADJUST_SQL,
        {
            "id": old_id,
            "o": org.id,
            "w": org.ws,
            "p": org.prj,
            "u": org.usr,
            "delta": 1,
        },
    )
    read = {dumped.meter_id: dumped.synced}
    dumped.synced = dumped.value  # the stale report sets synced = 40
    await MetersDAO().bump(meters=[dumped], synced_read=read)
    rows = await _meters(org.id)
    assert (rows[old_id]["value"], rows[old_id]["synced"]) == (1, 0)
    new_id = _id(org=org.id, prj=org.prj, usr=org.usr)
    assert (rows[new_id]["value"], rows[new_id]["synced"]) == (40, 30)


async def test_bump_ignores_a_folded_destination(org):
    new_id = await _insert(
        org=org.id, wrk=None, prj=org.prj, usr=org.usr, value=2, synced=0
    )
    (dumped,) = await _dumped(org.id)
    await _insert(org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=40, synced=30)
    await _autocommit_run([org.id], lock=_lock())
    read = {dumped.meter_id: dumped.synced}
    dumped.synced = dumped.value  # stale: synced = 2
    await MetersDAO().bump(meters=[dumped], synced_read=read)
    rows = await _meters(org.id)
    assert (rows[new_id]["value"], rows[new_id]["synced"]) == (42, 30)


class _OrgDAO(MetersDAO):
    def __init__(self, organization_id):
        super().__init__()
        self._organization_id = organization_id

    async def dump(self, limit=None):
        rows = [
            m
            for m in await super().dump()
            if m.organization_id == self._organization_id
        ]
        return rows[:limit] if limit else rows


class _Stripe:
    def __init__(self):
        self.events = []

        class _MeterEvent:
            @staticmethod
            def create(**kwargs):
                self.events.append(kwargs)

        self.billing = SimpleNamespace(MeterEvent=_MeterEvent)
        self.error = SimpleNamespace(InvalidRequestError=type("E", (Exception,), {}))


async def _billed_org():
    seeded = await seed_organization(members={"m": "editor"})
    o = seeded.organization_id
    await execute(
        "INSERT INTO subscriptions (organization_id, plan, active, customer_id, "
        "subscription_id) VALUES (:o, 'cloud_v0_pro', true, 'cus_test', 'sub_test')",
        {"o": o},
    )
    await _insert(
        org=o, wrk=None, prj=None, usr=None, value=10, synced=4, key="TRACES_INGESTED"
    )
    for workspace, value in ((seeded.workspace_ids[0], 6), (uuid4(), 2)):
        await _insert(
            org=o,
            wrk=workspace,
            prj=seeded.project_ids[0],
            usr=seeded.user_ids["m"],
            value=value,
            synced=1,
        )
    return seeded


async def test_report_sends_the_same_stripe_deltas_after_the_rekey(monkeypatch):
    import ee.src.core.meters.service as service_module

    before, after = await _billed_org(), await _billed_org()
    try:
        await _autocommit_run([after.organization_id], lock=_lock())
        payloads = {}
        for seeded in (before, after):
            stripe = _Stripe()
            monkeypatch.setattr(service_module, "_load_stripe", lambda: stripe)
            await MetersService(meters_dao=_OrgDAO(seeded.organization_id)).report()
            payloads[seeded.organization_id] = [
                (e["event_name"], e["payload"], e["identifier"].split(":", 1)[1])
                for e in stripe.events
            ]
            rows = await _meters(seeded.organization_id)
            assert all(r["synced"] == r["value"] for r in rows.values())
        assert payloads[before.organization_id] == payloads[after.organization_id]
        assert payloads[before.organization_id] == [
            (
                "traces",
                {"delta": 6, "customer_id": "cus_test"},
                "traces_ingested:2026:10:4",
            )
        ]
    finally:
        await delete_seeded_organization(before)
        await delete_seeded_organization(after)


def test_counter_key_used_here_is_billed():
    assert Counter.TRACES_INGESTED.value == "traces_ingested"
    assert isinstance(_id(org=UUID(int=1)), UUID)


async def test_ee007_without_rows_takes_no_lock(org):
    class _NoRedis:
        def set(self, *args, **kwargs):
            raise AssertionError("no lock without rows to move")

    counts = await _autocommit_run([org.id], lock=_lock(_NoRedis()))
    assert counts == {"batches": 0, "rows": 0, "inserted_or_folded": 0}


async def test_ee007_refuses_a_billed_key_with_a_workspace(org):
    await _insert(org=org.id, wrk=org.ws, prj=org.prj, usr=org.usr, value=1, synced=0)
    await _insert(
        org=org.id,
        wrk=org.ws,
        prj=org.prj,
        usr=None,
        value=5,
        synced=0,
        key="TRACES_INGESTED",
    )
    before = await _meters(org.id)
    with pytest.raises(_revision().RekeyRefused, match="bills"):
        await _autocommit_run([org.id], lock=_lock())
    assert await _meters(org.id) == before
