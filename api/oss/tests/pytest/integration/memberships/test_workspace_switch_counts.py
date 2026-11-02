"""Workspace removal step 2: statement, Redis and email counts on every request path it
touches, pinned against the step-1 numbers.

Bearer and API-key counts reuse the step-1 harness (`test_workspace_accept_postgres.py`:
a throwaway Redis through `REDIS_URI_VOLATILE`, `caching.random` pinned, four cache
states) and its pinned step-1 constants. Every count here is `<=` step 1 and `==` the
measured step-2 value. Request paths are measured through their router handlers with the same harness on both
versions; the step-1 numbers are pinned here (measured on the step-1 code against the same
database, see `AGENTA_TESTS_STEP1_API`).
"""

import json
import os
import subprocess
import sys
from types import SimpleNamespace
from uuid import uuid4

import pytest

import oss.src.core.access.permissions.service as permissions_service
import oss.src.services.db_manager as db_manager
from oss.src.core.access.dtos import RequestCredentialKind
from oss.src.core.access.permissions.types import Permission
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.tests.pytest.integration.memberships import (
    test_workspace_accept_postgres as step1,
)
from oss.tests.pytest.utils.membership_seed import (
    create_user,
    delete_seeded_organization,
    execute,
    fetch_all,
    seed_organization,
)
from oss.tests.pytest.utils.redis_calls import count_redis_calls
from oss.tests.pytest.utils.statements import count_statements


pytestmark = pytest.mark.integration

# The step-1 harness and its fixture.
bearer_world = step1.bearer_world
POLICIES = step1.POLICIES

# Optional: the API directory of the step-1 code (feat/m4b-workspace-accept) checked out
# elsewhere. When set, each request measurement also runs on that code against the same
# database and asserts the pinned step-1 constants below.
_STEP1_API = os.environ.get("AGENTA_TESTS_STEP1_API")


def _dao() -> MembershipsDAO:
    return MembershipsDAO(engine=get_transactions_engine())


# --- Bearer, API key --------------------------------------------------------- #


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_bearer_counts_per_branch_and_state(bearer_world):
    seeded, user = bearer_world
    ids = seeded.project_ids
    measured = {
        "project+workspace": await step1._measure(
            user,
            project_id=ids[0],
            workspace_id=seeded.workspace_ids[0],
            project_ids=ids,
        ),
        "project": await step1._measure(user, project_id=ids[0], project_ids=ids),
        "workspace": await step1._measure(
            user, workspace_id=seeded.workspace_ids[0], project_ids=ids
        ),
        "none": await step1._measure(user, project_ids=ids),
    }
    # The organization id in the workspace parameter: the same numbers as the workspace id.
    measured_org = {
        "project+workspace": await step1._measure(
            user,
            project_id=ids[0],
            workspace_id=seeded.organization_id,
            project_ids=ids,
        ),
        "workspace": await step1._measure(
            user, workspace_id=seeded.organization_id, project_ids=ids
        ),
    }
    for runs in (measured, measured_org):
        for branch, states in runs.items():
            for state, value in states.items():
                sql, redis = step1._AFTER[branch][state]
                assert value["sql"] == sql, (branch, state, value)
                assert value["sql"] <= step1._TODAY_SQL[branch][state], (branch, state)
                assert len(value["redis"]) == redis, (branch, state, value)
    assert {tuple(states["warm"]["redis"]) for states in measured.values()} == {
        ("GET", "GET")
    }


@pytest.mark.parametrize("bearer_world", POLICIES, indirect=True)
async def test_apikey_counts(bearer_world):
    from oss.src.middlewares import auth
    from oss.src.services import api_key_service
    from oss.src.utils import caching

    seeded, user = bearer_world
    raw_key = await api_key_service.create_api_key(
        user_id=str(user), project_id=str(seeded.project_ids[0])
    )
    client = caching.get_cache_engine()._client()

    async def _call():
        request = step1._bearer_request()
        await auth.verify_apikey_token(request=request, apikey_token=raw_key)
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
            state_ = await _call()
        counts[state] = (len(sql), len(redis))
    assert counts["cold"] == (2, step1._APIKEY_COLD_REDIS), counts
    assert counts["warm"] == (0, 1), counts
    assert state_.workspace_id == state_.organization_id == str(seeded.organization_id)


# --- request paths: one harness for both versions ----------------------------- #
#
# The same code runs in-process (step 2) and, with AGENTA_TESTS_STEP1_API, in a subprocess
# on the step-1 code. `measure(case)` returns {"cold": [sql, redis], "warm": [sql, redis]}
# (and the emails sent, for the invite accept).

