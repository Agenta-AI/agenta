"""Postgres contract for the MCP OAuth authorization attempt record (OD25).

The in-memory fake the unit suites use can only assert the shape. These cases assert
the properties the fix actually rests on against real Postgres: a handle is handed to
exactly one consumer even when two callbacks race it, a cancel reaches only pending
attempts of one connection, and the sweep removes only what is already past its expiry.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text

from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAttemptCreate,
    MCPOAuthAttemptStatus,
)
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
    """The row is locked as it is claimed: the loser of the race gets `None` rather
    than a second copy of the verifier."""
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
        assert winners[0].code_verifier == created.code_verifier
        claimed = await dao.fetch_attempt(state=created.state)
        assert claimed.status == MCPOAuthAttemptStatus.CLAIMED
        assert claimed.code_verifier == ""
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
async def test_cancelling_one_connections_attempts_leaves_every_other_connections(
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
        gone = await dao.cancel_attempts(
            project_id=seeded_project["project_id"],
            endpoint_id=dropped_endpoint,
        )

        assert gone == 2
        for attempt in dropped:
            cancelled = await dao.fetch_attempt(state=attempt.state)
            assert cancelled.status == MCPOAuthAttemptStatus.CANCELLED
            assert cancelled.code_verifier == ""
            assert await dao.consume_attempt(state=attempt.state) is None
        kept_now = await dao.fetch_attempt(state=kept.state)
        assert kept_now.status == MCPOAuthAttemptStatus.PENDING
    finally:
        await _cleanup(seeded_project["project_id"])


@pytest.mark.asyncio
async def test_cancelling_attempts_is_scoped_to_one_project(
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
        gone = await dao.cancel_attempts(
            project_id=seeded_project["project_id"], endpoint_id=endpoint_id
        )

        assert gone == 1
        mine_now = await dao.fetch_attempt(state=mine.state)
        theirs_now = await dao.fetch_attempt(state=theirs.state)
        assert mine_now.status == MCPOAuthAttemptStatus.CANCELLED
        assert theirs_now.status == MCPOAuthAttemptStatus.PENDING
    finally:
        await _cleanup(seeded_project["project_id"])
        await _cleanup(other_project["project_id"])


@pytest.mark.asyncio
async def test_cancelling_attempts_for_a_connection_that_has_none_is_not_an_error(
    seeded_project,
):
    """Disconnecting twice, or disconnecting with no consent in flight, is ordinary."""
    dao = MCPOAuthAttemptsDAO()

    assert (
        await dao.cancel_attempts(
            project_id=seeded_project["project_id"], endpoint_id=uuid4()
        )
        == 0
    )


@pytest.mark.asyncio
async def test_a_cancel_by_id_reaches_only_that_active_attempt(seeded_project):
    dao = MCPOAuthAttemptsDAO()
    endpoint_id = uuid4()
    named, other, claimed = [
        await dao.create_attempt(
            attempt=_attempt(
                project_id=seeded_project["project_id"],
                user_id=seeded_project["user_id"],
                endpoint_id=endpoint_id,
            )
        )
        for _ in range(3)
    ]
    await dao.consume_attempt(state=claimed.state)

    try:
        for attempt_id in (named.id, claimed.id):
            await dao.cancel_attempts(
                project_id=seeded_project["project_id"],
                endpoint_id=endpoint_id,
                attempt_id=attempt_id,
            )

        statuses = {
            attempt.id: (await dao.fetch_attempt(state=attempt.state)).status
            for attempt in (named, other, claimed)
        }
        # A claimed attempt is mid-exchange, and its finalization re-checks it under
        # the lock, so a cancel reaches it too.
        assert statuses == {
            named.id: MCPOAuthAttemptStatus.CANCELLED,
            other.id: MCPOAuthAttemptStatus.PENDING,
            claimed.id: MCPOAuthAttemptStatus.CANCELLED,
        }
    finally:
        await _cleanup(seeded_project["project_id"])


@pytest.mark.asyncio
async def test_a_settled_attempt_is_read_back_by_id_with_its_outcome(seeded_project):
    dao = MCPOAuthAttemptsDAO()
    created = await dao.create_attempt(
        attempt=_attempt(
            project_id=seeded_project["project_id"],
            user_id=seeded_project["user_id"],
        )
    )

    try:
        await dao.consume_attempt(state=created.state)
        await dao.settle_attempt(
            attempt_id=created.id,
            status=MCPOAuthAttemptStatus.FAILED,
            error="User declined",
        )

        read = await dao.fetch_attempt_by_id(
            project_id=seeded_project["project_id"],
            endpoint_id=created.endpoint_id,
            attempt_id=created.id,
        )
        assert read.status == MCPOAuthAttemptStatus.FAILED
        assert read.error == "User declined"
        assert (
            await dao.fetch_attempt_by_id(
                project_id=seeded_project["project_id"],
                endpoint_id=uuid4(),
                attempt_id=created.id,
            )
            is None
        )
    finally:
        await _cleanup(seeded_project["project_id"])


@pytest.mark.asyncio
async def test_a_cancel_waits_for_a_finalization_in_progress_and_then_changes_nothing(
    seeded_project,
):
    """The grant is written and bound inside the block. A cancel that arrives then must
    not report the attempt cancelled over a connection that is bound."""
    dao = MCPOAuthAttemptsDAO()
    created = await dao.create_attempt(
        attempt=_attempt(
            project_id=seeded_project["project_id"],
            user_id=seeded_project["user_id"],
        )
    )
    await dao.consume_attempt(state=created.state)

    try:
        async with dao.finalize_attempt(attempt_id=created.id) as settle:
            assert settle is not None
            cancelling = asyncio.create_task(
                dao.cancel_attempts(
                    project_id=seeded_project["project_id"],
                    endpoint_id=created.endpoint_id,
                )
            )
            await asyncio.sleep(0.2)
            assert not cancelling.done()
            await settle(MCPOAuthAttemptStatus.CONNECTED)

        assert await cancelling == 0
        read = await dao.fetch_attempt(state=created.state)
        assert read.status == MCPOAuthAttemptStatus.CONNECTED
    finally:
        await _cleanup(seeded_project["project_id"])


@pytest.mark.asyncio
async def test_a_cancelled_attempt_cannot_be_finalized_or_settled(seeded_project):
    dao = MCPOAuthAttemptsDAO()
    created = await dao.create_attempt(
        attempt=_attempt(
            project_id=seeded_project["project_id"],
            user_id=seeded_project["user_id"],
        )
    )
    await dao.consume_attempt(state=created.state)
    await dao.cancel_attempts(
        project_id=seeded_project["project_id"], endpoint_id=created.endpoint_id
    )

    try:
        async with dao.finalize_attempt(attempt_id=created.id) as settle:
            assert settle is None
        await dao.settle_attempt(
            attempt_id=created.id, status=MCPOAuthAttemptStatus.FAILED, error="late"
        )

        read = await dao.fetch_attempt(state=created.state)
        assert read.status == MCPOAuthAttemptStatus.CANCELLED
        assert read.error is None
    finally:
        await _cleanup(seeded_project["project_id"])
