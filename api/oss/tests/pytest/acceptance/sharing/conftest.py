"""Fixtures for the sharing acceptance tests (M3), against a running API.

`sharing_team` (function scope) makes one project with two people who can sign in:
Alice, the owner, and Bob, an editor, each with a browser session (`Bearer`, signed in
through the same `/auth/signin` call the web app makes) and an API key of the project.

`sharing_cast` (module scope) makes the cast of technical design 8.3: an organization
owner, Alice (editor), Bob (editor), Carol (viewer), Dana (admin), each with a browser
session, an API key of the project and a run credential (`run_caller`); Alice's API
key; and one installation of the mock channel (`agenta`) bound to a project agent. In
EE it runs twice: once in an organization whose plan has the RBAC entitlement, once in
one whose plan has not (role checks off). Every account is deleted after the module.
"""

import secrets
from dataclasses import dataclass, field
from typing import Dict, Optional
from uuid import uuid4

import pytest

from oss.src.utils.common import is_ee
from oss.tests.pytest.acceptance.sharing.support import (
    Caller,
    add_member,
    bearer,
    create_person,
    delete_person,
    first_id,
    new_agent,
    project_key,
)
from oss.tests.pytest.utils.sharing import installation_run_credential

# EE plans: role checks apply only when the plan has the RBAC entitlement.
RBAC_PLAN = "cloud_v0_business"
NO_RBAC_PLAN = "cloud_v0_pro"


@pytest.fixture
def sharing_team(ag_env, admin_api):
    api_url = ag_env["api_url"]
    uid = uuid4().hex[:12]
    password = secrets.token_urlsafe(18)
    alice_email = f"m3-alice-{uid}@test.agenta.ai"
    bob_email = f"m3-bob-{uid}@test.agenta.ai"
    created = []
    try:
        alice = create_person(admin_api, email=alice_email, password=password)
        created.append(alice_email)
        bob = create_person(admin_api, email=bob_email, password=password)
        created.append(bob_email)
        organization_id = first_id(alice["organizations"])
        project_id = first_id(alice["projects"])
        alice_id = alice["user"]["id"]
        bob_id = bob["user"]["id"]
        add_member(
            admin_api,
            organization_id=organization_id,
            project_id=project_id,
            user_id=bob_id,
            role="editor",
        )

        def caller(credentials, user_id):
            return Caller(
                api_url=api_url,
                credentials=credentials,
                project_id=project_id,
                user_id=user_id,
            )

        yield {
            "project_id": project_id,
            "alice": caller(
                bearer(api_url, email=alice_email, password=password), alice_id
            ),
            "bob": caller(bearer(api_url, email=bob_email, password=password), bob_id),
            "alice_key": caller(
                project_key(admin_api, project_id=project_id, user_id=alice_id),
                alice_id,
            ),
            "bob_key": caller(
                project_key(admin_api, project_id=project_id, user_id=bob_id), bob_id
            ),
        }
    finally:
        for email in reversed(created):
            delete_person(admin_api, email=email)


@dataclass
class Person:
    label: str
    email: str
    user_id: str
    role: str
    bearer: Caller
    key: Caller


@dataclass
class Installation:
    """One binding of the mock channel: `id` is the installation principal's id
    (the `channel_agents` row), `agent` the project agent it runs."""

    id: str
    connection: dict
    agent: dict
    caller: Caller
    linked_caller: Optional[Caller] = None


@dataclass
class Cast:
    admin_api: object
    api_url: str
    rbac: bool
    organization_id: str
    workspace_id: str
    project_id: str
    people: Dict[str, Person] = field(default_factory=dict)
    installation: Optional[Installation] = None

    def __getitem__(self, label) -> Caller:
        """The person's browser session (`Bearer`)."""
        return self.people[label].bearer

    @property
    def alice_key(self) -> Caller:
        return self.people["alice"].key


_ROLES = {"alice": "editor", "bob": "editor", "carol": "viewer", "dana": "admin"}


def _rbac_params():
    return [True, False] if is_ee() else [True]


def _install_mock_channel(cast: Cast) -> Installation:
    alice = cast["alice"]
    agent = new_agent(alice, visibility="project", name="m3 channel agent")
    slug = f"m3-channel-{uuid4().hex[:8]}"
    created = alice(
        "POST",
        "/channels/connections/",
        json={"connection": {"channel": "agenta", "slug": slug, "data": {"bot": slug}}},
    )
    assert created.status_code == 200, created.text
    connection = created.json()["connection"]
    connection_id = connection["id"]
    bound = alice(
        "POST",
        "/channels/agents/",
        json={
            "agent": {
                "connection_id": connection_id,
                "slug": f"m3-binding-{uuid4().hex[:8]}",
                "data": {
                    "references": {"workflow_revision": {"id": agent["revision_id"]}}
                },
            }
        },
    )
    assert bound.status_code == 200, bound.text
    installation_id = bound.json()["agent"]["id"]
    marked = alice("POST", f"/channels/agents/{installation_id}/default")
    assert marked.status_code == 200, marked.text

    def credential(linked_user_id=None):
        return installation_run_credential(
            installation_id=installation_id,
            acting_user_id=cast.people["alice"].user_id,
            project_id=cast.project_id,
            organization_id=cast.organization_id,
            workspace_id=cast.workspace_id,
            linked_user_id=linked_user_id,
        )

    return Installation(
        id=installation_id,
        connection=connection,
        agent=agent,
        caller=alice.with_credentials(credential()),
        linked_caller=alice.with_credentials(
            credential(linked_user_id=cast.people["alice"].user_id)
        ),
    )


@pytest.fixture(
    scope="module",
    params=_rbac_params(),
    ids=lambda rbac: "rbac" if rbac else "no-rbac",
)
def sharing_cast(request, ag_env, admin_api):
    api_url = ag_env["api_url"]
    rbac = request.param
    uid = uuid4().hex[:10]
    password = secrets.token_urlsafe(18)
    created = []
    try:
        owner_email = f"m3-owner-{uid}@test.agenta.ai"
        owner = create_person(
            admin_api,
            email=owner_email,
            password=password,
            plan=(RBAC_PLAN if rbac else NO_RBAC_PLAN) if is_ee() else None,
        )
        created.append(owner_email)
        cast = Cast(
            admin_api=admin_api,
            api_url=api_url,
            rbac=rbac,
            organization_id=first_id(owner["organizations"]),
            workspace_id=first_id(owner["workspaces"]),
            project_id=first_id(owner["projects"]),
        )

        def person(label, email, user_id, role):
            def caller(credentials):
                return Caller(
                    api_url=api_url,
                    credentials=credentials,
                    project_id=cast.project_id,
                    user_id=user_id,
                )

            return Person(
                label=label,
                email=email,
                user_id=user_id,
                role=role,
                bearer=caller(bearer(api_url, email=email, password=password)),
                key=caller(
                    project_key(admin_api, project_id=cast.project_id, user_id=user_id)
                ),
            )

        cast.people["owner"] = person(
            "owner", owner_email, owner["user"]["id"], "owner"
        )
        for label, role in _ROLES.items():
            email = f"m3-{label}-{uid}@test.agenta.ai"
            account = create_person(admin_api, email=email, password=password)
            created.append(email)
            add_member(
                admin_api,
                organization_id=cast.organization_id,
                project_id=cast.project_id,
                user_id=account["user"]["id"],
                role=role,
            )
            cast.people[label] = person(label, email, account["user"]["id"], role)

        cast.installation = _install_mock_channel(cast)
        yield cast
    finally:
        for email in reversed(created):
            delete_person(admin_api, email=email)
