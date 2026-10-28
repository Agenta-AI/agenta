"""Organization-only projects against a migrated Postgres.

Since workspace removal step 3 a project belongs to its organization only. These cases
pin the readers (the default project of an organization, the resolver rows that answer
the organization where a workspace was), the writers of the default flag, the
organization details and the statement and Redis counts of the Bearer branches.
"""

from uuid import UUID, uuid4

import pytest

import oss.src.services.db_manager as db_manager
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.utils.membership_seed import (
    SeededOrganization,
    delete_seeded_organization,
    execute,
    fetch_all,
    seed_organization,
)
from oss.tests.pytest.utils.statements import count_statements


pytestmark = pytest.mark.integration


async def _organization_name(organization_id: UUID) -> str:
    rows = await fetch_all(
        "SELECT name FROM organizations WHERE id = :id", {"id": organization_id}
    )
    return rows[0]["name"]


async def _add_project(
    *,
    organization_id: UUID,
    is_default,
    name: str = "extra",
) -> UUID:
    project_id = uuid4()
    await execute(
        "INSERT INTO projects (id, project_name, is_default, organization_id, "
        "created_at, updated_at) VALUES (:id, :name, :d, :o, clock_timestamp(), "
        "clock_timestamp())",
        {"id": project_id, "name": name, "d": is_default, "o": organization_id},
    )
    return project_id


def _dao() -> MembershipsDAO:
    return MembershipsDAO(engine=get_transactions_engine())


# --- resolver readers ------------------------------------------------------- #


async def test_resolver_lists_a_project_of_the_organization():
    seeded = await seed_organization(members={"owner": "owner"})
    try:
        name = await _organization_name(seeded.organization_id)
        engine = get_transactions_engine()
        with count_statements(engine) as fetched:
            row = await _dao().fetch_membership_row(
                user_id=seeded.owner_id, project_id=seeded.project_ids[0]
            )
        with count_statements(engine) as listed:
            rows = await _dao().list_membership_rows(user_id=seeded.owner_id)

        assert row is not None
        assert row.summary.workspace_id == seeded.organization_id
        assert row.summary.workspace_name == name
        assert len(fetched) == 1
        mine = [r for r in rows if r.summary.organization_id == seeded.organization_id]
        assert [r.summary.project_id for r in mine] == [seeded.project_ids[0]]
        assert mine[0].summary.workspace_id == seeded.organization_id
        assert mine[0].summary.workspace_name == name
        assert len(listed) == 1

        projects = await _dao().list_projects(organization_ids=[seeded.organization_id])
        assert [project.workspace_id for project in projects] == [
            seeded.organization_id
        ]
    finally:
        await delete_seeded_organization(seeded)


async def test_resolver_rows_answer_the_organization():
    seeded = await seed_organization(members={"m": "editor"}, projects=2)
    try:
        for org, user_id in ((seeded, seeded.user_ids["m"]),):
            # Step 2 (design D6): every project answers its organization's id and name.
            expected = {
                row["id"]: (row["organization_id"], row["name"])
                for row in await fetch_all(
                    "SELECT p.id, p.organization_id, o.name FROM projects p "
                    "JOIN organizations o ON o.id = p.organization_id "
                    "WHERE p.organization_id = :o",
                    {"o": org.organization_id},
                )
            }
            for project_id, (workspace_id, workspace_name) in expected.items():
                row = await _dao().fetch_membership_row(
                    user_id=user_id, project_id=project_id
                )
                assert row.summary.workspace_id == workspace_id
                assert row.summary.workspace_name == workspace_name
            listed = {
                r.summary.project_id: (r.summary.workspace_id, r.summary.workspace_name)
                for r in await _dao().list_membership_rows(user_id=user_id)
                if r.summary.organization_id == org.organization_id
            }
            assert listed == expected
    finally:
        await delete_seeded_organization(seeded)


# --- default project of a workspace or organization ------------------------- #


