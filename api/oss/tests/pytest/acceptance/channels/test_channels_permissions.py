"""Acceptance: who may read and write the channels API.

Two boundaries, checked against every authenticated channels route:

  - a viewer-role member of the project reads (200) and never writes (403);
  - a key from another project never reads or changes this project's
    connections, agents, spaces, grants, threads or events: by-id routes 404,
    query routes answer with none of this project's rows.

The owner's project is seeded over the wire -- an `agenta` connection (no
platform credentials), a default agent, a space, a grant and one posted
message -- so every by-id route targets a row that really exists. The agent
references a revision that does not exist; its turn fails, which still writes
the thread and the outbox row the event routes need.

The owner account is pinned to a plan with RBAC so the checks enforce on EE;
OSS ignores the plan and enforces RBAC unconditionally. The suite creates its
own accounts through the admin endpoint and deletes them afterwards, so it
needs no database access.
"""

import time
from uuid import uuid4

import pytest
import requests

from utils.constants import BASE_TIMEOUT

pytestmark = pytest.mark.acceptance

_RBAC_PLAN = "cloud_v0_business"


# --------------------------------------------------------------------------- #
# Accounts
# --------------------------------------------------------------------------- #


def _create_account(admin_api, *, email, plan=None):
    account = {
        "user": {"email": email},
        "options": {
            "create_api_keys": True,
            "return_api_keys": True,
            "seed_defaults": False,
        },
    }
    if plan is not None:
        account["subscription"] = {"plan": plan}

    resp = admin_api(
        "POST", "/admin/simple/accounts/", json={"accounts": {"u": account}}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["accounts"]["u"]


def _delete_account(admin_api, *, email):
    resp = admin_api(
        "DELETE",
        "/admin/simple/accounts/",
        json={"accounts": {"u": {"user": {"email": email}}}, "confirm": "delete"},
    )
    assert resp.status_code == 204, resp.text


def _first_id(values):
    return next(iter(values.values()))["id"]


def _add_viewer(admin_api, *, organization_id, workspace_id, project_id, user_id):
    """A viewer of the owner's project. Access is checked at the organization
    and workspace before the project role is read, so the member needs all
    three memberships, each as viewer."""

    for level, ref_id in (
        ("organizations", organization_id),
        ("workspaces", workspace_id),
        ("projects", project_id),
    ):
        resp = admin_api(
            "POST",
            f"/admin/simple/accounts/{level}/memberships/",
            json={
                "membership": {
                    f"{level[:-1]}_ref": {"id": ref_id},
                    "user_ref": {"id": user_id},
                    "role": "viewer",
                }
            },
        )
        assert resp.status_code == 200, f"{level}: {resp.text}"


def _mint_key(admin_api, *, project_id, user_id):
    """Keys are project-scoped: the viewer needs one in the owner's project."""

    resp = admin_api(
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
    assert resp.status_code == 200, resp.text
    account = resp.json()["accounts"][0]
    return next(iter(account["api_keys"].values()))["value"]


def _client(api_url, raw_key):
    headers = {"Authorization": f"ApiKey {raw_key}"}

    def _request(method, endpoint, **kwargs):
        return requests.request(
            method=method,
            url=f"{api_url}{endpoint}",
            headers={**headers, **kwargs.pop("headers", {})},
            timeout=BASE_TIMEOUT,
            **kwargs,
        )

    return _request


# --------------------------------------------------------------------------- #
# The owner's seeded project
# --------------------------------------------------------------------------- #


def _ok(resp, status=200):
    assert resp.status_code == status, f"{resp.status_code} {resp.text}"
    return resp.json() if resp.content else None


def _poll(fetch, *, attempts=40, delay=0.5):
    for _ in range(attempts):
        rows = fetch()
        if rows:
            return rows
        time.sleep(delay)
    return []


def _seed(owner):
    slug = f"perm-{uuid4().hex[:8]}"

    connection = _ok(
        owner(
            "POST",
            "/channels/connections/",
            json={
                "connection": {
                    "channel": "agenta",
                    "slug": slug,
                    "data": {"bot": slug},
                }
            },
        )
    )["connection"]

    agent = _ok(
        owner(
            "POST",
            "/channels/agents/",
            json={
                "agent": {
                    "connection_id": connection["id"],
                    "slug": f"agent-{slug}",
                    "data": {"references": {"workflow_revision": {"id": str(uuid4())}}},
                }
            },
        )
    )["agent"]
    _ok(owner("POST", f"/channels/agents/{agent['id']}/default"))

    space = _ok(
        owner(
            "POST",
            "/channels/spaces/",
            json={
                "space": {
                    "connection_id": connection["id"],
                    "kind": "private",
                    "external_key": str(uuid4()),
                    "data": {"external_locator": {"user": "seeded-user"}},
                }
            },
        )
    )["space"]

    grant = _ok(
        owner(
            "POST",
            "/channels/grants/",
            json={
                "grant": {
                    "agent_id": agent["id"],
                    "effect": "allow",
                    "space_id": space["id"],
                    "data": {},
                }
            },
        )
    )["grant"]

    project_id = connection["data"]["connection_locator"]["project"]
    _ok(
        owner(
            "POST",
            "/channels/agenta/events/",
            json={
                "project": project_id,
                "bot": slug,
                "user": "seeded-user",
                "id": f"msg-{uuid4().hex[:8]}",
                "text": "seeded message",
            },
        ),
        status=202,
    )

    inbox = _poll(
        lambda: _ok(owner("POST", "/channels/inbox/events/query", json={}))["events"]
    )
    threads = _poll(
        lambda: _ok(owner("POST", "/channels/threads/query", json={}))["threads"]
    )
    outbox = _poll(
        lambda: _ok(owner("POST", "/channels/outbox/events/query", json={}))["events"]
    )
    assert inbox and threads and outbox, (
        "seeding did not produce an inbox event, a thread and an outbox event: "
        f"inbox={len(inbox)} threads={len(threads)} outbox={len(outbox)}"
    )

    return {
        "project_id": project_id,
        "slug": slug,
        "connection": connection,
        "agent": agent,
        "space": space,
        "grant": grant,
        "inbox_ids": {event["id"] for event in inbox},
        "thread": threads[0],
        "outbox_ids": {event["id"] for event in outbox},
    }


@pytest.fixture(scope="module")
def world(ag_env, admin_api):
    api_url = ag_env["api_url"]
    uid = uuid4().hex[:12]
    emails = {
        "owner": f"channels-perm-owner-{uid}@test.agenta.ai",
        "viewer": f"channels-perm-viewer-{uid}@test.agenta.ai",
        "other": f"channels-perm-other-{uid}@test.agenta.ai",
    }
    created = []

    try:
        owner_account = _create_account(
            admin_api, email=emails["owner"], plan=_RBAC_PLAN
        )
        created.append(emails["owner"])
        viewer_account = _create_account(admin_api, email=emails["viewer"])
        created.append(emails["viewer"])
        other_account = _create_account(
            admin_api, email=emails["other"], plan=_RBAC_PLAN
        )
        created.append(emails["other"])

        owner_project_id = _first_id(owner_account["projects"])
        _add_viewer(
            admin_api,
            organization_id=_first_id(owner_account["organizations"]),
            workspace_id=_first_id(owner_account["workspaces"]),
            project_id=owner_project_id,
            user_id=viewer_account["user"]["id"],
        )
        viewer_key = _mint_key(
            admin_api,
            project_id=owner_project_id,
            user_id=viewer_account["user"]["id"],
        )

        owner = _client(api_url, owner_account["api_keys"]["key"])
        viewer = _client(api_url, viewer_key)
        other = _client(api_url, other_account["api_keys"]["key"])

        seeded = _seed(owner)
        hosted = _probe_hosted_config(owner, connection_id=seeded["connection"]["id"])
        assert seeded["project_id"] == owner_project_id

        yield {
            "owner": owner,
            "viewer": viewer,
            "other": other,
            "other_project_id": _first_id(other_account["projects"]),
            "hosted": hosted,
            **seeded,
        }
    finally:
        for email in created:
            _delete_account(admin_api, email=email)


# --------------------------------------------------------------------------- #
# Route table
#
# Each entry: (operation_id, method, path, json body or None, query params).
# Paths and bodies are templates over the seeded world; a write carries a
# body that validates, so a 403/404 is the handler's answer, never a 422.
# --------------------------------------------------------------------------- #


_TELEGRAM_HOSTED_OFF = "The hosted Telegram bot is not configured"


def _probe_hosted_config(owner, *, connection_id):
    """Which optional hosted integrations this deployment runs. The catalog
    lists every adapter whether or not its hosted app is configured, so the
    owner's own call to a hosted route is the only wire-level answer: 404
    with the not-configured detail means off.

    Only the hosted Telegram bindings read depends on it. Every other hosted
    route (Slack install, Telegram bind link) checks EDIT_CHANNELS before its
    configuration, so a viewer's 403 holds either way, and the Slack callback
    is public and out of scope here."""

    resp = owner(
        "GET",
        "/channels/catalog/channels/telegram_hosted/bindings/",
        params={"connection_id": connection_id},
    )
    if resp.status_code == 200:
        return {"telegram_hosted": True}
    assert resp.status_code == 404 and _TELEGRAM_HOSTED_OFF in resp.text, (
        f"unexpected hosted Telegram probe answer: {resp.status_code} {resp.text}"
    )
    return {"telegram_hosted": False}


# Read routes that answer 404 for every caller when the named hosted
# integration is not configured on the deployment.
_HOSTED_ONLY_READS = {"list_telegram_hosted_bindings": "telegram_hosted"}


def _read_is_off(w, operation_id):
    integration = _HOSTED_ONLY_READS.get(operation_id)
    return integration is not None and not w["hosted"][integration]


def _assert_off(resp, operation_id):
    """A read of an unconfigured hosted integration: a 404 naming the missing
    configuration, never a 200 carrying rows."""

    assert resp.status_code == 404 and _TELEGRAM_HOSTED_OFF in resp.text, (
        f"{operation_id} with hosted Telegram off: {resp.status_code} {resp.text}"
    )


def _reads(w):
    connection_id = w["connection"]["id"]
    agent_id = w["agent"]["id"]
    space_id = w["space"]["id"]
    return [
        ("list_channels", "GET", "/channels/catalog/channels/", None, None),
        (
            "fetch_channel_capabilities",
            "GET",
            "/channels/catalog/channels/agenta/capabilities/",
            None,
            None,
        ),
        (
            "list_telegram_hosted_bindings",
            "GET",
            "/channels/catalog/channels/telegram_hosted/bindings/",
            None,
            {"connection_id": connection_id},
        ),
        ("query_channel_connections", "POST", "/channels/connections/query", {}, None),
        ("list_channel_agents", "GET", "/channels/agents/", None, None),
        ("query_channel_agents", "POST", "/channels/agents/query", {}, None),
        ("fetch_channel_agent", "GET", f"/channels/agents/{agent_id}", None, None),
        ("list_channel_spaces", "GET", "/channels/spaces/", None, None),
        ("query_channel_spaces", "POST", "/channels/spaces/query", {}, None),
        (
            "discover_channel_spaces",
            "POST",
            "/channels/spaces/discover",
            {"connection_id": connection_id},
            None,
        ),
        ("fetch_channel_space", "GET", f"/channels/spaces/{space_id}", None, None),
        ("list_channel_grants", "GET", "/channels/grants/", None, None),
        ("query_channel_grants", "POST", "/channels/grants/query", {}, None),
        (
            "resolve_channel_policy",
            "POST",
            "/channels/policy/resolve",
            {"agent_id": agent_id, "space_id": space_id},
            None,
        ),
        ("query_channel_threads", "POST", "/channels/threads/query", {}, None),
        (
            "query_channel_inbox_events",
            "POST",
            "/channels/inbox/events/query",
            {},
            None,
        ),
        (
            "query_channel_outbox_events",
            "POST",
            "/channels/outbox/events/query",
            {},
            None,
        ),
        (
            "read_agenta_conversation",
            "GET",
            f"/channels/agenta/conversations/{space_id}",
            None,
            None,
        ),
    ]


def _writes(w):
    connection_id = w["connection"]["id"]
    agent_id = w["agent"]["id"]
    space_id = w["space"]["id"]
    grant_id = w["grant"]["id"]
    thread_id = w["thread"]["id"]
    references = {"workflow_revision": {"id": str(uuid4())}}
    return [
        (
            "fetch_channel_setup",
            "GET",
            "/channels/catalog/channels/slack/setup/",
            None,
            None,
        ),
        (
            "install_slack_connection",
            "GET",
            "/channels/catalog/channels/slack/install/",
            None,
            None,
        ),
        (
            "create_telegram_hosted_bind_link",
            "POST",
            "/channels/catalog/channels/telegram_hosted/bind-link/",
            {"references": references},
            None,
        ),
        (
            "create_channel_connection",
            "POST",
            "/channels/connections/",
            {
                "connection": {
                    "channel": "agenta",
                    "slug": f"intruder-{uuid4().hex[:8]}",
                    "data": {"bot": f"intruder-{uuid4().hex[:8]}"},
                }
            },
            None,
        ),
        (
            "edit_channel_connection",
            "POST",
            f"/channels/connections/{connection_id}/edit",
            {"connection": {"id": connection_id, "name": "renamed by intruder"}},
            None,
        ),
        (
            "archive_channel_connection",
            "POST",
            f"/channels/connections/{connection_id}/archive",
            None,
            None,
        ),
        (
            "unarchive_channel_connection",
            "POST",
            f"/channels/connections/{connection_id}/unarchive",
            None,
            None,
        ),
        (
            "fetch_channel_connection_setup",
            "GET",
            f"/channels/connections/{connection_id}/setup",
            None,
            None,
        ),
        (
            "create_channel_agent",
            "POST",
            "/channels/agents/",
            {
                "agent": {
                    "connection_id": connection_id,
                    "slug": f"intruder-{uuid4().hex[:8]}",
                    "data": {"references": references},
                }
            },
            None,
        ),
        (
            "edit_channel_agent",
            "PUT",
            f"/channels/agents/{agent_id}",
            {"agent": {"id": agent_id, "name": "renamed by intruder"}},
            None,
        ),
        (
            "set_channel_agent_default",
            "POST",
            f"/channels/agents/{agent_id}/default",
            None,
            None,
        ),
        ("delete_channel_agent", "DELETE", f"/channels/agents/{agent_id}", None, None),
        (
            "create_channel_space",
            "POST",
            "/channels/spaces/",
            {
                "space": {
                    "connection_id": connection_id,
                    "kind": "private",
                    "external_key": str(uuid4()),
                    "data": {"external_locator": {"user": "intruder"}},
                }
            },
            None,
        ),
        (
            "edit_channel_space",
            "PUT",
            f"/channels/spaces/{space_id}",
            {
                "space": {
                    "id": space_id,
                    "name": "renamed by intruder",
                    "data": {"external_locator": {"user": "intruder"}},
                }
            },
            None,
        ),
        ("delete_channel_space", "DELETE", f"/channels/spaces/{space_id}", None, None),
        (
            "create_channel_grant",
            "POST",
            "/channels/grants/",
            {
                "grant": {
                    "agent_id": agent_id,
                    "effect": "deny",
                    "space_id": space_id,
                    "data": {},
                }
            },
            None,
        ),
        (
            "edit_channel_grant",
            "PUT",
            f"/channels/grants/{grant_id}",
            {"grant": {"id": grant_id, "name": "renamed by intruder", "data": {}}},
            None,
        ),
        (
            "set_channel_grant_default",
            "POST",
            f"/channels/grants/{grant_id}/default",
            None,
            None,
        ),
        ("delete_channel_grant", "DELETE", f"/channels/grants/{grant_id}", None, None),
        (
            "close_channel_thread",
            "POST",
            f"/channels/threads/{thread_id}/close",
            None,
            None,
        ),
    ]


# Every authenticated route the channels router registers. The public ingress
# routes and the Slack install callback (authorised by its signed state) are
# covered by their own suites.
_ALL_OPERATIONS = {
    "list_channels",
    "fetch_channel_capabilities",
    "fetch_channel_setup",
    "install_slack_connection",
    "create_telegram_hosted_bind_link",
    "list_telegram_hosted_bindings",
    "create_channel_connection",
    "query_channel_connections",
    "edit_channel_connection",
    "archive_channel_connection",
    "unarchive_channel_connection",
    "fetch_channel_connection_setup",
    "create_channel_agent",
    "list_channel_agents",
    "query_channel_agents",
    "fetch_channel_agent",
    "edit_channel_agent",
    "delete_channel_agent",
    "set_channel_agent_default",
    "create_channel_space",
    "list_channel_spaces",
    "query_channel_spaces",
    "discover_channel_spaces",
    "fetch_channel_space",
    "edit_channel_space",
    "delete_channel_space",
    "create_channel_grant",
    "list_channel_grants",
    "query_channel_grants",
    "edit_channel_grant",
    "delete_channel_grant",
    "set_channel_grant_default",
    "resolve_channel_policy",
    "query_channel_threads",
    "close_channel_thread",
    "query_channel_inbox_events",
    "query_channel_outbox_events",
    "read_agenta_conversation",
}


def _call(client, route):
    _, method, path, body, params = route
    kwargs = {"allow_redirects": False}
    if body is not None:
        kwargs["json"] = body
    if params is not None:
        kwargs["params"] = params
    return client(method, path, **kwargs)


def _owner_rows_unchanged(w):
    """The seeded rows read back exactly as seeded: nothing was renamed,
    archived, deleted, un-defaulted or closed."""

    owner = w["owner"]

    connections = _ok(owner("POST", "/channels/connections/query", json={}))
    assert [c["id"] for c in connections["connections"]] == [w["connection"]["id"]]
    connection = connections["connections"][0]
    assert connection["name"] == w["connection"]["name"]
    assert connection["flags"]["is_active"] is True

    agents = _ok(owner("GET", "/channels/agents/"))["agents"]
    assert [a["id"] for a in agents] == [w["agent"]["id"]]
    assert agents[0]["flags"]["is_default"] is True
    assert agents[0].get("name") == w["agent"].get("name")

    spaces = _ok(owner("GET", "/channels/spaces/"))["spaces"]
    assert [s["id"] for s in spaces] == [w["space"]["id"]]
    assert spaces[0].get("name") == w["space"].get("name")

    grants = _ok(owner("GET", "/channels/grants/"))["grants"]
    assert [g["id"] for g in grants] == [w["grant"]["id"]]
    assert grants[0]["flags"].get("is_default") is not True

    threads = _ok(owner("POST", "/channels/threads/query", json={}))["threads"]
    thread = next(t for t in threads if t["id"] == w["thread"]["id"])
    assert thread["flags"].get("is_active") == w["thread"]["flags"].get("is_active")


def test_route_table_covers_every_authenticated_route(world):
    listed = {route[0] for route in _reads(world) + _writes(world)}
    assert listed == _ALL_OPERATIONS


# --------------------------------------------------------------------------- #
# Viewer: reads 200, writes 403
# --------------------------------------------------------------------------- #


class TestViewerRole:
    def test_viewer_reads_every_read_route(self, world):
        failures = []
        for route in _reads(world):
            resp = _call(world["viewer"], route)
            if _read_is_off(world, route[0]):
                _assert_off(resp, route[0])
                continue
            if resp.status_code != 200:
                failures.append(f"{route[0]}: {resp.status_code} {resp.text[:200]}")
        assert not failures, "viewer was refused a read:\n" + "\n".join(failures)

    def test_viewer_reads_see_the_seeded_rows(self, world):
        viewer = world["viewer"]
        agents = _ok(viewer("GET", "/channels/agents/"))["agents"]
        assert [a["id"] for a in agents] == [world["agent"]["id"]]
        inbox = _ok(viewer("POST", "/channels/inbox/events/query", json={}))["events"]
        assert {e["id"] for e in inbox} == world["inbox_ids"]

    def test_viewer_is_forbidden_every_write_route(self, world):
        failures = []
        for route in _writes(world):
            resp = _call(world["viewer"], route)
            if resp.status_code != 403:
                failures.append(f"{route[0]}: {resp.status_code} {resp.text[:200]}")
        assert not failures, "viewer was not refused a write:\n" + "\n".join(failures)

        _owner_rows_unchanged(world)

    def test_viewer_key_cannot_drive_the_agent_through_the_agenta_channel(self, world):
        """Posting to the agenta channel runs the bound agent -- the runtime
        side of channels, which a viewer does not hold."""

        resp = world["viewer"](
            "POST",
            "/channels/agenta/events/",
            json={
                "project": world["project_id"],
                "bot": world["slug"],
                "user": "viewer-user",
                "id": f"msg-{uuid4().hex[:8]}",
                "text": "a viewer trying to run the agent",
            },
        )
        assert resp.status_code in (401, 403), resp.text

        inbox = _ok(world["owner"]("POST", "/channels/inbox/events/query", json={}))[
            "events"
        ]
        assert {e["id"] for e in inbox} == world["inbox_ids"]


# --------------------------------------------------------------------------- #
# Another project's key: never sees or changes this project's rows
# --------------------------------------------------------------------------- #


# A foreign key names this project's ids; the handler scopes by the key's own
# project, so every by-id route answers "not found".
_FOREIGN_BY_ID = {
    "fetch_channel_agent",
    "fetch_channel_space",
    "discover_channel_spaces",
    "resolve_channel_policy",
    "read_agenta_conversation",
    "edit_channel_connection",
    "archive_channel_connection",
    "unarchive_channel_connection",
    "fetch_channel_connection_setup",
    "create_channel_agent",
    "edit_channel_agent",
    "set_channel_agent_default",
    "delete_channel_agent",
    "create_channel_space",
    "edit_channel_space",
    "delete_channel_space",
    "create_channel_grant",
    "edit_channel_grant",
    "set_channel_grant_default",
    "delete_channel_grant",
    "close_channel_thread",
}

# Collection reads answer 200 for the key's own (empty) project.
_FOREIGN_COLLECTIONS = {
    "query_channel_connections": "connections",
    "list_channel_agents": "agents",
    "query_channel_agents": "agents",
    "list_channel_spaces": "spaces",
    "query_channel_spaces": "spaces",
    "list_channel_grants": "grants",
    "query_channel_grants": "grants",
    "query_channel_threads": "threads",
    "query_channel_inbox_events": "events",
    "query_channel_outbox_events": "events",
    "list_telegram_hosted_bindings": "bindings",
}


def _owner_ids(w):
    return {
        w["connection"]["id"],
        w["agent"]["id"],
        w["space"]["id"],
        w["grant"]["id"],
        w["thread"]["id"],
        *w["inbox_ids"],
        *w["outbox_ids"],
    }


class TestOtherProject:
    def test_other_project_by_id_routes_are_not_found(self, world):
        routes = [r for r in _reads(world) + _writes(world) if r[0] in _FOREIGN_BY_ID]
        assert {r[0] for r in routes} == _FOREIGN_BY_ID

        failures = []
        for route in routes:
            resp = _call(world["other"], route)
            if resp.status_code not in (403, 404):
                failures.append(f"{route[0]}: {resp.status_code} {resp.text[:200]}")
        assert not failures, (
            "another project's key reached this project's rows:\n" + "\n".join(failures)
        )

        _owner_rows_unchanged(world)

    def test_other_project_collections_hold_none_of_this_projects_rows(self, world):
        owner_ids = _owner_ids(world)
        routes = [r for r in _reads(world) if r[0] in _FOREIGN_COLLECTIONS]
        assert {r[0] for r in routes} == set(_FOREIGN_COLLECTIONS)

        for route in routes:
            resp = _call(world["other"], route)
            if _read_is_off(world, route[0]):
                _assert_off(resp, route[0])
                continue
            assert resp.status_code == 200, f"{route[0]}: {resp.text}"
            rows = resp.json().get(_FOREIGN_COLLECTIONS[route[0]]) or []
            leaked = {row.get("id") for row in rows} & owner_ids
            assert not rows, f"{route[0]} returned rows: {leaked or rows}"

    def test_other_project_key_cannot_select_this_project_by_query_param(self, world):
        """The key is scoped to its own project; naming another project in
        the query string must not switch it."""

        owner_ids = _owner_ids(world)
        params = {"project_id": world["project_id"]}
        for method, path, key in [
            ("GET", "/channels/agents/", "agents"),
            ("GET", "/channels/spaces/", "spaces"),
            ("GET", "/channels/grants/", "grants"),
        ]:
            resp = world["other"](method, path, params=params)
            if resp.status_code == 200:
                rows = resp.json().get(key) or []
                assert not ({row["id"] for row in rows} & owner_ids), (
                    f"{path}?project_id=<owner> leaked {rows}"
                )
            else:
                assert resp.status_code in (401, 403, 404), resp.text

        for method, path, key in [
            ("POST", "/channels/connections/query", "connections"),
            ("POST", "/channels/inbox/events/query", "events"),
        ]:
            resp = world["other"](method, path, params=params, json={})
            if resp.status_code == 200:
                rows = resp.json().get(key) or []
                assert not ({row["id"] for row in rows} & owner_ids), rows
            else:
                assert resp.status_code in (401, 403, 404), resp.text

        resp = world["other"](
            "GET", f"/channels/agents/{world['agent']['id']}", params=params
        )
        assert resp.status_code in (401, 403, 404), resp.text

    def test_other_project_key_cannot_post_into_this_projects_connection(self, world):
        """The agenta channel authenticates the poster by API key; a key from
        another project that names this project's connection is refused and
        records nothing here."""

        resp = world["other"](
            "POST",
            "/channels/agenta/events/",
            json={
                "project": world["project_id"],
                "bot": world["slug"],
                "user": "intruder",
                "id": f"msg-{uuid4().hex[:8]}",
                "text": "posted from another project",
            },
        )
        assert resp.status_code in (401, 403), resp.text

        inbox = _ok(world["owner"]("POST", "/channels/inbox/events/query", json={}))[
            "events"
        ]
        assert {e["id"] for e in inbox} == world["inbox_ids"]

    def test_other_project_grant_cannot_reference_this_projects_agent(self, world):
        """A grant is the agent's binding to a space. Another project cannot
        write one that names this project's agent or space."""

        other = world["other"]
        resp = other(
            "POST",
            "/channels/grants/",
            json={
                "grant": {
                    "agent_id": world["agent"]["id"],
                    "effect": "allow",
                    "kind": "private",
                    "data": {},
                }
            },
        )
        assert resp.status_code in (403, 404), resp.text
        assert _ok(other("GET", "/channels/grants/"))["grants"] == []