_HARNESS = r"""
import json
from types import SimpleNamespace
from uuid import UUID
from sqlalchemy import event
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils import caching

caching.random = lambda: 0.99


def _request(**state):
    return SimpleNamespace(state=SimpleNamespace(**state))


async def _counted(fn):
    engine = get_transactions_engine()
    client = caching.get_cache_engine()._client()
    calls = []
    original = client.execute_command

    async def recording(*args, **kwargs):
        calls.append(str(args[0]))
        return await original(*args, **kwargs)

    statements = []

    def listener(conn, cursor, statement, *rest):
        statements.append(statement)

    client.execute_command = recording
    event.listen(engine._engine.sync_engine, "before_cursor_execute", listener)
    try:
        await fn()
    finally:
        event.remove(engine._engine.sync_engine, "before_cursor_execute", listener)
        client.execute_command = original
    return [len(statements), len(calls)]


async def _flush(user_id, project_id):
    client = caching.get_cache_engine()._client()
    for pattern in (f"cache:p:*:u:{str(user_id)[-12:]}:*", f"cache:p:{str(project_id)[-12:]}:*"):
        async for name in client.scan_iter(match=pattern):
            await client.delete(name)


def _memberships(policy):
    import oss.src.core.memberships.service as memberships_module
    from oss.src.core.memberships.dtos import MembershipPolicy
    from oss.src.core.memberships.service import MembershipsService
    from oss.src.dbs.postgres.memberships.dao import MembershipsDAO

    memberships_module._memberships_service = MembershipsService(
        memberships_dao=MembershipsDAO(engine=get_transactions_engine()),
        policy=MembershipPolicy[policy],
    )


async def measure(case):
    caching.get_cache_engine()._r = None
    _memberships(case["policy"])
    out = {}
    if case["kind"] in ("project_list", "project_current"):
        from oss.src.routers import projects_router

        request = _request(user_id=case["user_id"], project_id=case["project_id"])

        async def call():
            if case["kind"] == "project_list":
                await projects_router.get_projects(request=request)
            else:
                await projects_router.get_project(project_id="current", request=request)

        await call()
        await _flush(case["user_id"], case["project_id"])
        out["cold"] = await _counted(call)
        out["warm"] = await _counted(call)
    elif case["kind"] == "entitlements":
        from ee.src.core.access.entitlements.service import (
            bootstrap_entitlements_services, check_entitlements)

        bootstrap_entitlements_services()
        from ee.src.core.access.entitlements.types import Counter
        from oss.src.utils.context import (
            ApiKeyCredentials, AuthContext, AuthScope, reset_auth_context, set_auth_context)

        scope = AuthScope(
            organization_id=UUID(case["organization_id"]),
            workspace_id=UUID(case["organization_id"]),
            project_id=UUID(case["project_id"]),
            user_id=UUID(case["user_id"]),
        )
        token = set_auth_context(AuthContext(credentials=ApiKeyCredentials(value="k"), scope=scope))
        try:
            for mode in ("soft", "adjust"):
                async def call(mode=mode):
                    await check_entitlements(
                        key=Counter.TRACES_RETRIEVED, delta=1, cache=(mode == "soft"))
                await call()
                await _flush(case["user_id"], case["project_id"])
                client = caching.get_cache_engine()._client()
                async for name in client.scan_iter(match="cache:*entitlements*"):
                    await client.delete(name)
                out[mode + "_cold"] = await _counted(call)
                out[mode + "_warm"] = await _counted(call)
        finally:
            reset_auth_context(token)
    elif case["kind"] == "invite_accept":
        from oss.src.routers import organization_router
        from oss.src.services import organization_service

        sent = []

        class Mailer:
            async def send_email(self, **kwargs):
                sent.append(kwargs["to_email"])
                return True

        organization_service.emailing = Mailer()
        payload = organization_router.InviteToken(token=case["token"], email=case["email"])

        async def call():
            await organization_router.accept_organization_invitation(
                organization_id=case["organization_id"],
                workspace_id=case["workspace_id"],
                project_id=case["project_id"],
                payload=payload,
                request=_request(user_email=case["email"]),
            )

        out["cold"] = await _counted(call)
        out["emails"] = len(sent)
    return out
"""

_harness_namespace: dict = {}
exec(compile(_HARNESS, "workspace_switch_counts_harness", "exec"), _harness_namespace)


