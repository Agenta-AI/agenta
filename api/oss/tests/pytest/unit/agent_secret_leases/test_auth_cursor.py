from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from oss.src.apis.fastapi.agent_secret_leases.models import LeasesResponse
from oss.src.apis.fastapi.agent_secret_leases import utils
from oss.src.core.agent_secret_leases.dtos import LeaseQuery
from oss.src.core.agent_secret_leases.types import LeaseInvalid
from oss.src.dbs.postgres.agent_secret_leases.dao import AgentSecretLeasesDAO
from oss.src.utils.context import (
    ApiKeyCredentials,
    AuthContext,
    AuthScope,
    SecretCredentials,
    reset_auth_context,
    set_auth_context,
)


def auth_scope():
    return AuthScope(
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
    )


def request(token=None):
    headers = (
        [] if token is None else [(b"x-agenta-runner-control-token", token.encode())]
    )
    return Request({"type": "http", "method": "POST", "path": "/", "headers": headers})


def test_tenant_scope_is_derived_from_secret_auth_context_exactly():
    scope = auth_scope()
    token = set_auth_context(
        AuthContext(credentials=SecretCredentials(value="ephemeral"), scope=scope)
    )
    try:
        assert utils.tenant_scope_from_context().model_dump() == scope.model_dump()
    finally:
        reset_auth_context(token)


def test_api_key_cannot_use_tenant_lease_routes():
    token = set_auth_context(
        AuthContext(
            credentials=ApiKeyCredentials(value="project-key"), scope=auth_scope()
        )
    )
    try:
        with pytest.raises(HTTPException) as exc:
            utils.tenant_scope_from_context()
        assert exc.value.status_code == 403
    finally:
        reset_auth_context(token)


def test_janitor_token_is_narrow_and_fail_closed(monkeypatch):
    monkeypatch.setattr(
        utils,
        "env",
        SimpleNamespace(runner=SimpleNamespace(control_token="correct-token")),
    )
    with pytest.raises(HTTPException) as exc:
        utils.require_janitor(request("wrong-token"))
    assert exc.value.status_code == 401
    utils.require_janitor(request("correct-token"))


class EmptyResult:
    def scalar_one_or_none(self):
        return None


class FakeEngine:
    @asynccontextmanager
    async def session(self):
        yield self

    async def execute(self, _stmt):
        return EmptyResult()


class LeaseResult:
    def __init__(self, leases):
        self.leases = leases

    def scalars(self):
        return self

    def unique(self):
        return self

    def all(self):
        return self.leases


class QueryEngine:
    def __init__(self, lease):
        self.lease = lease
        self.statements = []

    @asynccontextmanager
    async def session(self):
        yield self

    async def execute(self, stmt):
        self.statements.append(stmt)
        return LeaseResult([self.lease])


def lease_dbe(*, created_at, next_attempt_at):
    from oss.src.dbs.postgres.agent_secret_leases.dbes import AgentSecretLeaseDBE

    lease_id = uuid4()
    return AgentSecretLeaseDBE(
        id=lease_id,
        organization_id=uuid4(),
        workspace_id=uuid4(),
        project_id=uuid4(),
        created_by_id=uuid4(),
        provider="daytona",
        owner_kind="session",
        owner_id="session-1",
        idempotency_key=f"idempotency-{lease_id}",
        plan_digest="sha256:" + "a" * 64,
        credential_epoch_digest="hmac-sha256:" + "b" * 64,
        sandbox_label=f"agenta.lease_id={lease_id}",
        state="cleanup_pending",
        version=2,
        attempt_count=1,
        next_attempt_at=next_attempt_at,
        claim_generation=0,
        created_at=created_at,
        resources=[],
    )


@pytest.mark.asyncio
async def test_missing_cursor_anchor_fails_instead_of_restarting_first_page():
    dao = AgentSecretLeasesDAO(engine=FakeEngine())
    query = LeaseQuery.model_validate(
        {"windowing": {"next": "not-a-cursor", "limit": 10}}
    )
    with pytest.raises(LeaseInvalid, match="invalid_cursor"):
        await dao.query(scope=None, query=query)


