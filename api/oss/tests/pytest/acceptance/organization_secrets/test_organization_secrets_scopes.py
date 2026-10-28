"""Organization connections end to end: project lists, project routes, the LLM gateway
with the mock LLM when an agent names an organization connection by scope, custom
providers, echo refusals, pinned references and the EE limit (M5). An agent that names no
connection, or a project connection, never uses an organization row. Needs the LLM gateway
on the deployment."""

from uuid import uuid4

import pytest
import requests
from oss.src.utils.common import is_ee
from oss.tests.pytest.acceptance.organization_secrets.conftest import (
    BASE_TIMEOUT,
    MOCK_LLM_URL,
    MOCK_UPSTREAM_TOKEN,
    custom_provider,
    llm_gateway_disabled,
    organization_scope,
    provider_key,
    unique,
)

pytestmark = [pytest.mark.acceptance]

KEY = "sk-m5acc-inherit-0123456789abcdef"
ROLES = ["owner", "admin", "editor", "viewer"]


@pytest.fixture(scope="module")
def company(org):
    """An organization OpenAI key (never sent upstream) for the redaction cases."""
    created = org.call(
        "POST",
        "/secrets/",
        json=organization_scope(provider_key(slug=unique("openai-company"), key=KEY)),
    )
    assert created.status_code == 200, created.text
    return created.json()


@pytest.fixture(scope="module")
def gateway_off(org) -> bool:
    return llm_gateway_disabled(org)


@pytest.fixture(scope="module")
def company_login(org):
    """An organization ChatGPT login (never signed in). Listed with the gateway on or off:
    a login runs without the gateway, an organization key does not."""
    created = org.call(
        "POST",
        "/secrets/",
        json=organization_scope(
            {
                "header": {},
                "secret": {
                    "kind": "subscription_provider",
                    "data": {"provider": "chatgpt"},
                },
            }
        ),
    )
    assert created.status_code == 200, created.text
    return created.json()


def _relay(
    org,
    path,
    *,
    as_="editor",
    project=None,
    model="mock/echo",
    content="hello",
    stream=False,
):
    return requests.post(
        f"{org.api_url}{path}/chat/completions",
        headers={"X-AG-Credentials": org.api_key(as_, project or org.marketing)},
        json={
            "model": model,
            "stream": stream,
            "messages": [{"role": "user", "content": content}],
        },
        timeout=BASE_TIMEOUT,
    )


def _resolve(org, *, slug, project=None, scope="organization"):
    return org.call(
        "POST",
        "/gateways/llms/resolve",
        credentials=org.api_key("editor", project or org.marketing),
        project=project or org.marketing,
        json={"model": "mock/echo", "connection_slug": slug, "connection_scope": scope},
    )


# -- project lists and project routes -------------------------------------------------


@pytest.mark.parametrize("who", ROLES)
def test_organization_list_carries_names_and_status_never_the_value(
    org, company, company_login, gateway_off, who
):
    response = org.call(
        "GET",
        "/secrets/",
        as_=who,
        project=org.marketing,
        params={"include_organization": "true"},
    )
    assert response.status_code == 200, response.text
    rows = {row["id"]: row for row in response.json()}
    assert KEY not in response.text
    # With the gateway off, an organization key is not offered (it could not run); the
    # login is, and carries the same listing shape.
    shown = company_login if gateway_off else company
    if gateway_off:
        assert company["id"] not in rows
    row = rows[shown["id"]]
    assert row["owner"]["kind"] == "organization"
    assert row["slug"] == shown["slug"]
    assert row["header"]["name"] == shown["header"]["name"]
    assert "availability" not in row and "selected_project_ids" not in row
    if not gateway_off:
        assert row["data"]["kind"] == "openai"
        assert row["value_status"] == {"configured": True}

    plain = org.call("GET", "/secrets/", as_=who, project=org.marketing)
    plain_ids = {row["id"] for row in plain.json()}
    assert company["id"] not in plain_ids and company_login["id"] not in plain_ids


