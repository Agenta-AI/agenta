"""Access-decision statement counts (M2 latency gate).

"Zero" means zero access-decision statements: statements sent while
`AccessService.decide` or `check_eligibility` runs, counted by phase
(`count_statements_by_phase`). The real `PrincipalsDAO` and `MembershipsDAO` read
Postgres; the cache is the fake one with the real serializer. OSS runs with
`AlwaysEnforcedRbac`; under `AGENTA_LICENSE=ee` the EE cases run with the real
`EntitlementsRbacEnforcement`, whose subscription read goes through the same cache.
"""

from uuid import uuid4

import pytest

import oss.src.core.memberships.service as memberships_module
import oss.src.dbs.postgres.access.dao as principals_module
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.rbac import AlwaysEnforcedRbac
from oss.src.core.access.service import AccessService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.dbs.postgres.access.dao import PrincipalsDAO
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.tests.pytest.utils.cache import FakeCache
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    seed_organization,
)
from oss.tests.pytest.utils.statements import (
    count_statements_by_phase,
    patch_access_phase,
)


pytestmark = pytest.mark.integration

EDITIONS = ["oss", "ee"] if is_ee() else ["oss"]


@pytest.fixture
def fake_cache(monkeypatch):
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    modules = [memberships_module, principals_module]
    if is_ee():
        import ee.src.core.access.entitlements.service as entitlements_module

        modules.append(entitlements_module)
    patch_access_phase(monkeypatch)
    return FakeCache().install(monkeypatch, *modules)


@pytest.fixture
async def seeded():
    organization = await seed_organization(
        members={"editor": "editor", "viewer": "viewer"}
    )
    if is_ee():
        await execute(
            "INSERT INTO subscriptions (organization_id, plan, active) "
            "VALUES (:o, 'cloud_v0_business', true)",
            {"o": organization.organization_id},
        )
    yield organization
    await execute(
        "DELETE FROM api_keys WHERE project_id = ANY(CAST(:p AS uuid[]))",
        {"p": organization.project_ids},
    )
    if is_ee():
        await execute(
            "DELETE FROM subscriptions WHERE organization_id = :o",
            {"o": organization.organization_id},
        )
    await delete_seeded_organization(organization)


def _service(edition: str) -> AccessService:
    if edition == "ee":
        from ee.src.core.access.rbac import EntitlementsRbacEnforcement

        rbac = EntitlementsRbacEnforcement()
        policy = MembershipPolicy.PROJECT_ROWS
    else:
        rbac = AlwaysEnforcedRbac()
        policy = MembershipPolicy.ORGANIZATION_WIDE
    engine = get_transactions_engine()
    return AccessService(
        memberships=MembershipsService(
            memberships_dao=MembershipsDAO(engine=engine), policy=policy
        ),
        rbac=rbac,
        principals=PrincipalsDAO(engine=engine),
    )


def _human(user_id) -> PrincipalRef:
    return PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)


async def _decide(service, principal, project_id, action=Permission.EDIT_WORKFLOWS):
    return await service.decide(
        authority=None, principal=principal, action=action, project_id=project_id
    )


@pytest.mark.parametrize("edition", EDITIONS)
async def test_warm_allow_runs_no_access_statement(edition, seeded, fake_cache):
    service = _service(edition)
    editor = _human(seeded.user_ids["editor"])
    project_id = seeded.project_ids[0]

    assert (await _decide(service, editor, project_id)).allowed
    with count_statements_by_phase(get_transactions_engine()) as s:
        assert (await _decide(service, editor, project_id)).allowed
    assert s["access"] == []


@pytest.mark.parametrize("edition", EDITIONS)
async def test_warm_denial_runs_no_access_statement(edition, seeded, fake_cache):
    service = _service(edition)
    viewer = _human(seeded.user_ids["viewer"])
    outsider = _human(uuid4())
    project_id = seeded.project_ids[0]

    for principal in (viewer, outsider):
        first = await _decide(service, principal, project_id)
        assert not first.allowed
        with count_statements_by_phase(get_transactions_engine()) as s:
            again = await _decide(service, principal, project_id)
        assert (again.allowed, again.reason) == (False, first.reason)
        assert s["access"] == [], principal


@pytest.mark.parametrize("edition", EDITIONS)
async def test_cold_membership_is_one_access_statement(edition, seeded, fake_cache):
    service = _service(edition)
    editor = _human(seeded.user_ids["editor"])
    project_id = seeded.project_ids[0]
    await _decide(service, editor, project_id)  # warms principal and entitlements

    for name in fake_cache.names("resolve_membership"):
        del fake_cache.store[name]
    with count_statements_by_phase(get_transactions_engine()) as s:
        assert (await _decide(service, editor, project_id)).allowed
    assert len(s["access"]) == 1


