"""HTTP and database helpers for the sharing acceptance tests (M3).

Every helper acts through the public API of the running stack, as a person, an API key
or a run credential would. The only direct reads are of the deployment's own Postgres
(core and tracing), for state the API does not return (turn attribution, queued input
settlement, audit events); tests that use them carry the `integration` marker.

Real turns run on the mock harness (`harness.kind = "mock"`, local sandbox, a
self-managed mock model), so a turn is a real run with a scripted answer and no model
call.
"""

import asyncio
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional
from uuid import uuid4

import pytest
import requests

from oss.src.core.access.dtos import RunOrigin
from oss.tests.pytest.utils.postgres import require_core_uri, resolve_tracing_uri
from utils.constants import BASE_TIMEOUT

# A turn on the mock harness starts a local sandbox; the first one can take a while.
INVOKE_TIMEOUT = 90

NOT_FOUND_BODY = {
    "detail": {"code": "not_found", "message": "Not found.", "retryable": False}
}


# -- callers ---------------------------------------------------------------------------


class Caller:
    """Requests as one credential in one project."""

    def __init__(self, *, api_url, credentials, project_id, user_id):
        self.api_url = api_url
        self.credentials = credentials
        self.project_id = project_id
        self.user_id = user_id

    def __call__(self, method, endpoint, **kwargs):
        params = dict(kwargs.pop("params", {}) or {})
        params.setdefault("project_id", self.project_id)
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("Authorization", self.credentials)
        timeout = kwargs.pop("timeout", BASE_TIMEOUT)
        return requests.request(
            method=method,
            url=f"{self.api_url}{endpoint}",
            params=params,
            headers=headers,
            timeout=timeout,
            **kwargs,
        )

    def services(self, method, endpoint, **kwargs):
        """A request to the agent service (`/services`), as the web app makes it."""

        params = dict(kwargs.pop("params", {}) or {})
        params.setdefault("project_id", self.project_id)
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("Authorization", self.credentials)
        timeout = kwargs.pop("timeout", INVOKE_TIMEOUT)
        return requests.request(
            method=method,
            url=f"{services_url(self.api_url)}{endpoint}",
            params=params,
            headers=headers,
            timeout=timeout,
            **kwargs,
        )

    def with_credentials(self, credentials):
        return Caller(
            api_url=self.api_url,
            credentials=credentials,
            project_id=self.project_id,
            user_id=self.user_id,
        )


def services_url(api_url: str) -> str:
    configured = os.getenv("AGENTA_SERVICES_URL")
    if configured:
        return configured.rstrip("/")
    base = api_url.rstrip("/")
    if base.endswith("/api"):
        base = base[: -len("/api")]
    return f"{base}/services"


# -- accounts --------------------------------------------------------------------------


def first_id(values):
    return next(iter(values.values()))["id"]


def create_person(admin_api, *, email, password, plan=None):
    account = {
        "user": {"email": email},
        "options": {
            "create_api_keys": True,
            "return_api_keys": True,
            "seed_defaults": False,
            "create_identities": True,
        },
        "user_identities": [
            {
                "method": "email:password",
                "subject": email,
                "email": email,
                "password": password,
                "verified": True,
            }
        ],
    }
    if plan:
        account["subscription"] = {"plan": plan}
    response = admin_api(
        "POST", "/admin/simple/accounts/", json={"accounts": {"u": account}}
    )
    assert response.status_code == 200, response.text
    return response.json()["accounts"]["u"]


def delete_person(admin_api, *, email):
    response = admin_api(
        "DELETE",
        "/admin/simple/accounts/",
        json={"accounts": {"u": {"user": {"email": email}}}, "confirm": "delete"},
    )
    assert response.status_code == 204, response.text


def add_member(admin_api, *, organization_id, project_id, user_id, role):
    for path, body in (
        (
            "/admin/simple/accounts/organizations/memberships/",
            {"organization_ref": {"id": organization_id}},
        ),
        (
            "/admin/simple/accounts/projects/memberships/",
            {"project_ref": {"id": project_id}},
        ),
    ):
        response = admin_api(
            "POST",
            path,
            json={"membership": {**body, "user_ref": {"id": user_id}, "role": role}},
        )
        assert response.status_code == 200, response.text


def project_key(admin_api, *, project_id, user_id):
    response = admin_api(
        "POST",
        "/admin/simple/accounts/api-keys/",
        json={
            "options": {"return_api_keys": True},
            "api_key": {
                "project_ref": {"id": project_id},
                "user_ref": {"id": user_id},
            },
        },
    )
    assert response.status_code == 200, response.text
    return (
        "ApiKey "
        + next(iter(response.json()["accounts"][0]["api_keys"].values()))["value"]
    )


