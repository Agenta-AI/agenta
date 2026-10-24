"""The demo feature is gone: `AGENTA_DEMOS` no longer enrolls a new signup."""

import json
from uuid import uuid4

import pytest

import oss.src.services.commoners as commoners
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    fetch_all,
    seed_organization,
)


pytestmark = pytest.mark.integration


async def test_signup_ignores_agenta_demos(monkeypatch):
    seeded = await seed_organization(members={"owner": "owner"})
    demo_projects = json.dumps([str(seeded.project_ids[0])])
    monkeypatch.setenv("AGENTA_DEMOS", demo_projects)
    monkeypatch.setenv("AGENTA_EXTRAS_DEMOS", demo_projects)

    # The stack's Redis is not reachable from the host: take the signup lock locally.
    async def _acquire_lock(**kwargs):
        return "owner"

    async def _release_lock(**kwargs):
        return True

    monkeypatch.setattr(commoners, "acquire_lock", _acquire_lock)
    monkeypatch.setattr(commoners, "release_lock", _release_lock)
    # No organization creation allowlist match: only the demo enrollment could add rows.
    monkeypatch.setattr(commoners, "can_create_organization", lambda email: False)
    monkeypatch.setattr(commoners, "is_ee", lambda: False)

    email = f"membership-signup-{uuid4().hex}@test.agenta.ai"
    user = None
    try:
        user = await commoners.create_accounts(
            {"uid": f"membership-signup-{uuid4().hex}", "email": email}
        )

        rows = await fetch_all(
            "SELECT "
            "(SELECT count(*) FROM organization_members "
            " WHERE user_id = :u AND organization_id = :o) AS o, "
            "(SELECT count(*) FROM workspace_members "
            " WHERE user_id = :u AND workspace_id = ANY(CAST(:w AS uuid[]))) AS w, "
            "(SELECT count(*) FROM project_members "
            " WHERE user_id = :u AND project_id = ANY(CAST(:p AS uuid[]))) AS p",
            {
                "u": user.id,
                "o": seeded.organization_id,
                "w": seeded.workspace_ids,
                "p": seeded.project_ids,
            },
        )
        assert dict(rows[0]) == {"o": 0, "w": 0, "p": 0}
    finally:
        if user is not None:
            seeded.extra_user_ids.append(user.id)
        await delete_seeded_organization(seeded)