def _step1_measure(case):
    """The same measurement on the step-1 code (subprocess), or None when not configured."""

    if not _STEP1_API:
        return None
    from oss.src.utils.env import env

    code = _HARNESS + (
        "\nimport asyncio\n"
        f"print(json.dumps(asyncio.run(measure(json.loads({json.dumps(json.dumps(case))})))))\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=_STEP1_API,
        env={
            **os.environ,
            "PYTHONPATH": _STEP1_API,
            "POSTGRES_URI_CORE": env.postgres.uri_core,
        },
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert result.returncode == 0, result.stderr[-3000:]
    return json.loads(result.stdout.strip().splitlines()[-1])


async def _measure(case):
    return await _harness_namespace["measure"](case)


def _check(name, measured, step1_pinned, step1_live, step2_pinned):
    """Each count: == the pinned step-2 value and <= the pinned step-1 value; with the
    step-1 code configured, the pinned step-1 values equal the live ones."""

    print(
        f"[counts] {name}: step 2 {measured}, step 1 pinned {step1_pinned}, live {step1_live}"
    )
    if step1_live is not None:
        assert {
            k: v for k, v in step1_live.items() if k in step1_pinned
        } == step1_pinned, (
            name,
            step1_live,
        )
    for state, value in measured.items():
        assert value == step2_pinned[state], (name, state, measured)
        if state == "emails":
            continue
        assert value[0] <= step1_pinned[state][0], (name, state, "sql")
        assert value[1] <= step1_pinned[state][1], (name, state, "redis")


@pytest.fixture
def redis_required():
    async def check():
        if not await step1._redis_reachable():
            pytest.skip(
                "Redis is unreachable (set REDIS_URI_VOLATILE to a throwaway Redis)"
            )

    return check


# Step-1 numbers ([statements, Redis commands]), measured on feat/m4b-workspace-accept.
# (Both routes read the resolver without a cache: one statement, no Redis.)
_STEP1 = {
    "project_list": {"cold": [1, 0], "warm": [1, 0]},
    "project_current": {"cold": [1, 0], "warm": [1, 0]},
}
_STEP2 = dict(_STEP1)


@pytest.mark.parametrize("kind", ["project_list", "project_current"])
@pytest.mark.parametrize("policy", ["ORGANIZATION_WIDE", "PROJECT_ROWS"])
async def test_project_route_counts(redis_required, kind, policy):
    await redis_required()
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    try:
        case = {
            "kind": kind,
            "policy": policy,
            "user_id": str(seeded.user_ids["m"]),
            "project_id": str(seeded.project_ids[1]),
        }
        _check(
            f"{kind} {policy}",
            await _measure(case),
            _STEP1[kind],
            _step1_measure(case),
            _STEP2[kind],
        )
    finally:
        await delete_seeded_organization(seeded)


async def test_check_organization_write_counts(monkeypatch):
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)

    async def _allow(**kwargs):
        return True

    monkeypatch.setattr(
        permissions_service,
        "get_request_access",
        lambda: SimpleNamespace(credential_kind=RequestCredentialKind.API_KEY),
    )
    monkeypatch.setattr(permissions_service, "check_action_access", _allow)
    try:
        with count_statements(get_transactions_engine()) as statements:
            await permissions_service.check_organization_write(
                user_uid="u",
                organization_id=str(seeded.organization_id),
                permission=Permission.EDIT_WORKSPACE,
            )
        assert len(statements) == 1  # step 1: 1 (the oldest default)
    finally:
        await delete_seeded_organization(seeded)


async def test_org_details_counts():
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    try:
        organization = await db_manager.get_organization(str(seeded.organization_id))
        with count_statements(get_transactions_engine()) as statements:
            await db_manager.get_org_details(organization)
        assert len(statements) == 3  # step 1: 5 for a legacy organization
    finally:
        await delete_seeded_organization(seeded)


async def test_organizations_and_workspaces_list_counts():
    seeded = await seed_organization(members={"m": "editor"}, workspaces=2)
    try:
        with count_statements(get_transactions_engine()) as statements:
            await db_manager.get_user_organizations(str(seeded.user_ids["m"]))
        # Step 1: the OSS list and GET /workspaces/ also read the workspace items; step 2
        # reads the organizations only.
        assert len(statements) == 1
    finally:
        await delete_seeded_organization(seeded)


# --- the whole invite accept, through the router -------------------------------- #