async def _multi_project_organization() -> SeededOrganization:
    """Three projects; the default is the second one, so it is not the oldest."""

    seeded = await seed_organization(members={"m": "editor"}, projects=3)
    await execute(
        "UPDATE projects SET is_default = (id = :d) WHERE organization_id = :o",
        {"d": seeded.project_ids[1], "o": seeded.organization_id},
    )
    return seeded


async def test_fetch_default_project_by_organization_id():
    seeded = await _multi_project_organization()
    try:
        ref = await db_manager.fetch_default_project(
            organization_id=str(seeded.organization_id)
        )
        assert ref.project_id == seeded.project_ids[1]
        assert ref.project_organization_id == seeded.organization_id
    finally:
        await delete_seeded_organization(seeded)


async def test_fetch_default_project_of_a_single_project_organization():
    seeded = await seed_organization(members={"owner": "owner"})
    try:
        ref = await db_manager.fetch_default_project(
            organization_id=str(seeded.organization_id)
        )
        assert ref.project_id == seeded.project_ids[0]
        assert ref.project_organization_id == seeded.organization_id
    finally:
        await delete_seeded_organization(seeded)


async def test_fetch_default_project_of_an_unknown_id():
    assert await db_manager.fetch_default_project(organization_id=str(uuid4())) is None


async def test_fetch_default_project_picks_the_oldest_when_two_remain():
    seeded = await seed_organization(members={"m": "editor"}, projects=2)
    try:
        await execute(
            "UPDATE projects SET is_default = true WHERE organization_id = :o",
            {"o": seeded.organization_id},
        )
        # Two defaults: the oldest answers.
        ref = await db_manager.fetch_default_project(
            organization_id=str(seeded.organization_id)
        )
        oldest = await fetch_all(
            "SELECT id FROM projects WHERE organization_id = :o AND is_default IS TRUE "
            "ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1",
            {"o": seeded.organization_id},
        )
        assert ref.project_id == oldest[0]["id"]
    finally:
        await delete_seeded_organization(seeded)


async def test_fetch_default_project_is_one_statement():
    seeded = await _multi_project_organization()
    try:
        engine = get_transactions_engine()
        for ref in (seeded.organization_id, uuid4()):
            await db_manager.fetch_default_project(organization_id=str(ref))
            with count_statements(engine) as statements:
                await db_manager.fetch_default_project(organization_id=str(ref))
            assert len(statements) == 1, statements
    finally:
        await delete_seeded_organization(seeded)


async def test_get_default_project_id_from_workspace_keeps_its_contract():
    seeded = await _multi_project_organization()
    try:
        assert await db_manager.get_default_project_id_from_workspace(
            workspace_id=str(seeded.organization_id)
        ) == str(seeded.project_ids[1])
        for unknown in (uuid4(),):
            with pytest.raises(db_manager.NoResultFound):
                await db_manager.get_default_project_id_from_workspace(
                    workspace_id=str(unknown)
                )
    finally:
        await delete_seeded_organization(seeded)


# --- get_project_by_workspace ----------------------------------------------- #


async def test_get_project_by_workspace_accepts_the_organization_id():
    seeded = await _multi_project_organization()
    no_workspaces = await seed_organization(members={"owner": "owner"})
    try:
        project = await db_manager.get_project_by_workspace(
            workspace_id=str(seeded.organization_id)
        )
        assert project.id == seeded.project_ids[1]
        project = await db_manager.get_project_by_workspace(
            workspace_id=str(no_workspaces.organization_id)
        )
        assert project.id == no_workspaces.project_ids[0]
        # An unknown id names no organization.
        for unknown in (uuid4(),):
            with pytest.raises(db_manager.NoResultFound):
                await db_manager.get_project_by_workspace(workspace_id=str(unknown))
    finally:
        await delete_seeded_organization(seeded)
        await delete_seeded_organization(no_workspaces)


