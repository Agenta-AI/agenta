"""Inheritance end to end: project lists, project routes, overrides, the LLM gateway with
the mock LLM, inherited custom providers, echo refusals, pinned references and the EE
limit (M5, P1, P2, P4 to P7, P12, P13). Needs the LLM gateway on the deployment."""

from uuid import uuid4

import pytest
import requests

from oss.src.utils.common import is_ee
from oss.tests.pytest.acceptance.organization_secrets.conftest import (
    BASE_TIMEOUT,
    MOCK_LLM_URL,
    MOCK_UPSTREAM_TOKEN,
    custom_provider,
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
        "/organization-secrets/",
        json=provider_key(slug=unique("openai-company"), key=KEY),
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


def _resolve(org, *, slug, project=None):
    return org.call(
        "POST",
        "/gateways/llms/resolve",
        credentials=org.api_key("editor", project or org.marketing),
        project=project or org.marketing,
        json={"model": "mock/echo", "connection_slug": slug},
    )


# -- project lists and project routes -------------------------------------------------


@pytest.mark.parametrize("who", ROLES)
def test_inherited_list_carries_names_and_status_never_the_value(org, company, who):
    response = org.call(
        "GET",
        "/secrets/",
        as_=who,
        project=org.marketing,
        params={"include_inherited": "true"},
    )
    assert response.status_code == 200, response.text
    rows = {row["id"]: row for row in response.json()}
    row = rows[company["id"]]
    assert row["owner"]["kind"] == "organization"
    assert row["slug"] == company["slug"]
    assert row["header"]["name"] == company["header"]["name"]
    assert row["data"]["kind"] == "openai"
    assert row["value_status"] == {"configured": True}
    assert "availability" not in row and "selected_project_ids" not in row
    assert KEY not in response.text

    plain = org.call("GET", "/secrets/", as_=who, project=org.marketing)
    assert company["id"] not in {row["id"] for row in plain.json()}


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
        ("GET", "/secrets/", {"include_inherited": "true"}),
        ("GET", f"/secrets/{company['id']}", {}),
        ("GET", f"/secrets/{company['slug']}", {}),
        ("GET", "/organization-secrets/", {}),
        ("GET", f"/organization-secrets/{company['id']}", {}),
        ("GET", "/gateways/llms/endpoints/", {}),
    ]
    for caller in callers:
        for method, path, params in paths:
            response = org.call(method, path, params=params, **caller)
            assert KEY not in response.text, (caller.keys(), path)
            assert KEY[:20] not in response.text


def test_project_routes_do_not_touch_organization_rows(org, company):
    for who in ("editor", "admin", "owner"):
        # Status quo: a project delete of an id that is not a project row answers 204
        # and deletes nothing (the row is checked below).
        assert (
            org.call("DELETE", f"/secrets/{company['id']}", as_=who).status_code == 204
        )
        assert (
            org.call(
                "PUT",
                f"/secrets/{company['id']}",
                as_=who,
                json={"header": {"name": "x"}},
            ).status_code
            == 404
        )
        assert org.call("GET", f"/secrets/{company['id']}", as_=who).status_code == 404
        assert (
            org.call("GET", f"/secrets/{company['slug']}", as_=who).status_code == 404
        )
    stored = org.call("GET", f"/organization-secrets/{company['id']}").json()
    assert stored["header"]["name"] == company["header"]["name"]


def test_a_mismatched_override_answers_409(org, company):
    response = org.call(
        "POST",
        "/secrets/",
        as_="editor",
        json=custom_provider(slug=company["slug"], key=KEY),
    )
    assert response.status_code == 409, response.text
    response = org.call(
        "POST",
        "/secrets/",
        as_="editor",
        json=provider_key(slug=company["slug"], key=KEY, family="anthropic"),
    )
    assert response.status_code == 409
    assert company["slug"] not in {
        row["slug"] for row in org.call("GET", "/secrets/", as_="editor").json()
    }


# -- the LLM gateway with the mock LLM ----------------------------------------------


@pytest.fixture(scope="module")
def company_mock(org):
    slug = unique("mock-company")
    created = org.call(
        "POST",
        "/organization-secrets/",
        json=provider_key(slug=slug, key=MOCK_UPSTREAM_TOKEN, family="mock"),
    )
    assert created.status_code == 200, created.text
    return created.json()


def test_the_gateway_uses_the_inherited_key(org, company_mock):
    # Marketing has no key of its own: the unnamed call uses the company key.
    response = _relay(org, "/gateways/llms/standard/mock/v1")
    assert response.status_code == 200, response.text
    # And by the organization slug.
    resolved = _resolve(org, slug=company_mock["slug"])
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["connection"]["namespace"] == "standard"
    response = _relay(org, f"/gateways/llms/standard/{company_mock['slug']}/v1")
    assert response.status_code == 200, response.text


