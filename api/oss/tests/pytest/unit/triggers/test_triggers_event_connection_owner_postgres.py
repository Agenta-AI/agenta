"""A person's own Composio connection is never a trigger subscription's event connection.

Spec section 3.8, rule 4. A subscription names its event connection by
`(project_id, connection_id)`, a foreign key to `gateway_connections (project_id, id)`.
A person's connection has no `project_id`, so no subscription can point at it, and the
project-scoped connection read that the triggers service uses does not find it. A change
of run person therefore never leaves one person's connection firing another person's runs.
"""

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from oss.src.dbs.postgres.gateway.connections.dao import ConnectionsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine


pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


@pytest_asyncio.fixture
async def person_connection_id(trigger_scope):
    """A Composio connection of the scope's user: organization and user, no project."""
    connection_id = uuid.uuid4()
    async with get_transactions_engine().session() as session:
        organization_id = (
            await session.execute(
                text("SELECT organization_id FROM projects WHERE id = :id"),
                {"id": trigger_scope["project_id"]},
            )
        ).scalar_one()
        await session.execute(
            text(
                "INSERT INTO gateway_connections "
                "(id, organization_id, user_id, created_by_id, slug, provider_key, "
                "integration_key) "
                "VALUES (:id, :organization_id, :user_id, :user_id, 'mine', "
                "'composio', 'github')"
            ),
            {
                "id": connection_id,
                "organization_id": organization_id,
                "user_id": trigger_scope["user_id"],
            },
        )
        await session.commit()

    yield connection_id

    async with get_transactions_engine().session() as session:
        await session.execute(
            text("DELETE FROM gateway_connections WHERE id = :id"),
            {"id": connection_id},
        )
        await session.commit()


async def _insert_subscription(*, project_id, connection_id):
    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "INSERT INTO trigger_subscriptions (id, project_id, connection_id) "
                "VALUES (:id, :project_id, :connection_id)"
            ),
            {
                "id": uuid.uuid4(),
                "project_id": project_id,
                "connection_id": connection_id,
            },
        )
        await session.commit()


async def test_a_person_connection_cannot_be_an_event_connection(
    trigger_scope, person_connection_id
):
    # Positive control: the project's own connection is accepted.
    await _insert_subscription(
        project_id=trigger_scope["project_id"],
        connection_id=trigger_scope["connection_id"],
    )

    with pytest.raises(IntegrityError, match="fk_trigger_subscriptions_connection"):
        await _insert_subscription(
            project_id=trigger_scope["project_id"],
            connection_id=person_connection_id,
        )


async def test_the_project_connection_read_does_not_find_a_person_connection(
    trigger_scope, person_connection_id
):
    dao = ConnectionsDAO()

    assert (
        await dao.get_connection(
            project_id=trigger_scope["project_id"],
            connection_id=trigger_scope["connection_id"],
        )
        is not None
    )
    assert (
        await dao.get_connection(
            project_id=trigger_scope["project_id"],
            connection_id=person_connection_id,
        )
        is None
    )
