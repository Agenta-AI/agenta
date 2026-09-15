"""Postgres contract for the MCP OAuth authorization attempt record (OD25).

The in-memory fake the unit suites use can only assert the shape. These cases assert
the two properties the fix actually rests on against real Postgres: a handle is handed
to exactly one consumer even when two callbacks race it, and the sweep removes only
what is already past its expiry.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text

from oss.src.core.gateways.mcps.oauth.dtos import MCPOAuthAttemptCreate
from oss.src.core.gateways.mcps.oauth.state import new_state
from oss.src.dbs.postgres.gateways.mcps.oauth_dao import MCPOAuthAttemptsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine

pytestmark = [pytest.mark.integration]


def _attempt(*, project_id, user_id, expires_in_seconds: int = 600, endpoint_id=None):
    return MCPOAuthAttemptCreate(
        state=new_state(),
        project_id=project_id,
        user_id=user_id,
        endpoint_id=endpoint_id or uuid4(),
        server_url="https://mcp.oauth.local/",
        issuer="https://auth.oauth.local/",
        token_endpoint="https://auth.oauth.local/token",
        redirect_uri="https://api.oauth.local/gateways/mcps/connect/callback",
        resource="https://mcp.oauth.local/",
        code_verifier="v" * 43,
        scopes=["tools:call"],
        strategy="outbound",
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=expires_in_seconds),
    )


async def _cleanup(project_id) -> None:
    engine = get_transactions_engine()
    async with engine.session() as session:
        await session.execute(
            text("DELETE FROM mcps_oauth_attempts WHERE project_id = :project_id"),
            {"project_id": project_id},
        )
        await session.commit()


@pytest.mark.asyncio
async def test_an_attempt_round_trips_every_field_the_callback_needs(seeded_project):
    dao = MCPOAuthAttemptsDAO()
    created = await dao.create_attempt(
        attempt=_attempt(
            project_id=seeded_project["project_id"],
            user_id=seeded_project["user_id"],
        )
    )

    try:
        fetched = await dao.fetch_attempt(state=created.state)

        assert fetched is not None
        assert fetched.id == created.id
        assert fetched.project_id == seeded_project["project_id"]
        assert fetched.user_id == seeded_project["user_id"]
        assert fetched.endpoint_id == created.endpoint_id
        assert fetched.code_verifier == created.code_verifier
        assert fetched.token_endpoint == created.token_endpoint
        assert fetched.redirect_uri == created.redirect_uri
        assert fetched.issuer == created.issuer
        assert fetched.scopes == ["tools:call"]
    finally:
        await _cleanup(seeded_project["project_id"])


@pytest.mark.asyncio
async def test_two_concurrent_callbacks_for_one_handle_yield_exactly_one_record(
    seeded_project,
):
    """`DELETE ... RETURNING` in one statement, not read-then-delete: the loser of the
    race gets `None` rather than a second copy of the verifier."""
    dao = MCPOAuthAttemptsDAO()
    created = await dao.create_attempt(
        attempt=_attempt(
            project_id=seeded_project["project_id"],
            user_id=seeded_project["user_id"],
        )
    )

    try:
        results = await asyncio.gather(
            dao.consume_attempt(state=created.state),
            dao.consume_attempt(state=created.state),
        )

        winners = [r for r in results if r is not None]
        assert len(winners) == 1
        assert winners[0].state == created.state
        assert await dao.fetch_attempt(state=created.state) is None
    finally:
        await _cleanup(seeded_project["project_id"])


@pytest.mark.asyncio
async def test_the_sweep_deletes_expired_attempts_and_leaves_live_ones(seeded_project):
    dao = MCPOAuthAttemptsDAO()
    live = await dao.create_attempt(
        attempt=_attempt(
            project_id=seeded_project["project_id"],
            user_id=seeded_project["user_id"],
        )
    )
    stale = await dao.create_attempt(
        attempt=_attempt(
            project_id=seeded_project["project_id"],
            user_id=seeded_project["user_id"],
            expires_in_seconds=-60,
        )
    )

    try:
        swept = await dao.sweep_expired_attempts()

        assert swept >= 1
        assert await dao.fetch_attempt(state=stale.state) is None
        assert await dao.fetch_attempt(state=live.state) is not None
    finally:
        await _cleanup(seeded_project["project_id"])


@pytest.mark.asyncio
async def test_dropping_one_connections_attempts_leaves_every_other_connections(
    seeded_project,
):
    """D5. Disconnecting has to reach the consents already in flight for that
    connection, and only for that connection: a person disconnecting one account must
    not cancel the consent they are part-way through for another."""
    dao = MCPOAuthAttemptsDAO()
    dropped_endpoint, kept_endpoint = uuid4(), uuid4()
    dropped = [
        await dao.create_attempt(
            attempt=_attempt(
                project_id=seeded_project["project_id"],
                user_id=seeded_project["user_id"],
                endpoint_id=dropped_endpoint,
            )
        )
        for _ in range(2)
    ]
    kept = await dao.create_attempt(
        attempt=_attempt(
            project_id=seeded_project["project_id"],
            user_id=seeded_project["user_id"],
            endpoint_id=kept_endpoint,
        )
    )

    try:
        gone = await dao.drop_attempts_for_endpoint(
            project_id=seeded_project["project_id"],
            endpoint_id=dropped_endpoint,
        )

        assert gone == 2
        for attempt in dropped:
            assert await dao.fetch_attempt(state=attempt.state) is None
        assert await dao.fetch_attempt(state=kept.state) is not None
    finally:
        await _cleanup(seeded_project["project_id"])


@pytest.mark.asyncio
async def test_dropping_attempts_is_scoped_to_one_project(
    seeded_project, other_project
):
    """The same connection id in another tenant is a different connection."""
    dao = MCPOAuthAttemptsDAO()
    endpoint_id = uuid4()
    mine = await dao.create_attempt(
        attempt=_attempt(
            project_id=seeded_project["project_id"],
            user_id=seeded_project["user_id"],
            endpoint_id=endpoint_id,
        )
    )
    theirs = await dao.create_attempt(
        attempt=_attempt(
            project_id=other_project["project_id"],
            user_id=other_project["user_id"],
            endpoint_id=endpoint_id,
        )
    )

    try:
        gone = await dao.drop_attempts_for_endpoint(
            project_id=seeded_project["project_id"], endpoint_id=endpoint_id
        )

        assert gone == 1
        assert await dao.fetch_attempt(state=mine.state) is None
        assert await dao.fetch_attempt(state=theirs.state) is not None
    finally:
        await _cleanup(seeded_project["project_id"])
        await _cleanup(other_project["project_id"])


@pytest.mark.asyncio
async def test_dropping_attempts_for_a_connection_that_has_none_is_not_an_error(
    seeded_project,
):
    """Disconnecting twice, or disconnecting with no consent in flight, is ordinary."""
    dao = MCPOAuthAttemptsDAO()

    assert (
        await dao.drop_attempts_for_endpoint(
            project_id=seeded_project["project_id"], endpoint_id=uuid4()
        )
        == 0
    )