async def test_get_project_by_workspace_without_a_default_takes_the_oldest_project():
    seeded = await seed_organization(members={"m": "editor"}, projects=2)
    try:
        await execute(
            "UPDATE projects SET is_default = false WHERE organization_id = :o",
            {"o": seeded.organization_id},
        )
        project = await db_manager.get_project_by_workspace(
            workspace_id=str(seeded.organization_id)
        )
        oldest = await fetch_all(
            "SELECT id FROM projects WHERE organization_id = :o "
            "ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1",
            {"o": seeded.organization_id},
        )
        assert project.id == oldest[0]["id"]
    finally:
        await delete_seeded_organization(seeded)


async def test_get_project_by_workspace_prefers_the_default_over_a_null_default():
    seeded = await seed_organization(members={"m": "editor"})
    try:
        await _add_project(
            organization_id=seeded.organization_id,
            is_default=None,
            name="null-default",
        )
        project = await db_manager.get_project_by_workspace(
            workspace_id=str(seeded.organization_id)
        )
        # `is_default IS TRUE` first: a NULL flag never wins.
        assert project.id == seeded.project_ids[0]
    finally:
        await delete_seeded_organization(seeded)


async def test_both_default_helpers_agree_on_the_organization():
    seeded = await _multi_project_organization()
    try:
        by_route = await db_manager.get_project_by_workspace(
            workspace_id=str(seeded.organization_id)
        )
        by_bearer = await db_manager.fetch_default_project(
            organization_id=str(seeded.organization_id)
        )
        assert by_route.id == seeded.project_ids[1]
        assert by_bearer.project_id == seeded.project_ids[1]
        assert by_route.organization_id == seeded.organization_id
        assert by_bearer.project_organization_id == seeded.organization_id
    finally:
        await delete_seeded_organization(seeded)


# --- writers ---------------------------------------------------------------- #


async def test_create_project_keeps_one_default():
    seeded = await seed_organization(members={"owner": "owner"})
    try:
        created = await _dao().create_project(
            organization_id=seeded.organization_id,
            name="no-workspace",
            is_default=False,
        )
        rows = await fetch_all(
            "SELECT is_default FROM projects WHERE id = :p",
            {"p": created.scope.project_id},
        )
        assert rows[0]["is_default"] is False  # the organization has a default
        assert created.scope.workspace_id == seeded.organization_id

        made_default = await _dao().create_project(
            organization_id=seeded.organization_id,
            name="no-workspace-default",
            is_default=True,
        )
        defaults = await fetch_all(
            "SELECT id FROM projects WHERE organization_id = :o AND is_default IS TRUE",
            {"o": seeded.organization_id},
        )
        assert [row["id"] for row in defaults] == [made_default.scope.project_id]
    finally:
        await delete_seeded_organization(seeded)


async def test_set_default_project_clears_every_default_of_its_organization():
    seeded = await seed_organization(members={"m": "editor"}, projects=2)
    try:
        no_workspace = await _add_project(
            organization_id=seeded.organization_id, is_default=False
        )
        await db_manager.set_default_project(project_id=str(no_workspace))
        defaults = await fetch_all(
            "SELECT id FROM projects WHERE organization_id = :o AND is_default IS TRUE",
            {"o": seeded.organization_id},
        )
        assert [row["id"] for row in defaults] == [no_workspace]
    finally:
        await delete_seeded_organization(seeded)


async def test_default_writes_keep_one_default():
    seeded = await _multi_project_organization()
    try:
        await execute(
            "UPDATE projects SET is_default = false WHERE id = :p",
            {"p": seeded.project_ids[2]},
        )
        # (1) Step 2: a project created as default clears every other default of the
        # organization (no second default).
        created = await _dao().create_project(
            organization_id=seeded.organization_id,
            name="step2-default",
            is_default=True,
        )
        ref = await db_manager.fetch_default_project(
            organization_id=str(seeded.organization_id)
        )
        assert ref.project_id == created.scope.project_id
        # (2) Another project becomes the only default.
        step2 = await _add_project(
            organization_id=seeded.organization_id, is_default=False
        )
        await db_manager.set_default_project(project_id=str(step2))
        ref = await db_manager.fetch_default_project(
            organization_id=str(seeded.organization_id)
        )
        assert ref.project_id == step2
        listed = await _dao().list_projects(organization_ids=[seeded.organization_id])
        ids = [p.project_id for p in listed]
        assert len(ids) == len(set(ids))
        by_id = {project.project_id: project.workspace_id for project in listed}
        assert by_id[step2] == seeded.organization_id
        assert by_id[seeded.project_ids[0]] == seeded.organization_id
    finally:
        await delete_seeded_organization(seeded)


