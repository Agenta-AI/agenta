"""Acceptance tests for the run principal (M2), against a running API.

A run credential (`Secret`) is minted by `GET /access/permissions/check` and refreshed
by calling the same exchange with it. Each exchange decides again for the credential's
principal, so a deleted key or a removed member is refused at the next refresh, even
when the caches are warm.

Not covered here (unit and integration tests cover them): browser-session and channel
installation principals, the approver of a resumed approval, and the pause of a schedule
whose key is deleted (it happens at the schedule's next tick).
"""

from uuid import uuid4

import pytest


EXCHANGE = "/access/permissions/check"


def _first_id(values):
    return next(iter(values.values()))["id"]


def _create_account(admin_api, *, email):
    response = admin_api(
        "POST",
        "/admin/simple/accounts/",
        json={
            "accounts": {
                "u": {
                    "user": {"email": email},
                    "options": {
                        "create_api_keys": True,
                        "return_api_keys": True,
                        "seed_defaults": False,
                    },
                }
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["accounts"]["u"]


def _delete_account(admin_api, *, email):
    admin_api(
        "DELETE",
        "/admin/simple/accounts/",
        json={"accounts": {"u": {"user": {"email": email}}}, "confirm": "delete"},
    )


def _add_member(admin_api, *, organization_id, project_id, user_id, role):
    response = admin_api(
        "POST",
        "/admin/simple/accounts/organizations/memberships/",
        json={
            "membership": {
                "organization_ref": {"id": organization_id},
                "user_ref": {"id": user_id},
                "role": role,
            }
        },
    )
    assert response.status_code == 200, response.text
    organization_membership = next(
        iter(response.json()["accounts"][0]["organization_memberships"].values())
    )["id"]
    response = admin_api(
        "POST",
        "/admin/simple/accounts/projects/memberships/",
        json={
            "membership": {
                "project_ref": {"id": project_id},
                "user_ref": {"id": user_id},
                "role": role,
            }
        },
    )
    assert response.status_code == 200, response.text
    project_membership = next(
        iter(response.json()["accounts"][0]["project_memberships"].values())
    )["id"]
    return organization_membership, project_membership


def _remove_member(admin_api, team):
    """The owner removes the member through the workspace route (the membership
    writer clears the caches after its commit)."""

    response = admin_api(
        "DELETE",
        f"/workspaces/{team['workspace_id']}/users/",
        params={
            "email": team["member_email"],
            "project_id": team["project_id"],
            "organization_id": team["organization_id"],
        },
        headers={"Authorization": team["owner_key"]},
    )
    assert response.status_code == 200, response.text


def _change_role(admin_api, team, *, role):
    response = admin_api(
        "POST",
        f"/workspaces/{team['workspace_id']}/roles/",
        params={"project_id": team["project_id"]},
        json={
            "email": team["member_email"],
            "role": role,
            "organization_id": team["organization_id"],
        },
        headers={"Authorization": team["owner_key"]},
    )
    assert response.status_code == 200, response.text


def _project_key(admin_api, *, project_id, user_id):
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
    key = next(iter(response.json()["accounts"][0]["api_keys"].values()))
    return key["value"], key["id"]


def _exchange(admin_api, credentials, *, action="run_service", **params):
    return admin_api(
        "GET",
        EXCHANGE,
        params={"action": action, "resource_type": "service", **params},
        headers={"Authorization": credentials},
    )


def _secret(admin_api, credentials, **kwargs):
    response = _exchange(admin_api, credentials, **kwargs)
    assert response.status_code == 200, response.text
    credential = response.json()["credentials"]
    assert credential.startswith("Secret ")
    return credential


def _gateway_credentials(admin_api, credentials):
    return admin_api(
        "POST",
        "/gateways/credentials",
        json={},
        headers={"Authorization": credentials},
    )


@pytest.fixture
def team(admin_api):
    """An owner, and a second user who is an editor in the owner's project with a key
    scoped to that project."""

    uid = uuid4().hex[:12]
    owner_email = f"m2-owner-{uid}@test.agenta.ai"
    member_email = f"m2-member-{uid}@test.agenta.ai"
    owner = _create_account(admin_api, email=owner_email)
    member = _create_account(admin_api, email=member_email)
    organization_id = _first_id(owner["organizations"])
    project_id = _first_id(owner["projects"])
    member_id = member["user"]["id"]
    _add_member(
        admin_api,
        organization_id=organization_id,
        project_id=project_id,
        user_id=member_id,
        role="editor",
    )
    key, key_id = _project_key(admin_api, project_id=project_id, user_id=member_id)
    try:
        yield {
            "owner_key": f"ApiKey {owner['api_keys']['key']}",
            "member_key": f"ApiKey {key}",
            "member_key_id": key_id,
            "member_id": member_id,
            "organization_id": organization_id,
            "project_id": project_id,
            "workspace_id": _first_id(owner["workspaces"]),
            "member_email": member_email,
        }
    finally:
        _delete_account(admin_api, email=member_email)
        _delete_account(admin_api, email=owner_email)


class TestRunPrincipal:
    def test_key_runs_keep_the_principal(self, admin_api, team):
        # Each step twice: the second call runs on warm caches.
        for _ in range(2):
            secret = _secret(admin_api, team["member_key"])
        for _ in range(2):
            secret = _secret(admin_api, secret)
        for _ in range(2):
            response = _gateway_credentials(admin_api, secret)
            assert response.status_code == 200, response.text
            assert response.json()["credentials"].startswith("Secret ")
        projects = admin_api("GET", "/projects/", headers={"Authorization": secret})
        assert projects.status_code == 200, projects.text

    def test_key_deletion_is_refused_at_next_refresh(self, admin_api, team):
        secret = _secret(admin_api, team["member_key"])
        _secret(admin_api, secret)  # warm

        deleted = admin_api(
            "DELETE", f"/admin/simple/accounts/api-keys/{team['member_key_id']}"
        )
        assert deleted.status_code in (200, 204), deleted.text

        assert _exchange(admin_api, secret).status_code == 403
        refused = _gateway_credentials(admin_api, secret)
        assert refused.status_code == 403, refused.text
        assert refused.json()["detail"]["code"] == "access_denied"
        assert refused.json()["detail"]["details"]["reason"] == "principal_inactive"

    def test_membership_removal_is_refused_at_next_refresh(self, admin_api, team):
        secret = _secret(admin_api, team["member_key"])
        _secret(admin_api, secret)  # warm

        _remove_member(admin_api, team)

        assert _exchange(admin_api, secret).status_code == 403
        refused = _gateway_credentials(admin_api, secret)
        assert refused.status_code == 403, refused.text
        assert refused.json()["detail"]["details"]["reason"] == "not_member"

    def test_role_change_is_refused_at_next_refresh(self, admin_api, team):
        secret = _secret(admin_api, team["member_key"], action="edit_workflows")
        _secret(admin_api, secret, action="edit_workflows")  # warm

        _change_role(admin_api, team, role="viewer")

        refused = _exchange(admin_api, secret, action="edit_workflows")
        assert refused.status_code == 403, refused.text
        # The viewer may still do what a viewer may do.
        assert _exchange(admin_api, secret, action="view_workflows").status_code == 200

    def test_run_credential_cannot_leave_its_project(self, admin_api, team):
        secret = _secret(admin_api, team["owner_key"])
        other_project = str(uuid4())

        denied = _exchange(
            admin_api, secret, scope_type="project", scope_id=other_project
        )
        assert denied.status_code == 403, denied.text

        # A project id in the query does not move the credential.
        moved = admin_api(
            "GET",
            "/projects/",
            params={"project_id": other_project},
            headers={"Authorization": secret},
        )
        assert moved.status_code in (401, 403) or all(
            project.get("project_id", project.get("id")) != other_project
            for project in moved.json()
        ), moved.text


def _create_workflow(admin_api, credentials):
    headers = {"Authorization": credentials}
    slug = f"m2-wf-{uuid4().hex[:8]}"
    workflow = admin_api(
        "POST",
        "/workflows/",
        json={"workflow": {"slug": slug, "name": slug}},
        headers=headers,
    )
    assert workflow.status_code == 200, workflow.text
    workflow_id = workflow.json()["workflow"]["id"]
    variant = admin_api(
        "POST",
        "/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"{slug}-v",
                "name": "Default",
                "workflow_id": workflow_id,
            }
        },
        headers=headers,
    )
    assert variant.status_code == 200, variant.text
    commit = admin_api(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": f"{slug}-v1",
                "workflow_id": workflow_id,
                "workflow_variant_id": variant.json()["workflow_variant"]["id"],
                "message": "initial",
            }
        },
        headers=headers,
    )
    assert commit.status_code == 200, commit.text
    return workflow_id


