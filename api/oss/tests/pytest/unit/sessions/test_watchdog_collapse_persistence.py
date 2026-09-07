"""The watchdog's collapse must PERSIST against a real Postgres, in the same pass that
settles the command.

Finding 7 (run 2d, session 6721d762): the sweep logged the collapse, but the row still read
is_running true afterwards with no other writer. Cause: the collapse mutated ORM row objects
(`row.flags = ...`), but those objects had been detached from the task-scoped session by the
nested `engine.session()` calls the pass makes (the records lookup, the command settlement) --
each opens the SAME current-task-scoped session and closes it in its `finally`. A detached
object's mutation is tracked by no session, so `session.commit()` never emits the flags
UPDATE, while the command settle's Core UPDATE (stopping_turn_id) still lands. A unit test
with fakes cannot catch this: it needs the real async_scoped_session + close semantics, so
this test drives a real Postgres.

It replays the real pass end to end with the real DAOs on a FRESH, isolated database (created
per test on the same server, dropped after), so the global sweep sees only the seeded row and
nothing is polluted. It seeds one alive+running stream naming a turn, one pending Stop for it,
and a stale heartbeat; runs one real sweep pass; then reads the row back through a fresh
session and asserts the collapse persisted, the execution was settled lost, and the command
went obsolete/lost.

Only the SERVER in POSTGRES_URI_CORE is used. The database named in that URI is never written:
the fixture creates its own and drops it. Point it at any reachable core Postgres, for example
    cd api && POSTGRES_URI_CORE=postgresql+asyncpg://username:password@localhost:5432/agenta_oss_core \
        uv run --no-sync pytest oss/tests/pytest/unit/sessions/test_watchdog_collapse_persistence.py -q
"""

import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, urlunparse

import asyncpg
import pytest
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import create_async_engine

import oss.src.models.db_models  # noqa: F401  (register auth/org tables on Base)

# Register the session tables on the shared Base so create_all builds them.
from oss.src.dbs.postgres.sessions.streams.dbes import SessionStreamDBE  # noqa: F401
from oss.src.dbs.postgres.sessions.executions.dbes import SessionExecutionDBE  # noqa: F401
from oss.src.dbs.postgres.sessions.commands.dbes import SessionCommandDBE  # noqa: F401
from oss.src.dbs.postgres.sessions.records.dbes import RecordDBE  # noqa: F401
from oss.src.dbs.postgres.sessions.interactions.dbes import (  # noqa: F401
    SessionInteractionDBE,
)
from oss.src.dbs.postgres.shared.base import Base

from oss.src.core.sessions.streams.dtos import (
    SessionStreamEdit,
    SessionStreamFlags,
)
from oss.src.utils.env import env
from oss.src.dbs.postgres.shared.engine import TransactionsEngine
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
from oss.src.dbs.postgres.sessions.commands.dao import SessionCommandsDAO
from oss.src.dbs.postgres.sessions.executions.dao import SessionExecutionsDAO
from oss.src.dbs.postgres.sessions.interactions.dao import SessionInteractionsDAO
from oss.src.dbs.postgres.sessions.records.dao import RecordsDAO
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.sessions.commands.service import SessionCommandsService
from oss.src.core.sessions.records.service import RecordsService
from oss.src.dbs.http.sessions.control_delivery_direct import DirectControlDelivery
from oss.src.tasks.asyncio.sessions import orphan_sweep

pytestmark = pytest.mark.integration


@pytest.fixture
def anyio_backend():
    return "asyncio"