# --- workspace list items ---------------------------------------------------- #


async def test_org_details_answer_the_organization():
    seeded = await seed_organization(members={"owner": "owner", "m": "viewer"})
    try:
        organization = await db_manager.get_organization(str(seeded.organization_id))
        details = await db_manager.get_org_details(organization)
        assert details["workspaces"] == [str(seeded.organization_id)]
        default = details["default_workspace"]
        assert default["id"] == str(seeded.organization_id)
        assert default["name"] == organization.name
        assert default["organization"] == str(seeded.organization_id)
        assert default["created_at"] == str(organization.created_at)
        assert default["updated_at"] == str(organization.updated_at)
        members = {m["user"]["id"] for m in default["members"]}
        assert members == {str(u) for u in seeded.user_ids.values()}
    finally:
        await delete_seeded_organization(seeded)


async def test_oldest_organization_of_a_user():
    seeded = await seed_organization(members={"owner": "owner"})
    try:
        assert await db_manager.fetch_oldest_organization_id(
            user_id=str(seeded.owner_id)
        ) == str(seeded.organization_id)
        assert (
            await db_manager.fetch_oldest_organization_id(user_id=str(uuid4())) is None
        )
    finally:
        await delete_seeded_organization(seeded)


# --- deletes ----------------------------------------------------------------- #


async def _project_exists(project_id: UUID) -> bool:
    return bool(
        await fetch_all("SELECT 1 FROM projects WHERE id = :p", {"p": project_id})
    )


# --- whole-request counts ----------------------------------------------------- #
#
# One `verify_bearer_token` call with a fake SuperTokens session and the real readers,
# resolver, caching and Redis (a throwaway Redis: REDIS_URI_VOLATILE); skipped when Redis
# is unreachable.


from types import SimpleNamespace as _NS  # noqa: E402

from starlette.requests import Request as _Request  # noqa: E402

import oss.src.core.memberships.service as _memberships_module  # noqa: E402
from oss.src.core.memberships.dtos import MembershipPolicy as _Policy  # noqa: E402
from oss.src.core.memberships.service import MembershipsService as _Service  # noqa: E402
from oss.src.middlewares import auth as _auth  # noqa: E402
from oss.src.utils import caching as _caching  # noqa: E402
from oss.tests.pytest.utils.redis_calls import count_redis_calls  # noqa: E402

_BEFORE_SQL = {
    "project+workspace": {"cold": 3, "partly_warm": 2},
    "project+organization": {"cold": 3, "partly_warm": 2},  # today: refused after 2-3
    "workspace": {"cold": 3, "partly_warm": 3},
    "none": {"cold": 3, "partly_warm": 3},
}

POLICIES = [_Policy.ORGANIZATION_WIDE, _Policy.PROJECT_ROWS]


async def _redis_reachable() -> bool:
    # The cache client binds to the event loop it was created in; each test has its own.
    _caching.get_cache_engine()._r = None
    try:
        await _caching.get_cache_engine()._client().ping()
        return True
    except Exception:  # pylint: disable=broad-exception-caught
        return False


def _bearer_request() -> _Request:
    return _Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/projects/",
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )


@pytest.fixture
async def bearer_world(monkeypatch, request):
    if not await _redis_reachable():
        pytest.skip(
            "Redis is unreachable (set REDIS_URI_VOLATILE to a throwaway Redis)"
        )
    policy = request.param
    # No random early "leak" on a cache miss: every miss takes the same Redis path, so
    # the Redis counts below are exact.
    monkeypatch.setattr(_caching, "random", lambda: 0.99)
    seeded = await seed_organization(members={"m": "editor"}, projects=2)
    user = seeded.user_ids["m"]
    service = _Service(memberships_dao=_dao(), policy=policy)
    monkeypatch.setattr(_memberships_module, "_memberships_service", service)

    email = (await fetch_all("SELECT email FROM users WHERE id = :u", {"u": user}))[0][
        "email"
    ]

    async def _session(request):
        return _NS(get_user_id=lambda: f"st-{user.hex}")

    async def _supertokens_user(*, user_id):
        return _NS(emails=[email])

    monkeypatch.setattr(_auth, "get_session", _session)
    monkeypatch.setattr(_auth, "get_supertokens_user_by_id", _supertokens_user)
    yield seeded, user
    await _flush(user, ("*",))
    await delete_seeded_organization(seeded)


async def _flush(user, namespaces):
    client = _caching.get_cache_engine()._client()
    for namespace in namespaces:
        async for name in client.scan_iter(
            match=f"cache:p:*:u:{str(user)[-12:]}:{namespace}:*"
        ):
            await client.delete(name)


async def _flush_organization_names(project_ids):
    # Only this test's projects: tests in other workers share the Redis.
    client = _caching.get_cache_engine()._client()
    for project_id in project_ids:
        async for name in client.scan_iter(
            match=f"cache:p:{str(project_id)[-12:]}:*get_organization_name*"
        ):
            await client.delete(name)


async def _measure(user, *, project_id=None, workspace_id=None, project_ids=()):
    out = {}
    for state, namespaces in (
        ("fully_cold", ("*",)),
        ("cold", ("verify_bearer_token", "resolve_membership")),
        ("partly_warm", ("verify_bearer_token",)),
        ("warm", ()),
    ):
        # prime: the organization name and the resolver entry exist after this
        await _auth.verify_bearer_token(
            request=_bearer_request(),
            bearer_token="t",
            query_project_id=str(project_id) if project_id else None,
            query_workspace_id=str(workspace_id) if workspace_id else None,
        )
        await _flush(user, namespaces)
        if state == "fully_cold":
            await _flush_organization_names(project_ids)
        with (
            count_statements(get_transactions_engine()) as sql,
            count_redis_calls() as redis,
        ):
            await _auth.verify_bearer_token(
                request=_bearer_request(),
                bearer_token="t",
                query_project_id=str(project_id) if project_id else None,
                query_workspace_id=str(workspace_id) if workspace_id else None,
            )
        out[state] = {
            "sql": len(sql),
            "redis": [call.command for call in redis],
            "redis_keys": [call.key for call in redis],
        }
    return out


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_bearer_project_and_organization_id_counts(bearer_world):
    seeded, user = bearer_world
    project_id = seeded.project_ids[0]
    # Step 2b: a legacy workspace id is refused; the organization id is the only form.
    for name, workspace_id in (("project+organization", seeded.organization_id),):
        counts = await _measure(user, project_id=project_id, workspace_id=workspace_id)
        assert counts["cold"]["sql"] == 2, (name, counts)
        assert counts["partly_warm"]["sql"] == 1, (name, counts)
        assert counts["warm"]["sql"] == 0, (name, counts)
        assert counts["cold"]["sql"] <= _BEFORE_SQL[name]["cold"]
        assert counts["partly_warm"]["sql"] <= _BEFORE_SQL[name]["partly_warm"]


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_bearer_workspace_only_counts(bearer_world):
    seeded, user = bearer_world
    for workspace_id in (seeded.organization_id,):
        counts = await _measure(user, workspace_id=workspace_id)
        assert counts["cold"]["sql"] == 2, counts
        assert counts["partly_warm"]["sql"] == 2, counts
        assert counts["warm"]["sql"] == 0, counts
        # no resolve_membership key is read or written on this branch
        for state in counts.values():
            assert not [k for k in state["redis_keys"] if "resolve_membership" in k]


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_bearer_without_parameters_counts(bearer_world):
    seeded, user = bearer_world
    counts = await _measure(user)
    # the oldest organization, its default project and the resolver read, today's 3
    assert counts["cold"]["sql"] == 3, counts
    assert counts["warm"]["sql"] == 0, counts
    assert counts["cold"]["sql"] <= _BEFORE_SQL["none"]["cold"]


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_bearer_warm_requests_send_the_same_redis_commands(bearer_world):
    seeded, user = bearer_world
    warm = [
        (await _measure(user, project_id=seeded.project_ids[0]))["warm"]["redis"],
        (
            await _measure(
                user,
                project_id=seeded.project_ids[0],
                workspace_id=seeded.organization_id,
            )
        )["warm"]["redis"],
        (await _measure(user, workspace_id=seeded.organization_id))["warm"]["redis"],
        (await _measure(user))["warm"]["redis"],
    ]
    assert all(w == warm[0] for w in warm), warm