@pytest.mark.parametrize("edition", EDITIONS)
async def test_cold_principal_adds_one_access_statement(edition, seeded, fake_cache):
    service = _service(edition)
    editor = _human(seeded.user_ids["editor"])
    project_id = seeded.project_ids[0]
    await _decide(service, editor, project_id)

    for name in fake_cache.names("fetch_principal"):
        del fake_cache.store[name]
    with count_statements_by_phase(get_transactions_engine()) as s:
        assert (await _decide(service, editor, project_id)).allowed
    assert len(s["access"]) == 1

    # An API key, cold: one principal statement plus one membership statement.
    key_id = uuid4()
    await execute(
        "INSERT INTO api_keys (id, prefix, hashed_key, project_id, created_by_id, "
        "rate_limit, hidden, created_at, updated_at) "
        "VALUES (:id, :prefix, 'x', :p, :u, 0, false, now(), now())",
        {
            "id": key_id,
            "prefix": f"m2cnt{key_id.hex[:6]}",
            "p": project_id,
            "u": seeded.user_ids["viewer"],
        },
    )
    key = PrincipalRef(kind=PrincipalKind.API_KEY, id=key_id)
    with count_statements_by_phase(get_transactions_engine()) as s:
        await service.decide(
            authority=None,
            principal=key,
            action=Permission.VIEW_APPLICATIONS,
            project_id=project_id,
        )
    assert len(s["access"]) == 2
    with count_statements_by_phase(get_transactions_engine()) as s:
        await service.decide(
            authority=None,
            principal=key,
            action=Permission.VIEW_APPLICATIONS,
            project_id=project_id,
        )
    assert s["access"] == []


@pytest.mark.parametrize("edition", EDITIONS)
async def test_bearer_is_member_is_free_when_resolve_is_warm(
    edition, seeded, fake_cache
):
    service = _service(edition)
    user = seeded.user_ids["editor"]
    project_id = seeded.project_ids[0]

    with count_statements_by_phase(get_transactions_engine()) as s:
        assert await service.memberships.is_member(user_id=user, project_id=project_id)
    assert len(s["endpoint"]) == 1
    with count_statements_by_phase(get_transactions_engine()) as s:
        assert await service.memberships.is_member(user_id=user, project_id=project_id)
    assert s["endpoint"] == [] and s["access"] == []


# -- C13: the hot paths, through their real entry points -----------------------------

import oss.src.core.access.service as access_module  # noqa: E402
from oss.src.core.access.context import (  # noqa: E402
    reset_request_access,
    set_request_access,
)
from oss.tests.pytest.utils.principals import (  # noqa: E402
    AllowingAccessService,
    make_envelope,
    make_request_access,
)


def _bearer(user_id, *, project_id, organization_id):
    return make_request_access(
        envelope=make_envelope(
            kind="human",
            principal_id=user_id,
            project_id=project_id,
            organization_id=organization_id,
        ),
        credential_kind="bearer_session",
    )


class _AccessScope:
    """Set the request access (and the auth context) for one call, as the auth
    middleware does."""

    def __init__(self, access, *, workspace_id=None):
        from oss.src.utils.context import (  # noqa: PLC0415
            AuthContext,
            AuthScope,
            SecretCredentials,
        )

        self.access = access
        self.context = AuthContext(
            credentials=SecretCredentials(value="caller-token"),
            scope=AuthScope(
                organization_id=access.authority.organization_id,
                workspace_id=workspace_id or uuid4(),
                project_id=access.authority.project_id,
                user_id=access.acting_user_id,
            ),
        )

    def __enter__(self):
        from oss.src.utils.context import set_auth_context  # noqa: PLC0415

        self._access_token = set_request_access(self.access)
        self._auth_token = set_auth_context(self.context)
        return self

    def __exit__(self, *exc):
        from oss.src.utils.context import reset_auth_context  # noqa: PLC0415

        reset_auth_context(self._auth_token)
        reset_request_access(self._access_token)