class _FakeLock:
    """In-memory Redis stand-in — the DB persistence is what this test is about."""

    def __init__(self):
        self._s = {}

    async def get(self, k):
        return self._s.get(k)

    async def set(self, k, v, nx=False, ex=None):
        if nx and k in self._s:
            return None
        self._s[k] = v
        return True

    async def delete(self, k):
        self._s.pop(k, None)
        return 1

    async def expire(self, k, ttl):
        return True

    async def eval(self, script, numkeys, *keys_and_args):
        def decode(value):
            return value.decode() if isinstance(value, bytes) else str(value)

        keys = [decode(value) for value in keys_and_args[:numkeys]]
        argv = [decode(value) for value in keys_and_args[numkeys:]]
        if "AGENTA_WATCHDOG_RELEASE_TURN" in script:
            alive, running, owner, superseded = keys
            expected_turn, expected_owner, _ttl = argv
            alive_value = decode(self._s[alive]) if alive in self._s else ""
            running_value = decode(self._s[running]) if running in self._s else ""
            owner_value = decode(self._s[owner]) if owner in self._s else ""
            released_alive = int(bool(expected_turn) and alive_value == expected_turn)
            released_running = int(
                bool(expected_turn) and running_value == expected_turn
            )
            if released_alive:
                self._s.pop(alive, None)
            if released_running:
                self._s.pop(running, None)
            foreign_turn = (alive_value and alive_value != expected_turn) or (
                running_value and running_value != expected_turn
            )
            released_owner = int(
                bool(expected_owner)
                and owner_value == expected_owner
                and not foreign_turn
            )
            if released_owner:
                self._s.pop(owner, None)
            if expected_turn:
                self._s[superseded] = b"1"
            return [released_alive, released_running, released_owner]

        k = keys[0]
        v = argv[0]
        cur = self._s.get(k)
        if isinstance(cur, bytes):
            cur = cur.decode()
        if len(argv) > 1:
            from oss.src.dbs.redis.sessions.contract import owner_replica_id

            if cur is None or owner_replica_id(cur) == owner_replica_id(v):
                self._s[k] = v.encode()
                return v.encode()
            return cur.encode() if cur else None
        if cur == v:
            self._s.pop(k, None)
            return 1
        return 0


async def _noop_publish(*, project_id, record_event):
    return False


def _admin_dsn() -> str:
    parsed = urlparse(env.postgres.uri_core)
    # asyncpg DSN (no +asyncpg driver tag), connect to the maintenance db.
    return urlunparse(("postgresql", parsed.netloc, "/postgres", "", "", ""))


def _sqlalchemy_url_for(db_name: str) -> str:
    parsed = urlparse(env.postgres.uri_core)
    return urlunparse(("postgresql+asyncpg", parsed.netloc, f"/{db_name}", "", "", ""))


@pytest.fixture
async def wd_engine(monkeypatch):
    """A TransactionsEngine bound to a fresh, isolated database with the full schema."""
    db_name = f"agenta_wd_rca_{uuid.uuid4().hex[:12]}"
    admin = await asyncpg.connect(dsn=_admin_dsn())
    await admin.execute(f'CREATE DATABASE "{db_name}"')
    await admin.close()

    seed = await asyncpg.connect(dsn=_admin_dsn().replace("/postgres", f"/{db_name}"))
    for ext in ("pgcrypto", "ltree"):
        await seed.execute(f'CREATE EXTENSION IF NOT EXISTS "{ext}"')
    await seed.close()

    # Only the tables this pass touches; the full metadata carries unrelated tables with
    # foreign keys to modules we do not import here.
    needed = [
        Base.metadata.tables[name]
        for name in (
            "users",
            "organizations",
            "workspaces",
            "projects",
            "session_streams",
            "session_executions",
            "session_commands",
            "records",
            "session_interactions",
        )
    ]
    schema_engine = create_async_engine(_sqlalchemy_url_for(db_name))
    async with schema_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=needed)
    await schema_engine.dispose()

    # Point the real TransactionsEngine at the fresh DB so its exact async_scoped_session +
    # close semantics (the trigger for the detach bug) are what runs.
    monkeypatch.setattr(env.postgres, "uri_core", _sqlalchemy_url_for(db_name))
    engine = TransactionsEngine()
    try:
        engine._wd_db_name = db_name
        yield engine
    finally:
        await engine.close()
        admin = await asyncpg.connect(dsn=_admin_dsn())
        await admin.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname=$1 AND pid<>pg_backend_pid()",
            db_name,
        )
        await admin.execute(f'DROP DATABASE IF EXISTS "{db_name}"')
        await admin.close()