def _create_schedule(admin_api, credentials, *, workflow_id):
    response = admin_api(
        "POST",
        "/triggers/schedules/",
        json={
            "schedule": {
                "name": f"m2-sched-{uuid4().hex[:8]}",
                "data": {
                    "event_key": "cron.tick",
                    "schedule": "0 0 1 1 *",
                    "references": {"workflow": {"id": workflow_id}},
                },
            }
        },
        headers={"Authorization": credentials},
    )
    assert response.status_code == 200, response.text
    return response.json()["schedule"]


class TestSchedulePrincipal:
    def test_key_created_schedule_stores_api_key(self, admin_api, team):
        workflow_id = _create_workflow(admin_api, team["member_key"])
        schedule = _create_schedule(
            admin_api, team["member_key"], workflow_id=workflow_id
        )
        assert schedule["principal"]["kind"] == "api_key"
        assert schedule["artifact_id"] == workflow_id

    def test_archived_agent_pauses_the_schedule(self, admin_api, team):
        workflow_id = _create_workflow(admin_api, team["owner_key"])
        schedule = _create_schedule(
            admin_api, team["owner_key"], workflow_id=workflow_id
        )

        archived = admin_api(
            "POST",
            f"/workflows/{workflow_id}/archive",
            headers={"Authorization": team["owner_key"]},
        )
        assert archived.status_code == 200, archived.text

        fetched = admin_api(
            "GET",
            f"/triggers/schedules/{schedule['id']}",
            headers={"Authorization": team["owner_key"]},
        )
        assert fetched.status_code == 200, fetched.text
        paused = fetched.json()["schedule"]
        assert (paused.get("flags") or {}).get("is_active") is False
        assert (paused.get("meta") or {}).get("paused_reason") == "agent_deleted"

        # Unarchiving does not resume it.
        admin_api(
            "POST",
            f"/workflows/{workflow_id}/unarchive",
            headers={"Authorization": team["owner_key"]},
        )
        again = admin_api(
            "GET",
            f"/triggers/schedules/{schedule['id']}",
            headers={"Authorization": team["owner_key"]},
        ).json()["schedule"]
        assert (again.get("flags") or {}).get("is_active") is False
