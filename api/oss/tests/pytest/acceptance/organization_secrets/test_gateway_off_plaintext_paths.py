"""With the LLM gateway off, organization credentials reach no plaintext path (M5, P2).

Runs only against a deployment with `AGENTA_LLM_GATEWAY_ENABLED=false` (the product
default); on a deployment with the gateway on, it skips. The run's own credential (a
Secret token with the `secret-resolve` grant) reads the vault in plaintext: it never sees
an organization row, so an agent naming an organization connection fails "connection not found" in
the SDK, and the sandbox never receives the value.
"""

import pytest
from oss.tests.pytest.acceptance.organization_secrets.conftest import (
    llm_gateway_disabled,
    organization_scope,
    provider_key,
    unique,
)

pytestmark = [pytest.mark.acceptance]

KEY = "sk-m5acc-gateway-off-0123456789"


@pytest.fixture(scope="module")
def gateway_off(org):
    if not llm_gateway_disabled(org):
        pytest.skip("the deployment runs the LLM gateway; this suite needs it off")


def _run_credential(org) -> str:
    response = org.call(
        "GET",
        "/access/permissions/check",
        params={"action": "run_service", "resource_type": "service"},
        credentials=org.api_key("editor"),
    )
    assert response.status_code == 200, response.text
    return response.json()["credentials"]


def test_the_run_credential_never_receives_an_organization_row(org, gateway_off):
    company = org.call(
        "POST",
        "/secrets/",
        json=organization_scope(provider_key(slug=unique("off"), key=KEY)),
    )
    assert company.status_code == 200, company.text
    run = _run_credential(org)
    plain = org.call("GET", "/secrets/", credentials=run)
    assert plain.status_code == 200, plain.text
    assert (
        company.json()["id"] not in plain.text
    )  # the plaintext read: project rows only
    # With the gateway off, an organization key is not offered even with the parameter:
    # it could not run.
    listed = org.call(
        "GET", "/secrets/", credentials=run, params={"include_organization": "true"}
    )
    assert listed.status_code == 200, listed.text
    assert company.json()["id"] not in listed.text
    for text_ in (plain.text, listed.text):
        assert KEY not in text_
    assert (
        org.call(
            "GET", f"/secrets/{company.json()['slug']}", credentials=run
        ).status_code
        == 404
    )


def test_a_named_organization_slug_is_not_served(org, gateway_off):
    slug = unique("off-named")
    assert (
        org.call(
            "POST",
            "/secrets/",
            json=organization_scope(provider_key(slug=slug, key=KEY)),
        ).status_code
        == 200
    )
    response = org.call(
        "POST",
        "/gateways/llms/resolve",
        credentials=org.api_key("editor"),
        json={
            "model": "gpt-4o-mini",
            "connection_slug": slug,
            "connection_scope": "organization",
        },
    )
    assert response.status_code == 403
    assert "llm_gateway_disabled" in response.text