async def _seed_tenant(s):
    """One user, organization, workspace and project. Returns the project id."""
    project_id = uuid.uuid4()
    uid, org, ws = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await s.execute(
        text("INSERT INTO users (id, uid, username, email) VALUES (:i,:u,:n,:e)"),
        {"i": uid, "u": str(uid), "n": "wd", "e": f"wd-{uid.hex[:8]}@e.com"},
    )
    await s.execute(
        text("INSERT INTO organizations (id, name, owner_id) VALUES (:i,:n,:o)"),
        {"i": org, "n": "wd", "o": uid},
    )
    await s.execute(
        text("INSERT INTO workspaces (id, name, organization_id) VALUES (:i,:n,:o)"),
        {"i": ws, "n": "wd", "o": org},
    )
    await s.execute(
        text(
            "INSERT INTO projects (id, project_name, organization_id, workspace_id) "
            "VALUES (:i,:n,:o,:w)"
        ),
        {"i": project_id, "n": "wd", "o": org, "w": ws},
    )
    return project_id


async def _seed_scenario(engine, *, session_id, turn_id):
    stale = datetime.now(timezone.utc) - timedelta(hours=1)
    async with engine.session() as s:
        project_id = await _seed_tenant(s)
        await s.execute(
            text(
                "INSERT INTO session_streams "
                "(id, project_id, session_id, turn_id, flags, stopping_turn_id, created_at, updated_at) "
                "VALUES (:i,:p,:s,:t, CAST(:f AS JSONB), :st, :c, :u)"
            ),
            {
                "i": uuid.uuid4(),
                "p": project_id,
                "s": session_id,
                "t": turn_id,
                "f": '{"is_alive": true, "is_running": true, "is_attached": false}',
                "st": turn_id,
                "c": stale,
                "u": stale,
            },
        )
        await s.execute(
            text(
                "INSERT INTO session_commands "
                "(id, project_id, session_id, kind, target_turn_id, state, claim_count, created_at) "
                "VALUES (:i,:p,:s,'cancel',:t,'pending',0,:c)"
            ),
            {
                "i": uuid.uuid4(),
                "p": project_id,
                "s": session_id,
                "t": turn_id,
                "c": stale,
            },
        )
        await s.commit()
    return project_id


async def _seed_lost_execution_scenario(engine, *, session_id, turn_id):
    """A row the ORPHAN query never returns, whose turn is owed an ending.

    The stream row beats normally (a fresh `updated_at`), so it is not stale and is not
    collapsed. Its turn is already settled `lost` with no ending written, which is what puts it
    in `newly_lost`: the branch that clears `is_running` and keeps `is_alive`.
    """
    fresh = datetime.now(timezone.utc)
    stale = fresh - timedelta(hours=1)
    async with engine.session() as s:
        project_id = await _seed_tenant(s)
        await s.execute(
            text(
                "INSERT INTO session_streams "
                "(id, project_id, session_id, turn_id, flags, created_at, updated_at) "
                "VALUES (:i,:p,:s,:t, CAST(:f AS JSONB), :c, :u)"
            ),
            {
                "i": uuid.uuid4(),
                "p": project_id,
                "s": session_id,
                "t": turn_id,
                "f": '{"is_alive": true, "is_running": true, "is_attached": true}',
                "c": fresh,
                "u": fresh,
            },
        )
        await s.execute(
            text(
                "INSERT INTO session_executions "
                "(project_id, session_id, execution_id, terminal_outcome, settled_by, settled_at) "
                "VALUES (:p,:s,:t,'lost','watchdog',:a)"
            ),
            {"p": project_id, "s": session_id, "t": turn_id, "a": stale},
        )
        await s.commit()
    return project_id


def _build_services(engine):
    lock = _FakeLock()
    streams_service = SessionStreamsService(
        streams_dao=SessionStreamsDAO(engine), lock_engine=lock
    )
    interactions_service = SessionInteractionsService(
        interactions_dao=SessionInteractionsDAO(engine)
    )
    executions_dao = SessionExecutionsDAO(engine)
    commands_service = SessionCommandsService(
        commands_dao=SessionCommandsDAO(engine),
        streams_service=streams_service,
        interactions_service=interactions_service,
        lock_engine=lock,
        delivery=DirectControlDelivery(),
        executions_dao=executions_dao,
    )
    records_service = RecordsService(RecordsDAO(engine), executions_dao)
    return lock, records_service, commands_service