def bearer(api_url, *, email, password):
    response = requests.post(
        f"{api_url}/auth/signin",
        headers={"rid": "emailpassword", "st-auth-mode": "header"},
        json={
            "formFields": [
                {"id": "email", "value": email},
                {"id": "password", "value": password},
            ]
        },
        timeout=BASE_TIMEOUT,
    )
    assert response.status_code == 200, response.text
    assert response.json().get("status") == "OK", response.text
    return f"Bearer {response.headers['st-access-token']}"


# -- agents ----------------------------------------------------------------------------


def mock_parameters(behavior: str = "reply", **kwargs) -> dict:
    if behavior == "reply":
        kwargs.setdefault("text", "the mock agent answered")
    return {
        "agent": {
            "harness": {
                "kind": "mock",
                "extras": {"behavior": behavior, "kwargs": kwargs},
            },
            "sandbox": {"kind": "local"},
            "llm": {
                "provider": "mock",
                "model": "mock-1",
                "connection": {"mode": "self_managed"},
            },
        }
    }


def new_agent(
    caller, *, visibility=None, behavior="reply", name=None, **behavior_kwargs
) -> dict:
    """An agent on the mock harness, created through `/simple/workflows/` (one call:
    artifact, variant and first revision). Returns the created workflow: `id`,
    `variant_id`, `revision_id`, `slug`, `access`."""

    slug = f"m3-{uuid4().hex[:12]}"
    workflow = {
        "slug": slug,
        "name": name or slug,
        "flags": {"is_agent": True},
        "data": {
            "uri": "agenta:builtin:agent:v0",
            "parameters": mock_parameters(behavior, **behavior_kwargs),
        },
    }
    if visibility is not None:
        workflow["visibility"] = visibility
    response = caller("POST", "/simple/workflows/", json={"workflow": workflow})
    assert response.status_code == 200, response.text
    created = response.json()["workflow"]
    created.pop("data", None)
    return created


def agent_references(agent: dict) -> List[dict]:
    """The references a heartbeat of a turn on `agent` carries."""

    return [
        {"key": "workflow", "id": agent["id"], "slug": agent["slug"]},
        {"key": "workflow_revision", "id": agent["revision_id"]},
    ]


def set_agent_visibility(caller, agent_id, visibility):
    return caller(
        "POST",
        f"/workflows/{agent_id}/sharing/visibility",
        json={"visibility": visibility},
    )


# -- sessions --------------------------------------------------------------------------


def new_session_id() -> str:
    return str(uuid4())


def create_header(caller, session_id, *, visibility=None, name="m3 session"):
    params = {"session_id": session_id}
    if visibility is not None:
        params["visibility"] = visibility
    return caller("PUT", "/sessions/streams/header", params=params, json={"name": name})