def _company_custom(org, *, slug, echo=False):
    """An organization custom provider on the mock LLM. With `echo`, its base URL is the
    mock's header echo, which answers with the headers it received: the injected
    credential comes back, and the gateway must refuse it."""
    url = f"{MOCK_LLM_URL}/__echo/v1" if echo else f"{MOCK_LLM_URL}/v1"
    created = org.call(
        "POST",
        "/organization-secrets/",
        json=custom_provider(
            slug=slug, key=MOCK_UPSTREAM_TOKEN, url=url, models=("mock/echo",)
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


def test_a_slug_override_wins_only_in_its_project(org):
    slug = unique("override")
    _company_custom(org, slug=slug)
    own = _project_custom(org, slug=slug, project=org.sales, echo=True)
    try:
        # Sales: its own row (the echo upstream) answers, and its echoed key is refused.
        _refused_as_echo(
            _relay(org, f"/gateways/llms/custom/{slug}/v1", project=org.sales),
            "sk-project-mock-key-1234",
        )
        # Marketing: the organization row answers normally.
        assert _relay(org, f"/gateways/llms/custom/{slug}/v1").status_code == 200
    finally:
        org.call("DELETE", f"/secrets/{own['id']}", as_="editor", project=org.sales)


def test_an_upstream_echoing_the_organization_key_is_refused(org):
    slug = unique("echo-company")
    _company_custom(org, slug=slug, echo=True)
    _refused_as_echo(
        _relay(org, f"/gateways/llms/custom/{slug}/v1"), MOCK_UPSTREAM_TOKEN
    )


def test_an_inherited_custom_provider_serves_by_slug_with_no_endpoint_row(org):
    slug = unique("custom-company")
    _company_custom(org, slug=slug)
    response = _relay(org, f"/gateways/llms/custom/{slug}/v1")
    assert response.status_code == 200, response.text
    endpoints = org.call(
        "GET",
        "/gateways/llms/endpoints/",
        credentials=org.api_key("editor", org.marketing),
        project=org.marketing,
    )
    assert slug not in {e.get("slug") for e in endpoints.json().get("endpoints", [])}

    # A project endpoint row with that slug wins (here: the echo upstream, refused).
    own = _project_custom(org, slug=slug, project=org.marketing, echo=True)
    try:
        _refused_as_echo(
            _relay(org, f"/gateways/llms/custom/{slug}/v1"), "sk-project-mock-key-1234"
        )
    finally:
        org.call("DELETE", f"/secrets/{own['id']}", as_="editor", project=org.marketing)


def test_a_pinned_organization_credential_never_substitutes(org):
    slug = unique("pinned")
    created = org.call(
        "POST",
        "/organization-secrets/",
        json=provider_key(slug=slug, key=MOCK_UPSTREAM_TOKEN, family="mock"),
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
        assert _relay(org, f"/gateways/llms/standard/{slug}/v1").status_code == 200
        if is_ee():
            limited = org.call(
                "PUT",
                f"/organization-secrets/{created['id']}/projects",
                json={"availability": "selected_projects", "project_ids": [org.sales]},
            )
            assert limited.status_code == 200
            assert _relay(org, f"/gateways/llms/standard/{slug}/v1").status_code != 200
            org.call(
                "PUT",
                f"/organization-secrets/{created['id']}/projects",
                json={"availability": "all_projects"},
            )
        assert (
            org.call("DELETE", f"/organization-secrets/{created['id']}").status_code
            == 204
        )
        assert _relay(org, f"/gateways/llms/standard/{slug}/v1").status_code != 200
    finally:
        org.call("DELETE", f"/secrets/{own['id']}", as_="editor", project=org.marketing)


def test_ee_limit_to_sales(org, admin_api):
    if not is_ee():
        pytest.skip("EE limit")
    slug = unique("limited")
    created = org.call(
        "POST",
        "/organization-secrets/",
        json={
            **provider_key(slug=slug, key=MOCK_UPSTREAM_TOKEN, family="mock"),
            "availability": "selected_projects",
            "project_ids": [org.sales],
        },
    )
    assert created.status_code == 200, created.text
    in_marketing = org.call(
        "GET",
        "/secrets/",
        as_="editor",
        project=org.marketing,
        params={"include_inherited": "true"},
    )
    assert created.json()["id"] not in {row["id"] for row in in_marketing.json()}
    assert _resolve(org, slug=slug).status_code == 404
    in_sales = org.call(
        "GET",
        "/secrets/",
        as_="editor",
        project=org.sales,
        params={"include_inherited": "true"},
    )
    assert created.json()["id"] in {row["id"] for row in in_sales.json()}


def test_deleting_the_only_selected_project_leaves_no_inheritor(org, admin_api):
    if not is_ee():
        pytest.skip("EE limit")
    project = org._project("Doomed")
    slug = unique("doomed")
    created = org.call(
        "POST",
        "/organization-secrets/",
        json={
            **provider_key(slug=slug, key=KEY),
            "availability": "selected_projects",
            "project_ids": [project],
        },
    ).json()
    assert (
        admin_api("DELETE", f"/admin/simple/accounts/projects/{project}").status_code
        == 200
    )
    stored = org.call("GET", f"/organization-secrets/{created['id']}").json()
    assert stored["availability"] == "selected_projects"
    assert stored.get("selected_project_ids", []) == []
    for project_id in (org.sales, org.marketing):
        listed = org.call(
            "GET",
            "/secrets/",
            as_="editor",
            project=project_id,
            params={"include_inherited": "true"},
        )
        assert created["id"] not in {row["id"] for row in listed.json()}


def test_a_new_project_inherits(org):
    project = org._project("New")
    try:
        created = org.call(
            "POST",
            "/organization-secrets/",
            json=provider_key(slug=unique("for-new"), key=KEY),
        ).json()
        listed = org.call(
            "GET",
            "/secrets/",
            as_="owner",
            project=project,
            params={"include_inherited": "true"},
        )
        assert listed.status_code == 200, listed.text
        assert created["id"] in {row["id"] for row in listed.json()}
    finally:
        org.admin_api("DELETE", f"/admin/simple/accounts/projects/{project}")


def _unused():
    return uuid4()
