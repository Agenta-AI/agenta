"""An organization with an owner, an admin, an editor and a viewer, each signed in through
SuperTokens (the `/m` login), and two projects (Sales, Marketing) with project rows for
every member, made through the admin API. In EE the organization is on a plan with the RBAC
entitlement; `hobby_org` is one without it.

Bearer requests name the project with `?project_id=`, so the request's organization is
this organization (not the member's own personal one).
"""

import os
from typing import Dict, Optional
from uuid import uuid4

import pytest
import requests

from oss.src.utils.common import is_ee
from oss.tests.pytest.utils.membership_accounts import (
    add_organization_member,
    add_project_member,
    api_key_for_project,
    delete_account,
    first_id,
)

BASE_TIMEOUT = 60
RBAC_PLAN = "cloud_v0_business"
HOBBY_PLAN = "cloud_v0_hobby"

# The mock LLM accepts this token (the development mock's upstream credential).
MOCK_UPSTREAM_TOKEN = os.getenv(
    "AGENTA_GATEWAYS_MOCKS_UPSTREAM_TOKEN", "agenta-gateway-mock-token"
)
MOCK_LLM_URL = os.getenv(
    "AGENTA_MOCK_LLM_GATEWAY_URL", "http://mock-llm-gateway:9091"
).rstrip("/")


def _create(admin_api, *, email: str, password: str, plan: Optional[str]) -> dict:
    account = {
        "user": {"email": email},
        "options": {
            "create_api_keys": True,
            "return_api_keys": True,
            "seed_defaults": False,
            "create_identities": True,
        },
        "user_identities": [
            {
                "method": "email:password",
                "subject": email,
                "email": email,
                "password": password,
                "verified": True,
            }
        ],
    }
    if is_ee() and plan:
        account["subscription"] = {"plan": plan}
    response = admin_api(
        "POST", "/admin/simple/accounts/", json={"accounts": {"u": account}}
    )
    assert response.status_code == 200, response.text
    return response.json()["accounts"]["u"]


def sign_in(api_url: str, *, email: str, password: str) -> str:
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
        timeout=BASE_TIMEOUT,
    )
    token = response.headers.get("st-access-token")
    assert response.status_code == 200 and token, response.text[:200]
    return f"Bearer {token}"


