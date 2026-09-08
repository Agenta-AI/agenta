"""Two real transactions racing to rename one session.

The unit tests pin the rule and the mapper. Neither can show that the guard actually holds
against a concurrent write, because that property lives in Postgres: the guard reads and the
write commits inside one transaction that has locked the row with `FOR UPDATE`, so a person's
rename either lands entirely before the automatic edit reads, or waits behind it.

This is the test that fails if someone moves the check back up into the service.
"""

import asyncio
import uuid

import pytest
from sqlalchemy import text

from oss.src.core.sessions.streams.dtos import (
    SessionNameSource,
    SessionStreamCreate,
    SessionStreamHeaderEdit,
)
from oss.src.core.sessions.streams.types import SessionNameProtected
from oss.src.dbs.postgres.sessions.streams.dao import SessionStreamsDAO
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
import oss.src.models.db_models  # noqa: F401


pytestmark = pytest.mark.integration

_PERSON_NAME = "QA-6657 parked rename"
_AGENT_NAME = "Permission test"


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    # Dispose before dropping the reference, or the previous engine's pooled connections leak.
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def rename_scope():
    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project_id = uuid.uuid4()

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "rename-guard-test",
                "email": f"rename-guard-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {
                "id": organization_id,
                "name": "rename-guard-test-org",
                "owner_id": user_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "rename-guard-test-workspace",
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :project_name, :workspace_id, :organization_id)"
            ),
            {
                "id": project_id,
                "project_name": "rename-guard-test-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )
        await session.commit()

    yield {"engine": engine, "project_id": project_id, "user_id": user_id}


async def _seed(scope, *, name=None, name_source=None) -> tuple[SessionStreamsDAO, str]:
    dao = SessionStreamsDAO(engine=scope["engine"])
    session_id = str(uuid.uuid4())
    await dao.create(
        project_id=scope["project_id"],
        user_id=scope["user_id"],
        stream=SessionStreamCreate(
            session_id=session_id,
            name=name,
            name_source=name_source,
        ),
    )
    return dao, session_id


async def _rename(dao, scope, session_id, *, name, name_source, replacing=None):
    return await dao.update_header(
        project_id=scope["project_id"],
        user_id=scope["user_id"],
        session_id=session_id,
        header=SessionStreamHeaderEdit(name=name, replacing_name=replacing),
        name_source=name_source,
    )


async def _stored(dao, scope, session_id):
    return await dao.get_by_session_id(
        project_id=scope["project_id"], session_id=session_id
    )


async def test_a_rename_that_commits_mid_flight_is_not_overwritten(rename_scope):
    """The interleave, made deterministic by holding the row's lock.

    A person's rename is in flight, uncommitted, when the agent's deferred call arrives. The
    automatic write must not read the pre-rename row, decide it is safe, and then commit over
    a name that landed in between. `FOR UPDATE` is what stops it: the automatic transaction
    blocks on the row until the person's commits, then reads their name and refuses.

    Remove `.with_for_update()` from `update_header` and this test fails at the first
    assertion: the write sails past the held lock and replaces the person's name.
    """
    dao, session_id = await _seed(rename_scope, name="auto title")
    engine = rename_scope["engine"]

    async with engine.session() as holder:
        # The person's rename, begun and holding the row, not yet committed.
        await holder.execute(
            text(
                "SELECT id FROM session_streams"
                " WHERE project_id = :project_id AND session_id = :session_id"
                " FOR UPDATE"
            ),
            {"project_id": rename_scope["project_id"], "session_id": session_id},
        )

        agent = asyncio.create_task(
            _rename(
                dao,
                rename_scope,
                session_id,
                name=_AGENT_NAME,
                name_source=SessionNameSource.automatic,
            )
        )
        done, _pending = await asyncio.wait({agent}, timeout=2.0)
        assert not done, "the automatic write did not wait for the row's lock"

        await holder.execute(
            text(
                "UPDATE session_streams SET name = :name,"
                " tags = jsonb_build_object('ag.name.source', 'manual')"
                " WHERE project_id = :project_id AND session_id = :session_id"
            ),
            {
                "name": _PERSON_NAME,
                "project_id": rename_scope["project_id"],
                "session_id": session_id,
            },
        )
        await holder.commit()

    with pytest.raises(SessionNameProtected) as raised:
        await agent

    assert raised.value.current_name == _PERSON_NAME
    stored = await _stored(dao, rename_scope, session_id)
    assert stored.name == _PERSON_NAME


async def test_an_automatic_rename_over_a_stored_person_name_is_refused(rename_scope):
    dao, session_id = await _seed(
        rename_scope, name=_PERSON_NAME, name_source=SessionNameSource.manual
    )

    with pytest.raises(SessionNameProtected) as raised:
        await _rename(
            dao,
            rename_scope,
            session_id,
            name=_AGENT_NAME,
            name_source=SessionNameSource.automatic,
        )

    assert raised.value.current_name == _PERSON_NAME
    stored = await _stored(dao, rename_scope, session_id)
    assert stored.name == _PERSON_NAME


async def test_repeating_the_person_name_keeps_the_row_protected(rename_scope):
    # The transition an earlier draft got wrong. The agent echoes the stored name, which is
    # allowed, and the row must come out of that write no less protected than it went in.
    dao, session_id = await _seed(
        rename_scope, name=_PERSON_NAME, name_source=SessionNameSource.manual
    )

    await _rename(
        dao,
        rename_scope,
        session_id,
        name=_PERSON_NAME,
        name_source=SessionNameSource.automatic,
    )

    with pytest.raises(SessionNameProtected):
        await _rename(
            dao,
            rename_scope,
            session_id,
            name=_AGENT_NAME,
            name_source=SessionNameSource.automatic,
        )
    stored = await _stored(dao, rename_scope, session_id)
    assert stored.name == _PERSON_NAME


async def test_a_rename_the_person_asked_for_lands_and_stays_protected(rename_scope):
    dao, session_id = await _seed(
        rename_scope, name=_PERSON_NAME, name_source=SessionNameSource.manual
    )

    await _rename(
        dao,
        rename_scope,
        session_id,
        name="A name the person asked for",
        name_source=SessionNameSource.automatic,
        replacing=_PERSON_NAME,
    )

    stored = await _stored(dao, rename_scope, session_id)
    assert stored.name == "A name the person asked for"
    with pytest.raises(SessionNameProtected):
        await _rename(
            dao,
            rename_scope,
            session_id,
            name=_AGENT_NAME,
            name_source=SessionNameSource.automatic,
        )


async def test_a_stale_asked_for_rename_is_refused(rename_scope):
    # The person asked for a name while the session was called one thing, then renamed it
    # themselves. Running the old request now would undo the newer rename.
    dao, session_id = await _seed(
        rename_scope, name=_PERSON_NAME, name_source=SessionNameSource.manual
    )
    await _rename(
        dao,
        rename_scope,
        session_id,
        name="A newer name",
        name_source=SessionNameSource.manual,
    )

    with pytest.raises(SessionNameProtected) as raised:
        await _rename(
            dao,
            rename_scope,
            session_id,
            name="A name the person asked for",
            name_source=SessionNameSource.automatic,
            replacing=_PERSON_NAME,
        )

    assert raised.value.code == "session_name_changed"
    stored = await _stored(dao, rename_scope, session_id)
    assert stored.name == "A newer name"


async def test_a_heartbeat_never_erases_the_stamp(rename_scope):
    # The stamp lives in the row's reserved tags. The flag-mirror write is the one other
    # writer that touches this row on every turn, and it must leave the tags alone.
    from oss.src.core.sessions.streams.dtos import SessionStreamEdit, SessionStreamFlags

    dao, session_id = await _seed(
        rename_scope, name=_PERSON_NAME, name_source=SessionNameSource.manual
    )

    await dao.update(
        project_id=rename_scope["project_id"],
        user_id=rename_scope["user_id"],
        session_id=session_id,
        stream=SessionStreamEdit(
            flags=SessionStreamFlags(is_alive=True, is_running=True),
            turn_id=str(uuid.uuid4()),
        ),
    )

    with pytest.raises(SessionNameProtected):
        await _rename(
            dao,
            rename_scope,
            session_id,
            name=_AGENT_NAME,
            name_source=SessionNameSource.automatic,
        )
