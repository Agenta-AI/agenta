"""The admin accounts path writes the organization row with the role it was given.

Before the fix it ignored `role`, so the column default `viewer` was written, also for
an account's owner; the membership resolver reads the organization role."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest

import oss.src.core.accounts.service as accounts_service
import oss.src.dbs.postgres.shared.engine as engine_module


class _Session:
    def __init__(self, organization):
        self.added = []
        self.organization = organization

    def add(self, row):
        self.added.append(row)

    async def commit(self):
        pass

    async def execute(self, statement):
        organization = self.organization
        return SimpleNamespace(
            scalars=lambda: SimpleNamespace(first=lambda: organization)
        )


@pytest.mark.parametrize("role", ["owner", "admin", "editor", "viewer"])
async def test_the_organization_row_gets_the_given_role(monkeypatch, role):
    organization = SimpleNamespace(owner_id=uuid4())
    session = _Session(organization)

    @asynccontextmanager
    async def _session():
        yield session

    monkeypatch.setattr(
        engine_module,
        "get_transactions_engine",
        lambda: SimpleNamespace(session=_session),
    )
    user_id, organization_id = uuid4(), uuid4()

    await accounts_service._create_org_membership_row(
        user_id=user_id, organization_id=organization_id, role=role
    )

    (row,) = session.added
    assert (row.user_id, row.organization_id, row.role) == (
        user_id,
        organization_id,
        role,
    )
    if role == "owner":
        assert organization.owner_id == user_id