async def _invitation(*, admins: int, with_workspace: bool):
    members = {f"a{i}": "admin" for i in range(admins - 1)}  # + the owner
    seeded = await seed_organization(
        members=members or {"owner": "owner"}, workspaces=1 if with_workspace else 0
    )
    invitee = await create_user(label="invitee")
    seeded.extra_user_ids.append(invitee)
    email = (await fetch_all("SELECT email FROM users WHERE id = :u", {"u": invitee}))[
        0
    ]["email"]
    tokens = []
    for _ in range(2):  # one for each version
        token = uuid4().hex
        tokens.append(token)
        await execute(
            "INSERT INTO project_invitations (id, token, email, used, role, project_id, "
            "expiration_date, created_at) VALUES (gen_random_uuid(), :t, :e, false, "
            "'viewer', :p, now() + interval '1 day', now())",
            {"t": token, "e": email, "p": seeded.project_ids[0]},
        )
    return seeded, invitee, email, tokens


async def _forget_member(invitee):
    for table in ("organization_members", "project_members", "workspace_members"):
        await execute(f"DELETE FROM {table} WHERE user_id = :u", {"u": invitee})


# Step 1: [statements, Redis] of the whole accept route; emails = workspace admins (none
# for a project without a workspace). Step 2: the organization's owners and admins.
_STEP1_ACCEPT = {
    (1, True): {"cold": [21, 1], "emails": 1},
    (1, False): {"cold": [16, 1], "emails": 0},
    (3, True): {"cold": [23, 1], "emails": 3},
    (3, False): {"cold": [16, 1], "emails": 0},
}
_STEP2_ACCEPT_SQL = 15


@pytest.mark.parametrize("with_workspace", [True, False])
@pytest.mark.parametrize("admins", [1, 3])
@pytest.mark.parametrize("policy", ["ORGANIZATION_WIDE", "PROJECT_ROWS"])
async def test_invite_accept_counts(redis_required, policy, admins, with_workspace):
    await redis_required()
    seeded, invitee, email, tokens = await _invitation(
        admins=admins, with_workspace=with_workspace
    )
    try:
        # The link's workspace segment: the legacy workspace id (step 1 links) or the
        # organization id (step 2 links, and organizations without workspace rows).
        segment = seeded.workspace_ids[0] if with_workspace else seeded.organization_id
        base = {
            "kind": "invite_accept",
            "policy": policy,
            "organization_id": str(seeded.organization_id),
            "workspace_id": str(segment),
            "project_id": str(seeded.project_ids[0]),
            "email": email,
        }
        live = _step1_measure({**base, "token": tokens[0]})
        if live is not None:
            await _forget_member(invitee)
        measured = await _measure({**base, "token": tokens[1]})
        pinned = _STEP1_ACCEPT[(admins, with_workspace)]
        _check(
            f"invite accept {policy} admins={admins} workspace={with_workspace}",
            measured,
            {"cold": pinned["cold"]},
            None if live is None else {"cold": live["cold"]},
            {"cold": [_STEP2_ACCEPT_SQL, 1], "emails": admins},
        )
        if live is not None:
            assert live["emails"] == pinned["emails"]
    finally:
        await delete_seeded_organization(seeded)


# --- EE entitlements ------------------------------------------------------------- #

_STEP1_ENTITLEMENTS = {
    "soft_cold": [2, 8],
    "soft_warm": [0, 2],
    "adjust_cold": [2, 6],
    "adjust_warm": [1, 3],
}
_STEP2_ENTITLEMENTS = dict(_STEP1_ENTITLEMENTS)


async def test_entitlements_check_counts_ee(redis_required):
    from oss.src.utils.common import is_ee

    if not is_ee():
        pytest.skip("EE only")
    await redis_required()
    seeded = await seed_organization(members={"m": "editor"}, workspaces=1)
    try:
        await execute(
            "INSERT INTO subscriptions (organization_id, plan, active) "
            "VALUES (:o, 'cloud_v0_pro', true)",
            {"o": seeded.organization_id},
        )
        case = {
            "kind": "entitlements",
            "policy": "PROJECT_ROWS",
            "organization_id": str(seeded.organization_id),
            "project_id": str(seeded.project_ids[0]),
            "user_id": str(seeded.user_ids["m"]),
        }
        _check(
            "entitlements TRACES_RETRIEVED",
            await _measure(case),
            _STEP1_ENTITLEMENTS,
            _step1_measure(case),
            _STEP2_ENTITLEMENTS,
        )
    finally:
        await delete_seeded_organization(seeded)