async def test_project_list_stays_one_statement_with_a_project_without_workspace():
    seeded = await seed_organization(members={"owner": "owner"})
    try:
        await _add_project(organization_id=seeded.organization_id, is_default=False)
        engine = get_transactions_engine()
        with count_statements(engine) as statements:
            rows = await _dao().list_membership_rows(user_id=seeded.owner_id)
        assert len(statements) == 1
        assert (
            len(
                [r for r in rows if r.summary.organization_id == seeded.organization_id]
            )
            == 2
        )
    finally:
        await delete_seeded_organization(seeded)


# The whole Bearer request after step 1, per state: (SQL statements, Redis commands).
# Fully cold also misses the SuperTokens-user and organization-name entries. Today's SQL
# for the same requests (plan Task B3 table, fully cold adds the same 2 statements on both
# sides): project+workspace 5 / 3 / 2, workspace only 5 / 3 / 3, no parameters 5 / 3 / 3.
_AFTER = {
    "project+workspace": {
        "fully_cold": (4, 16),
        "cold": (2, 10),
        "partly_warm": (1, 7),
        "warm": (0, 2),
    },
    "project": {
        "fully_cold": (4, 16),
        "cold": (2, 10),
        "partly_warm": (1, 7),
        "warm": (0, 2),
    },
    "workspace": {
        "fully_cold": (4, 12),
        "cold": (2, 6),
        "partly_warm": (2, 6),
        "warm": (0, 2),
    },
    "none": {
        "fully_cold": (5, 12),
        "cold": (3, 6),
        "partly_warm": (3, 6),
        "warm": (0, 2),
    },
}
_TODAY_SQL = {
    "project+workspace": {"fully_cold": 5, "cold": 3, "partly_warm": 2, "warm": 0},
    "project": {"fully_cold": 4, "cold": 2, "partly_warm": 1, "warm": 0},
    "workspace": {"fully_cold": 5, "cold": 3, "partly_warm": 3, "warm": 0},
    "none": {"fully_cold": 5, "cold": 3, "partly_warm": 3, "warm": 0},
}


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_bearer_counts_per_branch_and_state(bearer_world):
    seeded, user = bearer_world
    ids = seeded.project_ids
    measured = {
        "project+workspace": await _measure(
            user,
            project_id=seeded.project_ids[0],
            workspace_id=seeded.organization_id,
            project_ids=ids,
        ),
        "project": await _measure(
            user, project_id=seeded.project_ids[0], project_ids=ids
        ),
        "workspace": await _measure(
            user, workspace_id=seeded.organization_id, project_ids=ids
        ),
        "none": await _measure(user, project_ids=ids),
    }
    for branch, states in measured.items():
        for state, value in states.items():
            sql, redis = _AFTER[branch][state]
            assert value["sql"] == sql, (branch, state, value)
            assert value["sql"] <= _TODAY_SQL[branch][state], (branch, state)
            # The cache keys and calls of every branch are today's (the workspace-only
            # key gains a version field only), so today's Redis count is this one.
            assert len(value["redis"]) == redis, (branch, state, value)
            if branch in ("workspace", "none"):
                assert not [k for k in value["redis_keys"] if "resolve_membership" in k]
    # warm: one Redis GET for the SuperTokens user and one for the Bearer state, everywhere
    assert {tuple(states["warm"]["redis"]) for states in measured.values()} == {
        ("GET", "GET")
    }