@pytest.mark.parametrize("edition", EDITIONS)
async def test_wrapper_warm_allow_and_warm_denial_run_no_access_statement(
    edition, seeded, fake_cache, monkeypatch
):
    from oss.src.core.access.permissions.service import check_action_access

    monkeypatch.setattr(access_module, "_access_service", _service(edition))
    project_id = seeded.project_ids[0]
    for role, expected in (("editor", True), ("viewer", False)):
        user = seeded.user_ids[role]
        access = _bearer(
            user, project_id=project_id, organization_id=seeded.organization_id
        )
        with _AccessScope(access):
            arguments = dict(
                user_uid=str(user),
                project_id=str(project_id),
                permission=Permission.EDIT_WORKFLOWS,
            )
            assert await check_action_access(**arguments) is expected
            with count_statements_by_phase(get_transactions_engine()) as s:
                assert await check_action_access(**arguments) is expected
        assert s["access"] == [], role
        assert s["endpoint"] == [], role


def _exchange_request(access):
    from starlette.requests import Request  # noqa: PLC0415

    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/access/permissions/check",
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "root_path": "",
        }
    )
    request.state.token_grants = ()
    request.state.run_envelope = access.envelope or make_envelope(
        kind=access.principal.kind.value,
        principal_id=access.principal.id,
        project_id=access.authority.project_id,
        organization_id=access.authority.organization_id,
    )
    return request


async def _exchange(access):
    from oss.src.apis.fastapi.access.router import AccessRouter  # noqa: PLC0415

    with _AccessScope(access):
        return await AccessRouter().check_permissions(
            _exchange_request(access),
            action="run_service",
            scope_type=None,
            scope_id=None,
            resource_type="service",
            resource_id=None,
            without_grants=False,
        )


@pytest.mark.parametrize("edition", EDITIONS)
async def test_exchange_warm_runs_no_access_statement_and_unchanged_endpoint_statements(
    edition, seeded, fake_cache, monkeypatch
):
    import oss.src.middlewares.auth as auth_module

    monkeypatch.setattr(auth_module, "_SECRET_KEY", "unit-test-secret-key-32-bytes!!")
    access = _bearer(
        seeded.user_ids["editor"],
        project_id=seeded.project_ids[0],
        organization_id=seeded.organization_id,
    )

    monkeypatch.setattr(access_module, "_access_service", AllowingAccessService())
    await _exchange(access)
    with count_statements_by_phase(get_transactions_engine()) as baseline:
        await _exchange(access)

    monkeypatch.setattr(access_module, "_access_service", _service(edition))
    await _exchange(access)
    with count_statements_by_phase(get_transactions_engine()) as s:
        response = await _exchange(access)

    assert response.status_code == 200
    assert s["access"] == []
    assert len(s["endpoint"]) == len(baseline["endpoint"])


@pytest.mark.parametrize("edition", EDITIONS)
async def test_gateway_credentials_warm_runs_no_access_statement(
    edition, seeded, fake_cache, monkeypatch
):
    import oss.src.middlewares.auth as auth_module
    from oss.src.apis.fastapi.gateways.credentials_router import (
        GatewayCredentialsRouter,
    )

    monkeypatch.setattr(auth_module, "_SECRET_KEY", "unit-test-secret-key-32-bytes!!")
    monkeypatch.setattr(access_module, "_access_service", _service(edition))
    access = _bearer(
        seeded.user_ids["viewer"],
        project_id=seeded.project_ids[0],
        organization_id=seeded.organization_id,
    )

    async def _issue():
        with _AccessScope(access):
            return await GatewayCredentialsRouter().issue_gateway_credentials(
                _exchange_request(access)
            )

    await _issue()
    with count_statements_by_phase(get_transactions_engine()) as s:
        response = await _issue()
    assert response.credentials.startswith("Secret ")
    assert s["access"] == []
    assert s["endpoint"] == []


