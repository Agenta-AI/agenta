"""EE SSO secrets are never shared, never listed in a project and never addressed by the
organization routes (M5, P10). The SSO row is written with SQL, the way the EE provider
service stores one (an organization-owned `sso_provider` secret)."""

import asyncio
import json
from uuid import uuid4

import pytest
from sqlalchemy import text

from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.tests.pytest.utils.postgres import require_core_uri

pytestmark = [pytest.mark.acceptance, pytest.mark.integration]

SSO_SECRET = "m5acc-sso-client-secret-0123456789"


def _run(coro):
    import oss.src.dbs.postgres.shared.engine as engine_module

    async def wrapped():
        engine_module._transactions_engine = None
        try:
            return await coro()
        finally:
            if engine_module._transactions_engine is not None:
                await engine_module._transactions_engine.close()
                engine_module._transactions_engine = None

    return asyncio.run(wrapped())


@pytest.fixture(scope="module")
def sso_secret(org):
    if not is_ee():
        pytest.skip("EE SSO")
    require_core_uri()  # module scope runs before the function-scoped database guard
    secret_id = uuid4()
    data = json.dumps(
        {
            "provider": {
                "client_id": "m5-client",
                "client_secret": SSO_SECRET,
                "issuer_url": "https://idp.example.com",
                "scopes": ["openid"],
            }
        }
    )

    async def insert():
        async with get_transactions_engine().session() as session:
            await session.execute(
                text(
                    "INSERT INTO secrets (id, kind, data, organization_id, name, created_at) "
                    "VALUES (:id, 'SSO_PROVIDER', pgp_sym_encrypt(:data, :key), :org, 'SSO', now())"
                ),
                {
                    "id": secret_id,
                    "data": data,
                    "key": env.agenta.crypt_key,
                    "org": org.organization_id,
                },
            )

    _run(insert)
    return str(secret_id)


async def _stored(secret_id):
    async with get_transactions_engine().session() as session:
        row = (
            await session.execute(
                text(
                    "SELECT name, availability, md5(data::text) FROM secrets WHERE id = :id"
                ),
                {"id": secret_id},
            )
        ).first()
    return tuple(row) if row else None


def test_an_sso_id_answers_404_on_every_organization_route_and_stays(org, sso_secret):
    before = _run(lambda: _stored(sso_secret))
    assert before is not None
    for method, path, body in (
        ("GET", f"/organization-secrets/{sso_secret}", None),
        ("PUT", f"/organization-secrets/{sso_secret}", {"header": {"name": "x"}}),
        ("DELETE", f"/organization-secrets/{sso_secret}", None),
        (
            "PUT",
            f"/organization-secrets/{sso_secret}/projects",
            {"availability": "selected_projects", "project_ids": [org.sales]},
        ),
    ):
        response = org.call(method, path, json=body)
        assert response.status_code == 404, (method, path, response.text)
    listed = org.call("GET", "/organization-secrets/")
    assert sso_secret not in listed.text and SSO_SECRET not in listed.text
    assert _run(lambda: _stored(sso_secret)) == before


def test_sso_secrets_never_appear_in_a_project_list(org, sso_secret):
    for who in ("owner", "admin", "editor", "viewer"):
        for params in ({}, {"include_organization": "true"}):
            response = org.call("GET", "/secrets/", as_=who, params=params)
            assert response.status_code == 200
            assert sso_secret not in response.text
            assert SSO_SECRET not in response.text
