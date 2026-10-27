"""Who may manage organization credentials, and what the routes answer (M5, P3)."""

import pytest
from oss.src.utils.common import is_ee
from oss.tests.pytest.acceptance.organization_secrets.conftest import (
    custom_provider,
    organization_scope,
    provider_key,
    unique,
)

pytestmark = [pytest.mark.acceptance]

KEY = "sk-m5acc-authorization-0123456789"


def _clean(org):
    for secret in org.call("GET", "/secrets/?scope=organization").json():
        org.call("DELETE", f"/secrets/{secret['id']}")


@pytest.mark.parametrize("who", ["owner", "admin"])
def test_owner_and_admin_manage_in_both_editions(org, who):
    slug = unique("openai-company")
    created = org.call(
        "POST",
        "/secrets/",
        as_=who,
        json=organization_scope(provider_key(slug=slug, key=KEY)),
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["owner"] == {"kind": "organization", "id": org.organization_id}
    assert body["write_only"] is True and body["value_status"] == {"configured": True}
    assert KEY not in created.text

    listed = org.call("GET", "/secrets/?scope=organization", as_=who).json()
    assert slug in {s["slug"] for s in listed}
    fetched = org.call("GET", f"/secrets/{body['id']}", as_=who)
    assert fetched.status_code == 200 and KEY not in fetched.text
    edited = org.call(
        "PUT",
        f"/secrets/{body['id']}",
        as_=who,
        json={"header": {"name": "Renamed"}},
    )
    assert edited.status_code == 200 and edited.json()["header"]["name"] == "Renamed"
    assert org.call("DELETE", f"/secrets/{body['id']}", as_=who).status_code == 204
    assert org.call("GET", f"/secrets/{body['id']}", as_=who).status_code == 404


@pytest.mark.parametrize("who", ["editor", "viewer"])
def test_project_roles_are_refused_and_nothing_is_stored(org, who):
    slug = unique("refused")
    response = org.call(
        "POST",
        "/secrets/",
        as_=who,
        json=organization_scope(provider_key(slug=slug, key=KEY)),
    )
    assert response.status_code == 403
    assert org.call("GET", "/secrets/?scope=organization", as_=who).status_code == 403
    assert slug not in {
        s["slug"] for s in org.call("GET", "/secrets/?scope=organization").json()
    }


def test_hobby_editor_is_refused_without_rbac(hobby_org):
    """EE without the RBAC entitlement: the no-RBAC bypass of project checks never applies."""
    slug = unique("hobby")
    response = hobby_org.call(
        "POST",
        "/secrets/",
        as_="editor",
        json=organization_scope(provider_key(slug=slug, key=KEY)),
    )
    assert response.status_code == 403
    owner_list = hobby_org.call("GET", "/secrets/?scope=organization").json()
    assert slug not in {s["slug"] for s in owner_list}


def test_api_key_of_owner_is_refused(org):
    for project in (org.sales, org.marketing):
        response = org.call(
            "GET",
            "/secrets/?scope=organization",
            credentials=org.api_key("owner", project),
            project=project,
        )
        assert response.status_code == 403, response.text
        response = org.call(
            "POST",
            "/secrets/",
            credentials=org.api_key("owner", project),
            project=project,
            json=organization_scope(provider_key(slug=unique("k"), key=KEY)),
        )
        assert response.status_code == 403


def test_run_credential_of_owner_is_refused(org):
    exchanged = org.call(
        "GET",
        "/access/permissions/check",
        params={"action": "run_service", "resource_type": "service"},
        credentials=org.api_key("owner"),
    )
    assert exchanged.status_code == 200, exchanged.text
    secret = exchanged.json()["credentials"]
    assert secret.startswith("Secret ")
    assert (
        org.call("GET", "/secrets/?scope=organization", credentials=secret).status_code
        == 403
    )

    gateway = org.call(
        "POST", "/gateways/credentials", credentials=org.api_key("owner"), json={}
    )
    if gateway.status_code == 200:
        token = gateway.json()["credentials"]
        assert org.call(
            "GET", "/secrets/?scope=organization", credentials=token
        ).status_code in (401, 403)


def test_duplicate_slug_answers_409_and_one_row_exists(org):
    slug = unique("dup")
    assert (
        org.call(
            "POST",
            "/secrets/",
            json=organization_scope(provider_key(slug=slug, key=KEY)),
        ).status_code
        == 200
    )
    assert (
        org.call(
            "POST",
            "/secrets/",
            json=organization_scope(provider_key(slug=slug, key=KEY)),
        ).status_code
        == 409
    )
    rows = [
        s
        for s in org.call("GET", "/secrets/?scope=organization").json()
        if s["slug"] == slug
    ]
    assert len(rows) == 1


@pytest.mark.parametrize(
    "body",
    [
        {
            "header": {"name": "token"},
            "secret": {
                "kind": "custom_secret",
                "data": {"secret": {"format": "text", "content": KEY}},
            },
        },
        custom_provider(slug="bedrock-co", key=KEY, family="bedrock"),
        custom_provider(slug="sagemaker-co", key=KEY, family="sagemaker"),
        provider_key(slug="short-co", key="m5key12"),
        provider_key(slug="padded-co", key="   m5key12   "),
    ],
    ids=["custom_secret", "bedrock", "sagemaker", "short", "padded"],
)
def test_refused_kinds_and_values_answer_422(org, body):
    response = org.call("POST", "/secrets/", json=organization_scope(body))
    assert response.status_code == 422, response.text
    assert KEY not in response.text


def test_an_owner_creates_an_organization_subscription_login_no_editor_does(org):
    """Organization subscription logins (M5): an owner creates one, pending, named with its
    owner and available to all projects; an editor cannot; a browser never reads its login."""
    body = {
        "header": {"description": "company login"},
        "secret": {"kind": "subscription_provider", "data": {"provider": "chatgpt"}},
    }
    refused = org.call("POST", "/secrets/", as_="editor", json=organization_scope(body))
    assert refused.status_code == 403, refused.text

    created = org.call("POST", "/secrets/", json=organization_scope(body))
    assert created.status_code == 200, created.text
    row = created.json()
    try:
        assert row["owner"]["kind"] == "organization"
        assert row["header"]["name"] == "ChatGPT (Organization)"
        assert row["availability"] == "all_projects"
        assert row["data"]["login_state"] == "pending_login"
        # Only the run credential reads the login; a browser session gets 403.
        read = org.call("GET", "/secrets/chatgpt?scope=organization")
        assert read.status_code == 403, read.text
    finally:
        org.call("DELETE", f"/secrets/{row['id']}")


def test_projects_route_limits(org):
    created = org.call(
        "POST",
        "/secrets/",
        json=organization_scope(provider_key(slug=unique("lim"), key=KEY)),
    ).json()
    path = f"/secrets/{created['id']}/projects"
    response = org.call(
        "PUT",
        path,
        json={"availability": "selected_projects", "project_ids": [org.sales]},
    )
    if not is_ee():
        assert response.status_code == 403
        assert (
            org.call("PUT", path, json={"availability": "all_projects"}).status_code
            == 200
        )
        return
    assert response.status_code == 200, response.text
    assert response.json()["selected_project_ids"] == [org.sales]
    foreign = org.call(
        "PUT",
        path,
        json={
            "availability": "selected_projects",
            "project_ids": [org.sales, org.organization_id],
        },
    )
    assert foreign.status_code == 422
    assert org.call("GET", f"/secrets/{created['id']}").json()[
        "selected_project_ids"
    ] == [org.sales]


def test_hobby_owner_cannot_limit(hobby_org):
    created = hobby_org.call(
        "POST",
        "/secrets/",
        json=organization_scope(provider_key(slug=unique("h"), key=KEY)),
    ).json()
    response = hobby_org.call(
        "PUT",
        f"/secrets/{created['id']}/projects",
        json={"availability": "selected_projects", "project_ids": [hobby_org.sales]},
    )
    assert response.status_code == 403


@pytest.mark.parametrize("who", ["owner", "admin"])
def test_owner_and_admin_choose_among_every_project(org, who):
    response = org.call("GET", "/projects/?scope=organization", as_=who)
    assert response.status_code == 200, response.text
    listed = {project["project_id"] for project in response.json()}
    assert {org.sales, org.marketing} <= listed
    assert all(project["user_role"] is None for project in response.json())


@pytest.mark.parametrize("who", ["editor", "viewer"])
def test_project_roles_get_no_organization_project_list(org, who):
    response = org.call("GET", "/projects/?scope=organization", as_=who)
    assert response.status_code == 403


def test_a_project_role_addresses_an_organization_row_as_an_unknown_id(org):
    created = org.call(
        "POST",
        "/secrets/",
        json=organization_scope(provider_key(slug=unique("hidden"), key=KEY)),
    ).json()
    path = f"/secrets/{created['id']}"
    assert org.call("GET", path, as_="editor").status_code == 404
    assert (
        org.call("PUT", path, as_="editor", json={"header": {"name": "x"}}).status_code
        == 404
    )
    assert org.call("DELETE", path, as_="editor").status_code == 204
    assert org.call("GET", path).json()["header"]["name"] == created["header"]["name"]
    org.call("DELETE", path)