def test_cursor_captures_immutable_sort_tuple_without_anchor_lookup():
    lease_id = uuid4()
    sort_time = datetime(2026, 7, 12, 1, 2, 3, 456789, tzinfo=timezone.utc)
    cursor = AgentSecretLeasesDAO._encode_cursor(sort_time, lease_id)
    decoded_time, decoded_id = AgentSecretLeasesDAO._decode_cursor(cursor)
    assert decoded_time == sort_time
    assert decoded_id == lease_id
    with pytest.raises(LeaseInvalid, match="invalid_cursor"):
        AgentSecretLeasesDAO._decode_cursor(cursor + "tampered")


@pytest.mark.asyncio
async def test_record_retry_schedule_cannot_move_cursor_order():
    created_at = datetime(2026, 7, 12, 1, 2, 3, tzinfo=timezone.utc)
    lease = lease_dbe(
        created_at=created_at,
        next_attempt_at=created_at + timedelta(minutes=1),
    )
    engine = QueryEngine(lease)
    dao = AgentSecretLeasesDAO(engine=engine)
    query = LeaseQuery.model_validate({"windowing": {"limit": 1}})

    first = await dao.query(scope=None, query=query)
    lease.next_attempt_at = created_at + timedelta(days=30)
    lease.attempt_count += 1
    second = await dao.query(scope=None, query=query)

    assert first.next_cursor == second.next_cursor
    assert AgentSecretLeasesDAO._decode_cursor(first.next_cursor) == (
        created_at,
        lease.id,
    )
    compiled = str(
        engine.statements[-1].compile(compile_kwargs={"literal_binds": True})
    )
    order_by = compiled.split("ORDER BY", maxsplit=1)[1]
    assert "created_at" in order_by
    assert "next_attempt_at" not in order_by


def test_query_response_uses_shared_windowing_next_shape():
    cursor = AgentSecretLeasesDAO._encode_cursor(datetime.now(timezone.utc), uuid4())
    response = LeasesResponse(
        count=0, leases=[], windowing={"next": cursor, "limit": 100}
    )
    wire = response.model_dump(mode="json", by_alias=True, exclude_none=True)
    assert wire["windowing"]["next"] == cursor
    assert wire["windowing"]["limit"] == 100


def test_auth_middleware_workload_bypass_is_limited_to_janitor_routes(monkeypatch):
    from oss.src.middlewares import auth

    monkeypatch.setattr(
        auth,
        "env",
        SimpleNamespace(runner=SimpleNamespace(control_token="correct-token")),
    )
    assert auth._verify_runner_control_request(request("correct-token")) is False
    janitor = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/agent-secret-leases/query",
            "headers": [(b"x-agenta-runner-control-token", b"correct-token")],
            "query_string": b"",
            "server": ("test", 80),
            "scheme": "http",
        }
    )
    assert auth._verify_runner_control_request(janitor) is True
    lease_id = uuid4()
    for method, path in (
        ("GET", f"/agent-secret-leases/{lease_id}"),
        ("PATCH", f"/agent-secret-leases/{lease_id}"),
        ("POST", f"/agent-secret-leases/{lease_id}/claim"),
    ):
        allowed = Request(
            {
                "type": "http",
                "method": method,
                "path": path,
                "headers": [(b"x-agenta-runner-control-token", b"correct-token")],
                "query_string": b"",
                "server": ("test", 80),
                "scheme": "http",
            }
        )
        assert auth._verify_runner_control_request(allowed) is True
    for method, path in (
        ("POST", "/agent-secret-leases/"),
        ("PATCH", "/agent-secret-leases/not-a-uuid"),
        ("PATCH", f"/agent-secret-leases/{lease_id}/extra"),
        ("POST", f"/agent-secret-leases/{lease_id}/extra/claim"),
    ):
        denied = Request(
            {
                "type": "http",
                "method": method,
                "path": path,
                "headers": [(b"x-agenta-runner-control-token", b"correct-token")],
                "query_string": b"",
                "server": ("test", 80),
                "scheme": "http",
            }
        )
        assert auth._verify_runner_control_request(denied) is False
    invalid = Request(
        {
            "type": "http",
            "method": "PATCH",
            "path": f"/agent-secret-leases/{uuid4()}",
            "headers": [(b"x-agenta-runner-control-token", b"wrong")],
            "query_string": b"",
            "server": ("test", 80),
            "scheme": "http",
        }
    )
    with pytest.raises(HTTPException) as exc:
        auth._verify_runner_control_request(invalid)
    assert exc.value.status_code == 401
