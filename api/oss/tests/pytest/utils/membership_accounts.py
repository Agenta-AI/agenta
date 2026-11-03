"""Accounts and memberships for the membership acceptance tests, through the admin API.

Members get an organization row and a project row with the same role, so a test checks
the role and not `not_member`. In EE the owner's organization is pinned to a plan with
the RBAC entitlement, so role checks apply.
"""

from uuid import uuid4

from oss.src.utils.common import is_ee


RBAC_PLAN = "cloud_v0_business"

PERMISSION_DENIED = (
    "You do not have permission to perform this action. "
    "Please contact your Organization Owner"
)


def unique_email(label: str) -> str:
    return f"m1-{label}-{uuid4().hex[:12]}@test.agenta.ai"


def create_account(admin_api, *, email: str) -> dict:
    account = {
        "user": {"email": email},
        "options": {
            "create_api_keys": True,
            "return_api_keys": True,
            "seed_defaults": True,
        },
    }
    if is_ee():
        account["subscription"] = {"plan": RBAC_PLAN}
    resp = admin_api(
        "POST", "/admin/simple/accounts/", json={"accounts": {"u": account}}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["accounts"]["u"]


def delete_account(admin_api, *, email: str) -> None:
    resp = admin_api(
        "DELETE",
        "/admin/simple/accounts/",
        json={"accounts": {"u": {"user": {"email": email}}}, "confirm": "delete"},
    )
    assert resp.status_code == 204, resp.text


def first_id(values: dict) -> str:
    return next(iter(values.values()))["id"]


def owner_key(account: dict) -> str:
    return account["api_keys"]["key"]


def add_organization_member(admin_api, *, organization_id, user_id, role) -> None:
    resp = admin_api(
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
    assert resp.status_code == 200, resp.text


def add_project_member(admin_api, *, project_id, user_id, role) -> None:
    resp = admin_api(
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
    assert resp.status_code == 200, resp.text


def api_key_for_project(admin_api, *, project_id, user_id) -> str:
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


def headers(key: str) -> dict:
    return {"Authorization": f"ApiKey {key}"}


class Team:
    """An owner's organization plus members (label -> role), each with an API key
    scoped to the owner's default project."""

    def __init__(self, admin_api, *, members: dict):
        self.admin_api = admin_api
        self.emails = {"owner": unique_email("owner")}
        self.owner = create_account(admin_api, email=self.emails["owner"])
        self.organization_id = first_id(self.owner["organizations"])
        self.workspace_id = first_id(self.owner["workspaces"])
        self.project_id = first_id(self.owner["projects"])
        self.keys = {"owner": owner_key(self.owner)}
        self.user_ids = {"owner": self.owner["user"]["id"]}
        for label, role in members.items():
            self.add(label, role)

    def add(self, label: str, role: str, *, project_row: bool = True) -> None:
        email = unique_email(label)
        account = create_account(self.admin_api, email=email)
        user_id = account["user"]["id"]
        self.emails[label] = email
        self.user_ids[label] = user_id
        add_organization_member(
            self.admin_api,
            organization_id=self.organization_id,
            user_id=user_id,
            role=role,
        )
        if project_row:
            add_project_member(
                self.admin_api, project_id=self.project_id, user_id=user_id, role=role
            )
        self.keys[label] = api_key_for_project(
            self.admin_api, project_id=self.project_id, user_id=user_id
        )

    def headers(self, label: str) -> dict:
        return headers(self.keys[label])

    def delete(self) -> None:
        for email in self.emails.values():
            delete_account(self.admin_api, email=email)