def test_no_route_returns_an_organization_value(org, company):
    """The sweep: every secrets-returning route, every role, the owner's API key and a run
    credential with the resolve grant."""
    exchanged = org.call(
        "GET",
        "/access/permissions/check",
        params={"action": "run_service", "resource_type": "service"},
        credentials=org.api_key("owner"),
    ).json()["credentials"]
    callers = [dict(as_=who) for who in ROLES] + [
        dict(credentials=org.api_key("owner")),
        dict(credentials=org.api_key("editor")),
        dict(credentials=exchanged),
    ]
    paths = [
        ("GET", "/secrets/", {}),
        ("GET", "/secrets/", {"include_organization": "true"}),
        ("GET", f"/secrets/{company['id']}", {}),
        ("GET", f"/secrets/{company['slug']}", {}),
        ("GET", "/secrets/?scope=organization", {}),
        ("GET", f"/secrets/{company['id']}?scope=organization", {}),
        ("GET", f"/secrets/{company['slug']}?scope=organization", {}),
        ("GET", "/gateways/llms/endpoints/", {}),
    ]
    for caller in callers:
        for method, path, params in paths:
            response = org.call(method, path, params=params, **caller)
            assert KEY not in response.text, (caller.keys(), path)
            assert KEY[:20] not in response.text


def test_project_roles_do_not_touch_organization_rows(org, company):
    # Status quo for project roles: an editor's delete of an id that is not a project row
    # answers 204 and deletes nothing (the row is checked below); a viewer may not write.
    for who, delete, edit in (("editor", 204, 404), ("viewer", 403, 403)):
        path = f"/secrets/{company['id']}"
        assert org.call("DELETE", path, as_=who).status_code == delete
        assert (
            org.call("PUT", path, as_=who, json={"header": {"name": "x"}}).status_code
            == edit
        )
        assert org.call("GET", path, as_=who).status_code == 404
    for who in ("editor", "admin", "owner"):
        # A slug names a project row only.
        assert (
            org.call("GET", f"/secrets/{company['slug']}", as_=who).status_code == 404
        )
    stored = org.call("GET", f"/secrets/{company['id']}?scope=organization").json()
    assert stored["header"]["name"] == company["header"]["name"]


def test_a_project_row_may_reuse_an_organization_slug(org, company):
    """Two slug spaces: a project connection with an organization connection's slug, of
    another kind or family, is created, and the organization row is unchanged."""
    response = org.call(
        "POST",
        "/secrets/",
        as_="editor",
        json=provider_key(slug=company["slug"], key=KEY, family="anthropic"),
    )
    assert response.status_code == 200, response.text
    try:
        stored = org.call("GET", f"/secrets/{company['id']}?scope=organization").json()
        assert stored["data"]["kind"] == "openai"
    finally:
        org.call("DELETE", f"/secrets/{response.json()['id']}", as_="editor")


# -- the LLM gateway with the mock LLM ----------------------------------------------


@pytest.fixture(scope="module")
def company_mock(org):
    slug = unique("mock-company")
    created = org.call(
        "POST",
        "/secrets/",
        json=organization_scope(
            provider_key(slug=slug, key=MOCK_UPSTREAM_TOKEN, family="mock")
        ),
    )
    assert created.status_code == 200, created.text
    return created.json()


def test_the_gateway_uses_an_organization_key_only_when_named(
    org, company_mock, gateway_on
):
    # Marketing has no key of its own: the unnamed call does NOT use the company key.
    assert _relay(org, "/gateways/llms/standard/mock/v1").status_code != 200
    # A project slug never reaches it either.
    assert _resolve(org, slug=company_mock["slug"], scope="project").status_code == 404
    # Named by scope `organization`, it routes in the organization namespace.
    resolved = _resolve(org, slug=company_mock["slug"])
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["connection"]["namespace"] == "organization"
    response = _relay(org, f"/gateways/llms/organization/{company_mock['slug']}/v1")
    assert response.status_code == 200, response.text