_APIKEY_COLD_REDIS = 4  # GET miss, lock SET, state SET, lock DEL (as today)


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_apikey_counts_are_unchanged(bearer_world):
    from oss.src.services import api_key_service

    seeded, user = bearer_world
    raw_key = await api_key_service.create_api_key(
        user_id=str(user), project_id=str(seeded.project_ids[0])
    )
    client = _caching.get_cache_engine()._client()

    async def _call():
        request = _bearer_request()
        await _auth.verify_apikey_token(request=request, apikey_token=raw_key)
        return request.state

    await _call()
    counts = {}
    for state in ("cold", "warm"):
        if state == "cold":
            async for name in client.scan_iter(
                match=f"cache:p:*:verify_apikey_token:*{raw_key}*"
            ):
                await client.delete(name)
        with (
            count_statements(get_transactions_engine()) as sql,
            count_redis_calls() as redis,
        ):
            request_state = await _call()
        counts[state] = (len(sql), len(redis))
    # Today: the key read (with its creator) and the project read, no extra statement for
    # the legacy workspace id; warm: one Redis GET.
    assert counts["cold"][0] == 2, counts
    assert counts["cold"][1] == _APIKEY_COLD_REDIS, counts
    assert counts["warm"] == (0, 1), counts
    # Step 2: the organization id where the workspace id was.
    assert request_state.workspace_id == str(seeded.organization_id)


async def test_delete_paths_keep_their_statement_counts():
    engine = get_transactions_engine()
    seeded = await seed_organization(members={"m": "editor"}, projects=3)
    other = await seed_organization(members={"owner": "owner"})
    try:
        with count_statements(engine) as statements:
            await db_manager.admin_delete_organization(other.organization_id)
        assert len(statements) == 1, statements
        assert not await _project_exists(other.project_ids[0])
        with count_statements(engine) as statements:
            await db_manager.delete_organization(str(seeded.organization_id))
        assert len(statements) == 2, statements  # the read, then one delete
        assert not await _project_exists(seeded.project_ids[0])
    finally:
        await delete_seeded_organization(seeded)
        await delete_seeded_organization(other)


async def test_org_details_of_an_organization_without_projects():
    seeded = await seed_organization(members={"owner": "owner"})
    try:
        await execute(
            "DELETE FROM projects WHERE organization_id = :o",
            {"o": seeded.organization_id},
        )
        engine = get_transactions_engine()
        for demo in (False, True):
            await execute(
                "UPDATE organizations SET flags = CAST(:f AS jsonb) WHERE id = :o",
                {
                    "f": '{"is_demo": %s}' % ("true" if demo else "false"),
                    "o": seeded.organization_id,
                },
            )
            organization = await db_manager.get_organization(
                str(seeded.organization_id)
            )
            with count_statements(engine) as statements:
                details = await db_manager.get_org_details(organization)
            # Step 2 (design D6): the organization alias, with no members.
            assert details["default_workspace"]["id"] == str(seeded.organization_id), (
                demo
            )
            assert details["default_workspace"]["members"] == [], demo
            assert details["workspaces"] == [str(seeded.organization_id)], demo
            # Step 1: 3 statements; step 2: the one project read.
            assert len(statements) == 1, (demo, statements)
    finally:
        await delete_seeded_organization(seeded)


async def test_org_details_keep_their_statement_count():
    seeded = await seed_organization(members={"m": "editor"}, projects=2)
    try:
        organization = await db_manager.get_organization(str(seeded.organization_id))
        engine = get_transactions_engine()
        with count_statements(engine) as statements:
            details = await db_manager.get_org_details(organization)
        # Step 2 (design D6): the organization where the default workspace was.
        assert details["default_workspace"]["id"] == str(seeded.organization_id)
        assert details["workspaces"] == [str(seeded.organization_id)]
        # Step 1: 5 statements; step 2: project, invitations, members.
        assert len(statements) == 3, statements
    finally:
        await delete_seeded_organization(seeded)