class OrgWorld:
    def __init__(
        self, admin_api, api_url: str, *, plan: Optional[str], members: Dict[str, str]
    ):
        self.admin_api = admin_api
        self.api_url = api_url
        self.password = f"P-{uuid4().hex}"
        tag = uuid4().hex[:10]
        self.emails = {"owner": f"m5-owner-{tag}@test.agenta.ai"}
        self.owner = _create(
            admin_api, email=self.emails["owner"], password=self.password, plan=plan
        )
        self.organization_id = first_id(self.owner["organizations"])
        self.workspace_id = first_id(self.owner["workspaces"])
        self.sales = first_id(self.owner["projects"])
        self.marketing = self._project("Marketing")
        self.user_ids = {"owner": self.owner["user"]["id"]}
        for label, role in members.items():
            email = f"m5-{label}-{tag}@test.agenta.ai"
            account = _create(admin_api, email=email, password=self.password, plan=None)
            self.emails[label] = email
            self.user_ids[label] = account["user"]["id"]
            add_organization_member(
                admin_api,
                organization_id=self.organization_id,
                user_id=self.user_ids[label],
                role=role,
            )
            for project in (self.sales, self.marketing):
                add_project_member(
                    admin_api,
                    project_id=project,
                    user_id=self.user_ids[label],
                    role=role,
                )
        self._bearers: Dict[str, str] = {}
        self._keys: Dict[tuple, str] = {}

    def _project(self, name: str) -> str:
        response = self.admin_api(
            "POST",
            "/admin/simple/accounts/projects/",
            json={
                "project": {
                    "name": f"{name}-{uuid4().hex[:6]}",
                    "organization_ref": {"id": self.organization_id},
                    "workspace_ref": {"id": self.workspace_id},
                    "is_default": False,
                }
            },
        )
        assert response.status_code == 200, response.text
        project_id = first_id(response.json()["accounts"][0]["projects"])
        # EE resolves membership from project rows: the owner gets one, as in the app.
        add_project_member(
            self.admin_api,
            project_id=project_id,
            user_id=self.owner["user"]["id"],
            role="owner",
        )
        return project_id

    def bearer(self, label: str) -> str:
        if label not in self._bearers:
            self._bearers[label] = sign_in(
                self.api_url, email=self.emails[label], password=self.password
            )
        return self._bearers[label]

    def api_key(self, label: str, project: Optional[str] = None) -> str:
        project = project or self.sales
        if (label, project) not in self._keys:
            self._keys[(label, project)] = "ApiKey " + api_key_for_project(
                self.admin_api, project_id=project, user_id=self.user_ids[label]
            )
        return self._keys[(label, project)]

    def call(
        self,
        method: str,
        path: str,
        *,
        as_: str = "owner",
        project: Optional[str] = None,
        credentials: Optional[str] = None,
        **kwargs,
    ):
        params = dict(kwargs.pop("params", {}) or {})
        params.setdefault("project_id", project or self.sales)
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("Authorization", credentials or self.bearer(as_))
        return requests.request(
            method,
            f"{self.api_url}{path}",
            params=params,
            headers=headers,
            timeout=BASE_TIMEOUT,
            **kwargs,
        )

    def delete(self) -> None:
        for email in self.emails.values():
            delete_account(self.admin_api, email=email)


@pytest.fixture(scope="module")
def org(admin_api, ag_env):
    world = OrgWorld(
        admin_api,
        ag_env["api_url"],
        plan=RBAC_PLAN,
        members={"admin": "admin", "editor": "editor", "viewer": "viewer"},
    )
    yield world
    world.delete()


def llm_gateway_disabled(org) -> bool:
    """True when the deployment answers the LLM gateway with `llm_gateway_disabled`."""
    response = requests.get(
        f"{org.api_url}/gateways/llms/endpoints/",
        headers={"Authorization": org.api_key("owner")},
        timeout=BASE_TIMEOUT,
    )
    detail = (
        (response.json() or {}).get("detail") if response.status_code == 403 else None
    )
    code = detail.get("code") if isinstance(detail, dict) else None
    return code == "llm_gateway_disabled"


@pytest.fixture(scope="module")
def gateway_on(org):
    if llm_gateway_disabled(org):
        pytest.skip(
            "the deployment runs with the LLM gateway off; this test needs it on"
        )


@pytest.fixture(scope="module")
def hobby_org(admin_api, ag_env):
    if not is_ee():
        pytest.skip("EE plans only")
    world = OrgWorld(
        admin_api, ag_env["api_url"], plan=HOBBY_PLAN, members={"editor": "editor"}
    )
    yield world
    world.delete()


def provider_key(
    *, slug: str, key: str, family: str = "openai", name: Optional[str] = None
) -> dict:
    return {
        "slug": slug,
        "header": {"name": name or slug},
        "secret": {
            "kind": "provider_key",
            "data": {"kind": family, "provider": {"key": key}},
        },
    }


def custom_provider(
    *,
    slug: str,
    key: str,
    url: str = "https://llm.example.com/v1",
    family: str = "custom",
    models=("gpt-4o-mini",),
    extras=None,
) -> dict:
    provider = {"url": url, "key": key}
    if extras is not None:
        provider["extras"] = extras
    return {
        "slug": slug,
        "header": {"name": slug},
        "secret": {
            "kind": "custom_provider",
            "data": {
                "kind": family,
                "provider": provider,
                "models": [{"slug": model} for model in models],
            },
        },
    }


def unique(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:8]}"
