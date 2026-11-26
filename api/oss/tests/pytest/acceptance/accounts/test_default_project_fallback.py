"""A signed-in request without `project_id` lands on a project the user may open (EE).

After workspace removal step 2 an organization has one default project. In EE a member
opens only the projects they have a project row on, so a member of another project of the
organization, and of no other organization, must not be refused when the default project
is not one of theirs: `/m` loads the project list without `project_id`, and a 401 there
reads as signed out.
"""

from uuid import uuid4

import pytest
import requests

from oss.src.utils.common import is_ee
from oss.tests.pytest.utils.membership_accounts import (
    create_account,
    delete_account,
    first_id,
    unique_email,
)

pytestmark = pytest.mark.skipif(
    not is_ee(), reason="EE only: OSS members open every project of the organization"
)

TIMEOUT = 60


def _member_without_own_organization(admin_api, *, organization_id, project_id):
    """A user whose only organization is `organization_id`, with a project row on
    `project_id` only (or on no project when `project_id` is None)."""

    email = unique_email("fallback")
    password = f"P-{uuid4().hex}"
    graph = {
        "options": {"create_identities": True, "seed_defaults": False},
        "users": {"u": {"email": email}},
        "user_identities": {
            "i": {
                "user_ref": {"ref": "u"},
                "method": "email:password",
                "subject": email,
                "email": email,
                "password": password,
                "verified": True,
            }
        },
        "organization_memberships": {
            "om": {
                "organization_ref": {"id": organization_id},
                "user_ref": {"ref": "u"},
                "role": "editor",
            }
        },
    }
    if project_id:
        graph["project_memberships"] = {
            "pm": {
                "project_ref": {"id": project_id},
                "user_ref": {"ref": "u"},
                "role": "editor",
            }
        }
    response = admin_api("POST", "/admin/accounts/", json=graph)
    assert response.status_code == 200, response.text
    return email, password


def _sign_in(api_url, *, email, password) -> dict:
    response = requests.post(
        f"{api_url}/auth/signin",
        headers={
            "rid": "emailpassword",
            "st-auth-mode": "header",
            "Content-Type": "application/json",
        },
        json={
            "formFields": [
                {"id": "email", "value": email},
                {"id": "password", "value": password},
            ]
        },
        timeout=TIMEOUT,
    )
    token = response.headers.get("st-access-token")
    assert response.status_code == 200 and token, response.text[:200]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def organization(admin_api):
    owner_email = unique_email("fallback-owner")
    owner = create_account(admin_api, email=owner_email)
    organization_id = first_id(owner["organizations"])
    response = admin_api(
        "POST",
        "/admin/simple/accounts/projects/",
        json={
            "project": {
                "name": f"Second-{uuid4().hex[:6]}",
                "organization_ref": {"id": organization_id},
                # Step 2: the workspace reference answers the organization.
                "workspace_ref": {"id": organization_id},
                "is_default": False,
            }
        },
    )
    assert response.status_code == 200, response.text
    second = first_id(response.json()["accounts"][0]["projects"])
    emails = [owner_email]
    yield organization_id, second, emails
    for email in emails:
        delete_account(admin_api, email=email)


def test_member_of_a_second_project_only_is_not_refused(
    admin_api, ag_env, organization
):
    organization_id, second, emails = organization
    email, password = _member_without_own_organization(
        admin_api, organization_id=organization_id, project_id=second
    )
    emails.append(email)
    headers = _sign_in(ag_env["api_url"], email=email, password=password)

    listed = requests.get(
        f"{ag_env['api_url']}/projects/", headers=headers, timeout=TIMEOUT
    )
    assert listed.status_code == 200, listed.text
    assert [project["project_id"] for project in listed.json()] == [second]

    current = requests.get(
        f"{ag_env['api_url']}/projects/current", headers=headers, timeout=TIMEOUT
    )
    assert current.status_code == 200, current.text
    assert current.json()["project_id"] == second

    # The organization id in place of a workspace id lands on the same project.
    by_organization = requests.get(
        f"{ag_env['api_url']}/projects/current",
        headers=headers,
        params={"workspace_id": organization_id},
        timeout=TIMEOUT,
    )
    assert by_organization.status_code == 200, by_organization.text
    assert by_organization.json()["project_id"] == second


def test_member_without_any_project_is_refused(admin_api, ag_env, organization):
    organization_id, _, emails = organization
    email, password = _member_without_own_organization(
        admin_api, organization_id=organization_id, project_id=None
    )
    emails.append(email)
    headers = _sign_in(ag_env["api_url"], email=email, password=password)

    listed = requests.get(
        f"{ag_env['api_url']}/projects/", headers=headers, timeout=TIMEOUT
    )
    assert listed.status_code == 401, listed.text