def invoke(caller, *, session_id, agent, text="hello", idempotency_key=None, **extra):
    """One real turn on the agent service, as the web app sends it. The stream is
    read to its end (the turn's end or its park on an approval)."""

    headers = {"Accept": "text/event-stream"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    return caller.services(
        "POST",
        "/agent/v0/invoke",
        headers=headers,
        json={
            "session_id": session_id,
            "references": {"workflow_revision": {"id": agent["revision_id"]}},
            "data": {"inputs": {"messages": [{"role": "user", "content": text}]}},
            **extra,
        },
    )


def heartbeat(
    caller,
    *,
    session_id,
    turn_id=None,
    is_running=True,
    references=None,
    replica_id="m3-acceptance",
):
    body: Dict[str, Any] = {
        "session_id": session_id,
        "replica_id": replica_id,
        "is_running": is_running,
    }
    if turn_id is not None:
        body["turn_id"] = turn_id
    if references is not None:
        body["references"] = references
    return caller("POST", "/sessions/streams/heartbeat", json=body)


def read_stream(caller, session_id):
    return caller("GET", "/sessions/streams/", params={"session_id": session_id})


def stream_is_readable(caller, session_id) -> bool:
    response = read_stream(caller, session_id)
    assert response.status_code == 200, response.text
    return response.json().get("stream") is not None


def fetch_sharing(caller, session_id):
    return caller("GET", f"/sessions/{session_id}/sharing")


def grant(owner, session_id, *, user_id, role):
    response = owner(
        "POST",
        f"/sessions/{session_id}/sharing/grants",
        json={"user_id": str(user_id), "role": role},
    )
    assert response.status_code == 200, response.text
    return response.json()


def revoke(owner, session_id, *, user_id):
    response = owner("DELETE", f"/sessions/{session_id}/sharing/grants/{user_id}")
    assert response.status_code == 200, response.text
    return response.json()


def listed_sessions(caller):
    response = caller("POST", "/sessions/query", json={})
    assert response.status_code == 200, response.text
    return {item["session_id"] for item in response.json().get("sessions") or []}


def listed_agents(caller):
    response = caller("POST", "/workflows/query", json={})
    assert response.status_code == 200, response.text
    return {item["id"] for item in response.json().get("workflows") or []}


def same_answer(hidden, unknown, *, hidden_id, unknown_id):
    """True when two answers are equal once the two ids are swapped."""

    return (
        hidden.status_code == unknown.status_code
        and hidden.text.replace(hidden_id, unknown_id) == unknown.text
    )


# -- members ---------------------------------------------------------------------------


def remove_member(cast, label):
    """The organization owner removes the member through the workspace route (the
    membership writer clears the caches after its commit)."""

    person = cast.people[label]
    response = cast.people["owner"].bearer(
        "DELETE",
        f"/workspaces/{cast.workspace_id}/users/",
        params={"email": person.email, "organization_id": cast.organization_id},
    )
    assert response.status_code == 200, response.text


def readd_member(cast, label):
    person = cast.people[label]
    add_member(
        cast.admin_api,
        organization_id=cast.organization_id,
        project_id=cast.project_id,
        user_id=person.user_id,
        role=person.role,
    )


# -- database --------------------------------------------------------------------------


def _blocking(work: Callable[[], Any]):
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(lambda: asyncio.run(work())).result()


def _query(uri: str, sql: str, *args) -> List[dict]:
    import asyncpg

    async def work():
        connection = await asyncpg.connect(
            uri.replace("postgresql+asyncpg://", "postgresql://")
        )
        try:
            return [dict(row) for row in await connection.fetch(sql, *args)]
        finally:
            await connection.close()

    return _blocking(work)


def core_rows(sql: str, *args) -> List[dict]:
    return _query(require_core_uri(), sql, *args)


def tracing_rows(sql: str, *args) -> List[dict]:
    uri = resolve_tracing_uri()
    if uri is None:
        pytest.fail("The tracing database of the deployment is not reachable.")
    return _query(uri, sql, *args)


def stream_row(project_id, session_id) -> Optional[dict]:
    rows = core_rows(
        "SELECT visibility, owner_user_id::text AS owner_user_id, flags::text AS flags,"
        " deleted_at FROM session_streams WHERE project_id = $1::uuid"
        " AND session_id = $2",
        str(project_id),
        session_id,
    )
    return rows[0] if rows else None


def agent_access_row(project_id, artifact_id) -> Optional[dict]:
    rows = core_rows(
        "SELECT visibility, owner_user_id::text AS owner_user_id FROM agent_access"
        " WHERE project_id = $1::uuid AND artifact_id = $2::uuid",
        str(project_id),
        str(artifact_id),
    )
    return rows[0] if rows else None


def turn_rows(project_id, session_id) -> List[dict]:
    return core_rows(
        "SELECT turn_index, principal_kind, principal_id::text AS principal_id,"
        " sender_user_id::text AS sender_user_id, origin,"
        " approved_by->>'user_id' AS approved_by_user_id"
        " FROM session_turns WHERE project_id = $1::uuid AND session_id = $2"
        " ORDER BY turn_index",
        str(project_id),
        session_id,
    )


def poll(fetch: Callable[[], Any], *, timeout=30.0, delay=0.5):
    """`fetch()` until it returns a truthy value, or the last value at the timeout."""

    deadline = time.monotonic() + timeout
    value = fetch()
    while not value and time.monotonic() < deadline:
        time.sleep(delay)
        value = fetch()
    return value


# -- run credentials -------------------------------------------------------------------


def run_caller(cast, label, *, origin=RunOrigin.WEB) -> Caller:
    """A caller with the person's run credential (`Secret`, origin `web` unless
    named), the credential the runner holds for a turn the person started."""

    from oss.tests.pytest.utils.sharing import human_run_credential

    person = cast.people[label]
    return person.bearer.with_credentials(
        human_run_credential(
            user_id=person.user_id,
            project_id=cast.project_id,
            organization_id=cast.organization_id,
            workspace_id=cast.workspace_id,
            origin=origin,
        )
    )


def exchanged_run_caller(caller) -> Caller:
    """A caller with the run credential the exchange mints for `caller`'s credential
    (`GET /access/permissions/check`, as the services and the runner get theirs)."""

    response = caller(
        "GET",
        "/access/permissions/check",
        params={"action": "run_service", "resource_type": "service"},
    )
    assert response.status_code == 200, response.text
    return caller.with_credentials(response.json()["credentials"])