def test_a_missing_organization_connection_is_a_typed_404(org, gateway_on):
    response = _resolve(org, slug=unique("no-such"))
    assert response.status_code == 404, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "connection_not_found"
    assert detail["details"]["scope"] == "organization"


def _company_custom(org, *, slug, echo=False):
    """An organization custom provider on the mock LLM. With `echo`, its base URL is the
    mock's header echo, which answers with the headers it received: the injected
    credential comes back, and the gateway must refuse it."""
    url = f"{MOCK_LLM_URL}/__echo/v1" if echo else f"{MOCK_LLM_URL}/v1"
    created = org.call(
        "POST",
        "/secrets/",
        json=organization_scope(
            custom_provider(
                slug=slug, key=MOCK_UPSTREAM_TOKEN, url=url, models=("mock/echo",)
            )
        ),
    )
    assert created.status_code == 200, created.text
    return created.json()


def _project_custom(org, *, slug, project, echo):
    url = f"{MOCK_LLM_URL}/__echo/v1" if echo else f"{MOCK_LLM_URL}/v1"
    created = org.call(
        "POST",
        "/secrets/",
        as_="editor",
        project=project,
        json=custom_provider(
            slug=slug, key="sk-project-mock-key-1234", url=url, models=("mock/echo",)
        ),
    )
    assert created.status_code == 200, created.text
    return created.json()


def _refused_as_echo(response, value):
    """The mock echo upstream answered 200 with the headers it received; the gateway
    refuses that body (a non-streaming refusal reaches the caller as the generic upstream
    failure, 424), and the value never reaches the caller."""
    assert response.status_code == 424, response.text
    assert response.json()["error"]["code"] in (
        "upstream_echoed_credential",
        "upstream_error",
    )
    assert value not in response.text


def test_each_scope_answers_its_own_row_for_one_slug(org, gateway_on):
    slug = unique("same-slug")
    _company_custom(org, slug=slug)
    own = _project_custom(org, slug=slug, project=org.sales, echo=True)
    try:
        # Sales, project scope: its own row (the echo upstream), whose echo is refused.
        _refused_as_echo(
            _relay(org, f"/gateways/llms/custom/{slug}/v1", project=org.sales),
            "sk-project-mock-key-1234",
        )
        # Sales, organization scope: the organization row answers normally.
        assert (
            _relay(
                org, f"/gateways/llms/organization/{slug}/v1", project=org.sales
            ).status_code
            == 200
        )
        # Marketing has no project row: the project scope misses.
        assert _relay(org, f"/gateways/llms/custom/{slug}/v1").status_code == 404
    finally:
        org.call("DELETE", f"/secrets/{own['id']}", as_="editor", project=org.sales)


def test_an_upstream_echoing_the_organization_key_is_refused(org, gateway_on):
    slug = unique("echo-company")
    _company_custom(org, slug=slug, echo=True)
    _refused_as_echo(
        _relay(org, f"/gateways/llms/organization/{slug}/v1"), MOCK_UPSTREAM_TOKEN
    )


def test_an_organization_custom_provider_serves_with_no_endpoint_row(org, gateway_on):
    slug = unique("custom-company")
    _company_custom(org, slug=slug)
    response = _relay(org, f"/gateways/llms/organization/{slug}/v1")
    assert response.status_code == 200, response.text
    endpoints = org.call(
        "GET",
        "/gateways/llms/endpoints/",
        credentials=org.api_key("editor", org.marketing),
        project=org.marketing,
    )
    assert slug not in {e.get("slug") for e in endpoints.json().get("endpoints", [])}