async def _seed_agent(project_id, user_id):
    """A workflow with one committed revision, through the real workflows service."""

    import oss.src.models.db_models  # noqa: F401, PLC0415
    from oss.src.core.workflows.dtos import (  # noqa: PLC0415
        WorkflowRevisionCommit,
        WorkflowRevisionData,
    )
    from oss.src.core.workflows.service import WorkflowsService  # noqa: PLC0415
    from oss.src.dbs.postgres.git.dao import GitDAO  # noqa: PLC0415
    from oss.src.dbs.postgres.workflows.dbes import (  # noqa: PLC0415
        WorkflowArtifactDBE,
        WorkflowRevisionDBE,
        WorkflowVariantDBE,
    )

    artifact_id, variant_id = uuid4(), uuid4()
    await execute(
        "INSERT INTO workflow_artifacts (id, project_id, slug, created_at) "
        "VALUES (:id, :p, :slug, now())",
        {"id": artifact_id, "p": project_id, "slug": f"m2cnt-{artifact_id.hex[:8]}"},
    )
    await execute(
        "INSERT INTO workflow_variants (id, project_id, artifact_id, slug, created_at) "
        "VALUES (:id, :p, :a, :slug, now())",
        {
            "id": variant_id,
            "p": project_id,
            "a": artifact_id,
            "slug": f"m2cnt-v-{variant_id.hex[:8]}",
        },
    )
    service = WorkflowsService(
        workflows_dao=GitDAO(
            ArtifactDBE=WorkflowArtifactDBE,
            VariantDBE=WorkflowVariantDBE,
            RevisionDBE=WorkflowRevisionDBE,
            engine=get_transactions_engine(),
        )
    )
    outcome = await service.commit_workflow_revision_checked(
        project_id=project_id,
        user_id=user_id,
        workflow_revision_commit=WorkflowRevisionCommit(
            workflow_variant_id=variant_id,
            data=WorkflowRevisionData(url="http://services/agent"),
            message="seed",
        ),
    )
    assert outcome.status == "committed"
    return service, artifact_id, variant_id


async def _delete_agent(project_id):
    for table in (
        "trigger_deliveries",
        "session_streams",
        "trigger_schedules",
        "workflow_revisions",
        "workflow_variants",
        "workflow_artifacts",
    ):
        await execute(f"DELETE FROM {table} WHERE project_id = :p", {"p": project_id})


@pytest.mark.parametrize("edition", EDITIONS)
async def test_trigger_tick_runs_no_access_statement_and_unchanged_endpoint_statements(
    edition, seeded, fake_cache, monkeypatch
):
    """A real tick: real TriggersDAO, real delivery claim, real target resolution and
    artifact read; only the detached dispatch is a stub. Warm, the decision sends no
    statement, and the tick sends as many statements with the real AccessService as
    with an always-allow stub (no hidden access read on the endpoint side)."""

    from unittest.mock import AsyncMock  # noqa: PLC0415

    from oss.src.core.triggers.dtos import (  # noqa: PLC0415
        TriggerScheduleCreate,
        TriggerScheduleData,
    )
    from oss.src.dbs.postgres.sessions.streams.dao import (  # noqa: PLC0415
        SessionStreamsDAO,
    )
    from oss.src.dbs.postgres.triggers.dao import TriggersDAO  # noqa: PLC0415
    from oss.src.tasks.asyncio.triggers.dispatcher import (  # noqa: PLC0415
        TriggersDispatcher,
    )

    project_id = seeded.project_ids[0]
    editor = seeded.user_ids["editor"]
    workflows, artifact_id, _ = await _seed_agent(project_id, editor)
    triggers = TriggersDAO(engine=get_transactions_engine())
    claims = SessionStreamsDAO(engine=get_transactions_engine())
    try:
        schedule = await triggers.create_schedule(
            project_id=project_id,
            user_id=editor,
            principal=_human(editor),
            artifact_id=artifact_id,
            schedule=TriggerScheduleCreate(
                name="m2-count",
                data=TriggerScheduleData(
                    event_key="cron.tick",
                    schedule="0 0 1 1 *",
                    references={"workflow": {"id": str(artifact_id)}},
                ),
            ),
        )

        async def _tick(access_service, event_id):
            dispatch = AsyncMock(return_value="run-1")
            dispatcher = TriggersDispatcher(
                triggers_dao=triggers,
                session_claims_dao=claims,
                workflows_service=workflows,
                dispatch_fn=dispatch,
                access_service=access_service,
            )
            await dispatcher.dispatch_schedule(
                project_id=project_id, schedule=schedule, event_id=event_id, event={}
            )
            return dispatch

        stub = AllowingAccessService(organization_id=seeded.organization_id)
        await _tick(stub, "warm-stub")
        with count_statements_by_phase(get_transactions_engine()) as baseline:
            await _tick(stub, "tick-stub")

        service = _service(edition)
        await _tick(service, "warm-real")
        with count_statements_by_phase(get_transactions_engine()) as s:
            dispatch = await _tick(service, "tick-real")

        dispatch.assert_awaited_once()
        assert dispatch.await_args.kwargs["envelope"].authority.principal == (
            _human(editor)
        )
        assert s["access"] == []
        assert len(s["endpoint"]) == len(baseline["endpoint"])
        assert baseline["endpoint"], "the tick must have reached Postgres"
    finally:
        await _delete_agent(project_id)