@pytest.mark.anyio
async def test_a_lost_pass_persists_the_collapse_against_real_postgres(
    anyio_backend, wd_engine, monkeypatch
):
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)

    session_id = "wd-" + uuid.uuid4().hex[:12]
    turn_id = str(uuid.uuid4())
    await _seed_scenario(wd_engine, session_id=session_id, turn_id=turn_id)

    lock, records_service, commands_service = _build_services(wd_engine)
    await orphan_sweep.run_orphan_sweep(
        wd_engine,
        lock,
        records_service=records_service,
        watch_publisher=None,
        commands_service=commands_service,
        publish=_noop_publish,
    )

    # Read back through a FRESH session so the assertions see committed DB state, not any
    # in-memory ORM object the pass held.
    async with wd_engine.session() as s:
        flags, stopping = (
            await s.execute(
                text(
                    "SELECT flags, stopping_turn_id FROM session_streams WHERE session_id=:s"
                ),
                {"s": session_id},
            )
        ).one()
        ex = (
            await s.execute(
                text(
                    "SELECT terminal_outcome, settled_by FROM session_executions "
                    "WHERE session_id=:s AND execution_id=:t"
                ),
                {"s": session_id, "t": turn_id},
            )
        ).one_or_none()
        cmd = (
            await s.execute(
                text(
                    "SELECT state, outcome FROM session_commands "
                    "WHERE session_id=:s AND target_turn_id=:t"
                ),
                {"s": session_id, "t": turn_id},
            )
        ).one()

    # The collapse persisted: this is the finding-7 assertion.
    assert flags["is_alive"] is False
    assert flags["is_running"] is False
    assert stopping is None
    # The execution reached its durable terminal outcome, settled by the watchdog.
    assert ex is not None
    assert ex[0] == "lost"
    assert ex[1] == "watchdog"
    # The Stop command was settled, not left pending.
    assert cmd[0] == "obsolete"
    assert cmd[1] == "lost"


@pytest.mark.anyio
async def test_b_lost_turn_clear_persists_after_a_nested_session_close(
    anyio_backend, wd_engine, monkeypatch
):
    """The `newly_lost` is_running clear survives a nested session between load and write.

    Same failure mode as finding 7, one branch up. The owner lookup is patched to open an
    `engine.session()`, whose `finally` closes the shared task-scoped session before settlement
    and the lost-turn update. Core writes must still reopen that session and persist.

    This never failed in production: before the fix the write sat immediately after the load,
    with nothing nested in between. The test pins the property rather than a past bug. Make the
    write an ORM attribute assignment again and it fails on `is_running` still true.
    """
    monkeypatch.setattr(env.agenta.sessions, "durable_stop", True)

    session_id = "wd-" + uuid.uuid4().hex[:12]
    turn_id = str(uuid.uuid4())
    await _seed_lost_execution_scenario(
        wd_engine, session_id=session_id, turn_id=turn_id
    )

    real_get_owner_value = orphan_sweep.get_owner_value
    nested_sessions = []

    async def _get_owner_value_through_a_nested_session(*args, **kwargs):
        # Open and close the shared task-scoped session, exactly as a DAO call would.
        async with wd_engine.session():
            nested_sessions.append(1)
        return await real_get_owner_value(*args, **kwargs)

    monkeypatch.setattr(
        orphan_sweep,
        "get_owner_value",
        _get_owner_value_through_a_nested_session,
    )

    lock, records_service, commands_service = _build_services(wd_engine)
    await orphan_sweep.run_orphan_sweep(
        wd_engine,
        lock,
        records_service=records_service,
        watch_publisher=None,
        commands_service=commands_service,
        publish=_noop_publish,
    )

    # The pass must actually have reached the branch under test.
    assert nested_sessions, "the lost-turn branch never ran, so nothing was proven"

    async with wd_engine.session() as s:
        flags = (
            await s.execute(
                text("SELECT flags FROM session_streams WHERE session_id=:s"),
                {"s": session_id},
            )
        ).scalar_one()

    # is_running cleared and PERSISTED; is_alive kept, so the session stays resumable.
    assert flags["is_running"] is False
    assert flags["is_alive"] is True