def test_a_pinned_organization_credential_never_substitutes(org, gateway_on):
    slug = unique("pinned")
    created = org.call(
        "POST",
        "/secrets/",
        json=organization_scope(
            provider_key(slug=slug, key=MOCK_UPSTREAM_TOKEN, family="mock")
        ),
    ).json()
    # Marketing also holds a valid key of its own, under another slug.
    own = org.call(
        "POST",
        "/secrets/",
        as_="editor",
        project=org.marketing,
        json=provider_key(
            slug=unique("own-mock"), key=MOCK_UPSTREAM_TOKEN, family="mock"
        ),
    ).json()
    try:
        assert _relay(org, f"/gateways/llms/organization/{slug}/v1").status_code == 200
        if is_ee():
            limited = org.call(
                "PUT",
                f"/secrets/{created['id']}/projects",
                json={"availability": "selected_projects", "project_ids": [org.sales]},
            )
            assert limited.status_code == 200
            assert (
                _relay(org, f"/gateways/llms/organization/{slug}/v1").status_code != 200
            )
            org.call(
                "PUT",
                f"/secrets/{created['id']}/projects",
                json={"availability": "all_projects"},
            )
        assert (
            org.call(
                "DELETE", f"/secrets/{created['id']}?scope=organization"
            ).status_code
            == 204
        )
        assert _relay(org, f"/gateways/llms/organization/{slug}/v1").status_code != 200
    finally:
        org.call("DELETE", f"/secrets/{own['id']}", as_="editor", project=org.marketing)


def test_ee_limit_to_sales(org, admin_api):
    if not is_ee():
        pytest.skip("EE limit")
    slug = unique("limited")
    created = org.call(
        "POST",
        "/secrets/",
        json=organization_scope(
            {
                **provider_key(slug=slug, key=MOCK_UPSTREAM_TOKEN, family="mock"),
                "availability": "selected_projects",
                "project_ids": [org.sales],
            }
        ),
    )
    assert created.status_code == 200, created.text
    in_marketing = org.call(
        "GET",
        "/secrets/",
        as_="editor",
        project=org.marketing,
        params={"include_organization": "true"},
    )
    assert created.json()["id"] not in {row["id"] for row in in_marketing.json()}
    assert _resolve(org, slug=slug).status_code == 404
    assert _resolve(org, slug=slug, project=org.sales).status_code == 200
    in_sales = org.call(
        "GET",
        "/secrets/",
        as_="editor",
        project=org.sales,
        params={"include_organization": "true"},
    )
    assert created.json()["id"] in {row["id"] for row in in_sales.json()}


def test_deleting_the_only_selected_project_leaves_the_row_with_no_project(
    org, admin_api
):
    if not is_ee():
        pytest.skip("EE limit")
    project = org._project("Doomed")
    slug = unique("doomed")
    created = org.call(
        "POST",
        "/secrets/",
        json=organization_scope(
            {
                **provider_key(slug=slug, key=KEY),
                "availability": "selected_projects",
                "project_ids": [project],
            }
        ),
    ).json()
    assert (
        admin_api("DELETE", f"/admin/simple/accounts/projects/{project}").status_code
        == 200
    )
    stored = org.call("GET", f"/secrets/{created['id']}?scope=organization").json()
    assert stored["availability"] == "selected_projects"
    assert stored.get("selected_project_ids", []) == []
    for project_id in (org.sales, org.marketing):
        listed = org.call(
            "GET",
            "/secrets/",
            as_="editor",
            project=project_id,
            params={"include_organization": "true"},
        )
        assert created["id"] not in {row["id"] for row in listed.json()}


def test_a_new_project_lists_an_all_projects_connection(
    org, company_login, gateway_off
):
    project = org._project("New")
    try:
        created = org.call(
            "POST",
            "/secrets/",
            json=organization_scope(provider_key(slug=unique("for-new"), key=KEY)),
        ).json()
        listed = org.call(
            "GET",
            "/secrets/",
            as_="owner",
            project=project,
            params={"include_organization": "true"},
        )
        assert listed.status_code == 200, listed.text
        listed_ids = {row["id"] for row in listed.json()}
        # The login is offered with the gateway on or off; the key only with it on.
        assert company_login["id"] in listed_ids
        assert (created["id"] in listed_ids) is not gateway_off
    finally:
        org.admin_api("DELETE", f"/admin/simple/accounts/projects/{project}")


def _unused():
    return uuid4()
