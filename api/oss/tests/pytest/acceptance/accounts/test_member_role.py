"""The `member` role, route by route (small team roles).

A member uses the product but reads no trace content: spans, traces, analytics,
invocations and annotations by trace id, and evaluations answer 403. Billing changes
answer 403 too. A member keeps what a run needs: chat sessions and turns, OTLP ingest,
and the credit balance. An admin keeps trace reads.

On EE the owner's organization is pinned to Pro, a plan without the RBAC entitlement,
which proves that roles apply there. On OSS the same checks run without a plan.
"""

from uuid import uuid4

import pytest

from oss.src.utils.common import is_ee

_OWNER_PLAN = "cloud_v0_pro" if is_ee() else None
# Any trace id: the role check answers before the trace is looked up.
_TRACE_ID = "0" * 31 + "1"


def _create_account(admin_api, *, email, plan=None):
    account = {
        "user": {"email": email},
        "options": {
            "create_api_keys": True,
            "return_api_keys": True,
            "seed_defaults": True,
        },
    }
    if plan is not None:
        account["subscription"] = {"plan": plan}
    resp = admin_api(
        "POST", "/admin/simple/accounts/", json={"accounts": {"u": account}}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["accounts"]["u"]


def _delete_account_by_email(admin_api, *, email):
    resp = admin_api(
        "DELETE",
        "/admin/simple/accounts/",
        json={"accounts": {"u": {"user": {"email": email}}}, "confirm": "delete"},
    )
    assert resp.status_code == 204, resp.text


def _first_id(values):
    return next(iter(values.values()))["id"]


def _add_member(admin_api, *, organization_id, project_id, user_id, role):
    for path, ref in (
        ("organizations", {"organization_ref": {"id": organization_id}}),
        ("projects", {"project_ref": {"id": project_id}}),
    ):
        resp = admin_api(
            "POST",
            f"/admin/simple/accounts/{path}/memberships/",
            json={"membership": {**ref, "user_ref": {"id": user_id}, "role": role}},
        )
        assert resp.status_code == 200, resp.text


def _project_key(admin_api, *, project_id, user_id):
    resp = admin_api(
        "POST",
        "/admin/simple/accounts/api-keys/",
        json={
            "options": {"return_api_keys": True},
            "api_key": {"project_ref": {"id": project_id}, "user_ref": {"id": user_id}},
        },
    )
    assert resp.status_code == 200, resp.text
    account = resp.json()["accounts"][0]
    return next(iter(account["api_keys"].values()))["value"]


@pytest.fixture(scope="module")
def team(admin_api):
    """An owner's organization with one `member` and one `admin`, each with a key in the
    owner's project."""
    uid = uuid4().hex[:12]
    emails = {
        label: f"member-role-{label}-{uid}@test.agenta.ai"
        for label in ("owner", "member", "admin")
    }
    owner = _create_account(admin_api, email=emails["owner"], plan=_OWNER_PLAN)
    organization_id = _first_id(owner["organizations"])
    project_id = _first_id(owner["projects"])
    headers = {}
    try:
        for label in ("member", "admin"):
            account = _create_account(admin_api, email=emails[label])
            _add_member(
                admin_api,
                organization_id=organization_id,
                project_id=project_id,
                user_id=account["user"]["id"],
                role=label,
            )
            key = _project_key(
                admin_api, project_id=project_id, user_id=account["user"]["id"]
            )
            headers[label] = {"Authorization": f"ApiKey {key}"}
        yield {
            "organization_id": organization_id,
            "workspace_id": _first_id(owner["workspaces"]),
            "project_id": project_id,
            "headers": headers,
            "owner_headers": {"Authorization": f"ApiKey {owner['api_keys']['key']}"},
        }
    finally:
        for email in emails.values():
            _delete_account_by_email(admin_api, email=email)


_DENIED_ROUTES = [
    ("POST", "/spans/query", {}),
    ("GET", "/spans/", None),
    ("POST", "/traces/query", {}),
    ("GET", f"/traces/{_TRACE_ID}", None),
    ("POST", "/spans/analytics/query", {}),
    ("POST", "/tracing/spans/query", {}),
    ("GET", f"/simple/traces/{_TRACE_ID}", None),
    ("GET", f"/invocations/{_TRACE_ID}", None),
    ("GET", f"/annotations/{_TRACE_ID}", None),
    ("POST", "/evaluations/runs/query", {}),
]

_EE_DENIED_ROUTES = [
    ("POST", "/billing/stripe/portals/", None),
    ("POST", "/wallets/usage/query", {}),
]


def _call(admin_api, team, label, method, path, body):
    resp = admin_api(
        method,
        path,
        params={"project_id": team["project_id"]},
        headers=team["headers"][label],
        **({"json": body} if body is not None else {}),
    )
    # The wallet routes exist only while `AGENTA_WALLETS_ENABLED` is on.
    if path.startswith("/wallets/") and resp.status_code == 404:
        pytest.skip("wallets are off on this deployment")
    return resp


@pytest.mark.parametrize("method, path, body", _DENIED_ROUTES)
def test_member_cannot_read_trace_content(admin_api, team, method, path, body):
    resp = _call(admin_api, team, "member", method, path, body)
    assert resp.status_code == 403, (path, resp.status_code, resp.text)


@pytest.mark.parametrize("method, path, body", _DENIED_ROUTES)
def test_admin_reads_trace_content(admin_api, team, method, path, body):
    resp = _call(admin_api, team, "admin", method, path, body)
    assert resp.status_code != 403, (path, resp.status_code, resp.text)


@pytest.mark.skipif(not is_ee(), reason="billing is EE")
@pytest.mark.parametrize("method, path, body", _EE_DENIED_ROUTES)
def test_member_cannot_change_billing(admin_api, team, method, path, body):
    resp = _call(admin_api, team, "member", method, path, body)
    assert resp.status_code == 403, (path, resp.status_code, resp.text)


@pytest.mark.skipif(not is_ee(), reason="billing is EE")
def test_admin_reads_credit_usage(admin_api, team):
    resp = _call(admin_api, team, "admin", "POST", "/wallets/usage/query", {})
    assert resp.status_code != 403, resp.text


@pytest.mark.parametrize(
    "method, path, body",
    [
        ("POST", "/sessions/streams/query", {}),
        ("POST", "/sessions/turns/query", {}),
        ("POST", "/sessions/records/query", {}),
        ("POST", "/workflows/query", {}),
    ]
    + ([("GET", "/wallets/summary", None)] if is_ee() else []),
)
def test_member_keeps_what_a_run_needs(admin_api, team, method, path, body):
    resp = _call(admin_api, team, "member", method, path, body)
    assert resp.status_code != 403, (path, resp.status_code, resp.text)
    assert resp.status_code < 500, (path, resp.status_code, resp.text)


def test_member_may_ingest_spans(admin_api, team):
    # An empty OTLP export: the permission check passes (`EDIT_SPANS`), and the body
    # holds no span.
    resp = admin_api(
        "POST",
        "/otlp/v1/traces",
        params={"project_id": team["project_id"]},
        headers={
            **team["headers"]["member"],
            "Content-Type": "application/x-protobuf",
        },
        data=b"",
    )
    assert resp.status_code != 403, resp.text


def test_member_cannot_invite_or_change_roles(admin_api, team):
    invite = admin_api(
        "POST",
        f"/organizations/{team['organization_id']}/workspaces/{team['workspace_id']}/invite",
        params={"project_id": team["project_id"]},
        headers=team["headers"]["member"],
        json=[{"email": f"x-{uuid4().hex[:8]}@agenta.ai"}],
    )
    assert invite.status_code == 403, invite.text


def test_roles_offered_without_rbac(admin_api, team):
    resp = admin_api(
        "GET",
        "/access/roles",
        params={"project_id": team["project_id"]},
        headers=team["owner_headers"],
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["offered"] == {"roles": ["admin", "member"], "floor_role": "member"}
    # The catalog keeps every role, so stored roles keep a description.
    assert {"viewer", "member", "developer"} <= {r["role"] for r in body["project"]}

    roles = admin_api(
        "GET",
        "/workspaces/roles/",
        params={"project_id": team["project_id"]},
        headers=team["owner_headers"],
    )
    assert roles.status_code == 200, roles.text
    assert [r["role_name"] for r in roles.json()] == ["admin", "member"]


def test_invite_takes_the_floor_role_and_refuses_owner(admin_api, team):
    invite = f"/organizations/{team['organization_id']}/workspaces/{team['workspace_id']}/invite"
    for roles in (["owner"], ["viewer"]):
        refused = admin_api(
            "POST",
            invite,
            params={"project_id": team["project_id"]},
            headers=team["owner_headers"],
            json=[{"email": f"x-{uuid4().hex[:8]}@agenta.ai", "roles": roles}],
        )
        assert refused.status_code == 400, (roles, refused.text)

    # No role: the invitation is written with the floor role `member`.
    accepted = admin_api(
        "POST",
        invite,
        params={"project_id": team["project_id"]},
        headers=team["owner_headers"],
        json=[{"email": f"x-{uuid4().hex[:8]}@agenta.ai"}],
    )
    assert accepted.status_code == 200, accepted.text


def test_admin_cannot_delete_a_project(admin_api, team):
    resp = admin_api(
        "DELETE",
        f"/projects/{team['project_id']}",
        params={"project_id": team["project_id"]},
        headers=team["headers"]["admin"],
    )
    assert resp.status_code == 403, resp.text