@pytest.mark.anyio
async def test_c_heartbeat_blocked_on_sweep_cannot_revive_collapsed_row(
    anyio_backend, wd_engine
):
    """A heartbeat whose UPDATE snapshot predates the sweep commit must lose its CAS."""
    session_id = "wd-" + uuid.uuid4().hex[:12]
    turn_id = str(uuid.uuid4())
    project_id = await _seed_scenario(wd_engine, session_id=session_id, turn_id=turn_id)

    parsed = urlparse(env.postgres.uri_core)
    dsn = urlunparse(
        ("postgresql", parsed.netloc, f"/{wd_engine._wd_db_name}", "", "", "")
    )
    sweep = await asyncpg.connect(dsn=dsn)
    observer = await asyncpg.connect(dsn=dsn)
    sweep_transaction = sweep.transaction()
    heartbeat = None
    committed = False
    heartbeat_rowcounts = []

    def capture_heartbeat_rowcount(
        _connection,
        clauseelement,
        _multiparams,
        _params,
        _execution_options,
        result,
    ):
        if getattr(clauseelement, "is_update", False):
            table = getattr(clauseelement, "table", None)
            if table is not None and table.name == "session_streams":
                heartbeat_rowcounts.append(result.rowcount)

    event.listen(
        wd_engine._engine.sync_engine, "after_execute", capture_heartbeat_rowcount
    )
    try:
        await sweep_transaction.start()
        await sweep.execute(
            "UPDATE session_streams "
            "SET flags=$1::jsonb, updated_at=NOW() "
            "WHERE project_id=$2 AND session_id=$3",
            '{"is_alive": false, "is_running": false, "is_attached": false}',
            project_id,
            session_id,
        )
        await sweep.execute(
            "INSERT INTO session_executions "
            "(project_id, session_id, execution_id, terminal_outcome, settled_by, settled_at) "
            "VALUES ($1,$2,$3,'lost','watchdog',NOW())",
            project_id,
            session_id,
            turn_id,
        )

        heartbeat = asyncio.create_task(
            SessionStreamsDAO(wd_engine).update(
                project_id=project_id,
                user_id=None,
                session_id=session_id,
                stream=SessionStreamEdit(
                    flags=SessionStreamFlags(
                        is_alive=True, is_running=True, is_attached=False
                    ),
                    turn_id=turn_id,
                    expected_turn_id=turn_id,
                ),
            )
        )

        async def heartbeat_is_blocked_on_the_sweep():
            while True:
                blocked = await observer.fetchval(
                    "SELECT EXISTS ("
                    "SELECT 1 FROM pg_stat_activity "
                    "WHERE datname=current_database() "
                    "AND wait_event_type='Lock' "
                    "AND query LIKE 'UPDATE session_streams%')"
                )
                if blocked:
                    return
                await asyncio.sleep(0.01)

        await asyncio.wait_for(heartbeat_is_blocked_on_the_sweep(), timeout=5)
        await sweep_transaction.commit()
        committed = True
        heartbeat_result = await asyncio.wait_for(heartbeat, timeout=5)
    finally:
        event.remove(
            wd_engine._engine.sync_engine, "after_execute", capture_heartbeat_rowcount
        )
        if heartbeat is not None and not heartbeat.done():
            heartbeat.cancel()
            await asyncio.gather(heartbeat, return_exceptions=True)
        if not committed:
            await sweep_transaction.rollback()
        await observer.close()
        await sweep.close()

    assert heartbeat_result is None
    assert heartbeat_rowcounts == [0]

    async with wd_engine.session() as s:
        flags, outcome = (
            await s.execute(
                text(
                    "SELECT ss.flags, se.terminal_outcome "
                    "FROM session_streams ss JOIN session_executions se "
                    "ON se.project_id=ss.project_id AND se.session_id=ss.session_id "
                    "AND se.execution_id=ss.turn_id WHERE ss.session_id=:s"
                ),
                {"s": session_id},
            )
        ).one()

    assert outcome == "lost"
    assert flags == {
        "is_alive": False,
        "is_running": False,
        "is_attached": False,
    }
