"""Session streams service — coordination plane.

Edits the Redis nest (alive ⊇ running ⊇ attached) and mirrors it to the durable
session_streams row. Runs nothing itself: the runner (execution plane) is the only
component that runs an agent.

Command matrix (inputs/data × force):
  inputs + no force  → SEND   (409 if alive)
  inputs + force     → STEER  (cancel holder, start a new turn)
  no inputs + no f.  → CANCEL (cancel holder, run nothing)
  no inputs + force  → ATTACH (steal attached, watch the live turn)
  detach / kill      → explicit lifecycle edits (see methods)
"""

import uuid_utils.compat as uuid
from typing import List, Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.dbs.redis.sessions.contract import (
    CONCURRENCY_LIMIT,
    validate_session_id as _validate_session_id_fn,
)
from oss.src.dbs.redis.sessions.locks import (
    acquire_alive,
    acquire_running,
    claim_owner,
    clear_running,
    force_cancel_alive,
    force_clear_owner,
    get_session_liveness,
    refresh_alive,
    refresh_running,
    release_attached,
    steal_attached,
)

from oss.src.core.sessions.streams.dtos import (
    CommandMode,
    SessionHeartbeatRequest,
    SessionHeartbeatResult,
    SessionStream,
    SessionStreamCommandRequest,
    SessionStreamCommandResponse,
    SessionStreamCreate,
    SessionStreamEdit,
    SessionStreamFlags,
    SessionStreamHeaderEdit,
    SessionStreamQuery,
)
from oss.src.core.sessions.streams.types import (
    ConcurrencyLimitExceeded,
    SessionIdInvalid,
    SessionStreamAlreadyExists,
    SessionTurnInUse,
)
from oss.src.core.sessions.streams.interfaces import SessionStreamsDAOInterface
from oss.src.core.sessions.streams.runner_client import kill_runner_sandbox
from oss.src.core.shared.dtos import Windowing

log = get_module_logger(__name__)


def _validate_session_id(session_id: str) -> None:
    if not _validate_session_id_fn(session_id):
        raise SessionIdInvalid(session_id)


class SessionStreamsService:
    def __init__(
        self,
        *,
        streams_dao: SessionStreamsDAOInterface,
        lock_engine: LockEngine,
    ) -> None:
        self._dao = streams_dao
        self._lock = lock_engine

    async def command(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        request: SessionStreamCommandRequest,
    ) -> SessionStreamCommandResponse:
        _validate_session_id(request.session_id)

        has_inputs = bool(request.data and request.data.inputs)

        if has_inputs and not request.force:
            mode = CommandMode.send
        elif has_inputs and request.force:
            mode = CommandMode.steer
        elif not has_inputs and not request.force:
            mode = CommandMode.cancel
        else:
            mode = CommandMode.attach

        session_id = request.session_id

        if mode == CommandMode.send:
            liveness = await get_session_liveness(
                self._lock, project_id=str(project_id), session_id=session_id
            )
            if liveness["alive"]:
                raise SessionTurnInUse(session_id=session_id, liveness=liveness)
            turn_id = await self._start_turn(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
            )
            return SessionStreamCommandResponse(
                mode=mode,
                session_id=session_id,
                turn_id=turn_id,
                detached=request.detached,
            )

        elif mode == CommandMode.steer:
            await force_cancel_alive(
                self._lock, project_id=str(project_id), session_id=session_id
            )
            await clear_running(
                self._lock, project_id=str(project_id), session_id=session_id
            )
            turn_id = await self._start_turn(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
            )
            return SessionStreamCommandResponse(
                mode=mode,
                session_id=session_id,
                turn_id=turn_id,
                detached=request.detached,
            )

        elif mode == CommandMode.cancel:
            await force_cancel_alive(
                self._lock, project_id=str(project_id), session_id=session_id
            )
            await clear_running(
                self._lock, project_id=str(project_id), session_id=session_id
            )
            await self._mark_stream_ended(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
            )
            return SessionStreamCommandResponse(
                mode=mode,
                session_id=session_id,
                detached=True,
            )

        else:  # ATTACH
            watcher_id = str(uuid.uuid7())
            await steal_attached(
                self._lock,
                project_id=str(project_id),
                session_id=session_id,
                watcher_id=watcher_id,
            )
            await self._mirror_flags(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                is_attached=True,
            )
            return SessionStreamCommandResponse(
                mode=mode,
                session_id=session_id,
                watcher_id=watcher_id,
                detached=False,
            )

    async def detach(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        watcher_id: str,
    ) -> None:
        """DETACH: drop the attached lock only; the turn keeps running."""
        _validate_session_id(session_id)
        await release_attached(
            self._lock,
            project_id=str(project_id),
            session_id=session_id,
            watcher_id=watcher_id,
        )
        await self._mirror_flags(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            is_attached=False,
        )

    async def kill(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
    ) -> bool:
        """KILL: tear down the sandbox and collapse the whole nest. KILL != CANCEL — cancel
        only ends the current turn (the session/sandbox can resume); kill ends the session.

        Force-clears alive + running + attached + owner in Redis (losing the alive lock is
        the runner's existing teardown signal for its OWN in-process bookkeeping), calls the
        runner's `/kill` directly so the actual sandbox is torn down rather than left to its
        own idle-TTL eviction (W7.3 — a bare Redis/row edit is not sandbox teardown), marks the
        row ended, and soft-deletes it. Idempotent: a kill on an already-dead session, or one
        whose runner replica is unreachable, is still a no-op success (best-effort teardown).
        """
        _validate_session_id(session_id)
        await force_cancel_alive(
            self._lock, project_id=str(project_id), session_id=session_id
        )
        await clear_running(
            self._lock, project_id=str(project_id), session_id=session_id
        )
        # Drop affinity too: claim_owner never steals, so a surviving owner key would lock
        # the session out of every other replica for the rest of OWNER_TTL_SECONDS.
        await force_clear_owner(
            self._lock, project_id=str(project_id), session_id=session_id
        )
        # Displace any watcher by stealing then releasing a throwaway attach token.
        throwaway = str(uuid.uuid7())
        await steal_attached(
            self._lock,
            project_id=str(project_id),
            session_id=session_id,
            watcher_id=throwaway,
        )
        await release_attached(
            self._lock,
            project_id=str(project_id),
            session_id=session_id,
            watcher_id=throwaway,
        )
        # Best-effort: the Redis/row edit above is authoritative and must not depend on this
        # succeeding — see runner_client.kill_runner_sandbox's docstring.
        await kill_runner_sandbox(project_id=str(project_id), session_id=session_id)
        await self._mark_stream_ended(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
        )
        return await self._dao.delete_by_session_id(
            project_id=project_id,
            session_id=session_id,
        )

    async def heartbeat(
        self,
        *,
        project_id: UUID,
        request: SessionHeartbeatRequest,
    ) -> SessionHeartbeatResult:
        _validate_session_id(request.session_id)

        # replica_id claims affinity without stealing from a live different owner; turn_id
        # separately refreshes the alive/running TTLs. `owner` is the actual winner (this
        # replica if it won or already held it, another replica otherwise).
        owner = await claim_owner(
            self._lock,
            project_id=str(project_id),
            session_id=request.session_id,
            replica_id=request.replica_id,
        )
        # A replica that lost the claim owns nothing here: mutating the nest would let it
        # overwrite the winner's turn locks and stream row. Report the true owner and stop.
        if owner != request.replica_id:
            stream = await self._dao.get_by_session_id(
                project_id=project_id,
                session_id=request.session_id,
            )
            return SessionHeartbeatResult(
                stream=stream, replica_id=owner, is_current_turn=False
            )

        # True only when this turn_id still (or again, uninterrupted) owns the alive lock at
        # the moment of this heartbeat. A cancel/steer/kill deletes the alive key entirely,
        # which the nx=True re-acquire below would otherwise silently re-establish under the
        # SAME turn_id, masking the interruption from the runner's watchdog (W7.4 — this is
        # what `is_current_turn` exists to surface). An absent key is ambiguous by itself: it
        # is also the normal state before this turn's VERY FIRST heartbeat (the API's
        # `_start_turn` acquire may not have landed yet, or this beat wins a race with it), and
        # that is NOT an interruption. Disambiguate with the durable row's `turn_id`: if it
        # already recorded THIS turn_id as established (a prior heartbeat's write), the key
        # being gone now is something else's doing; if the row shows no turn yet, or a
        # different one, this is establishment.
        prior_stream = await self._dao.get_by_session_id(
            project_id=project_id,
            session_id=request.session_id,
        )
        turn_was_established = bool(
            prior_stream and prior_stream.turn_id == request.turn_id
        )
        is_current_turn = True

        if request.turn_id and request.is_running:
            # Acquire-then-refresh: the first heartbeat must establish the nest locks
            # itself (acquire_* is nx=True — a no-op if _start_turn already holds them).
            if not await refresh_alive(
                self._lock,
                project_id=str(project_id),
                session_id=request.session_id,
                turn_id=request.turn_id,
            ):
                if turn_was_established:
                    is_current_turn = False
                await acquire_alive(
                    self._lock,
                    project_id=str(project_id),
                    session_id=request.session_id,
                    turn_id=request.turn_id,
                )
            if not await refresh_running(
                self._lock,
                project_id=str(project_id),
                session_id=request.session_id,
                turn_id=request.turn_id,
            ):
                if turn_was_established:
                    is_current_turn = False
                await acquire_running(
                    self._lock,
                    project_id=str(project_id),
                    session_id=request.session_id,
                    turn_id=request.turn_id,
                )
        elif not request.is_running:
            # Turn ended: drop only `running`. `alive` outlives the turn (own TTL, cleared
            # only by kill) — this is what makes the session reattachable.
            await clear_running(
                self._lock, project_id=str(project_id), session_id=request.session_id
            )

        liveness = await get_session_liveness(
            self._lock, project_id=str(project_id), session_id=request.session_id
        )
        flags = SessionStreamFlags(
            is_alive=liveness["alive"],
            is_running=liveness["running"],
            is_attached=liveness["attached"],
        )

        # Nothing between `prior_stream`'s fetch above and here mutates the row, so it is
        # still the current read — no need to re-fetch.
        stream = prior_stream

        if stream is None:
            try:
                stream = await self._dao.create(
                    project_id=project_id,
                    user_id=None,
                    stream=SessionStreamCreate(
                        session_id=request.session_id,
                        flags=flags,
                        turn_id=request.turn_id,
                    ),
                )
            except SessionStreamAlreadyExists:
                # `_start_turn` won the first-touch race; fall through and update its row.
                stream = None

        if stream is None:
            stream = await self._dao.update(
                project_id=project_id,
                user_id=None,
                session_id=request.session_id,
                stream=SessionStreamEdit(flags=flags, turn_id=request.turn_id),
            )
        return SessionHeartbeatResult(
            stream=stream,
            replica_id=owner,
            is_current_turn=is_current_turn,
        )

    async def fetch(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionStream]:
        """Single source-of-truth read: reconcile the Redis nest into the row's flags."""
        _validate_session_id(session_id)
        snap = await get_session_liveness(
            self._lock, project_id=str(project_id), session_id=session_id
        )
        flags = SessionStreamFlags(
            is_alive=snap["alive"],
            is_running=snap["running"],
            is_attached=snap["attached"],
        )
        stream = await self._dao.get_by_session_id(
            project_id=project_id,
            session_id=session_id,
        )
        if stream is None:
            return None
        # Redis is authoritative for the nest bools; overlay them on the durable row.
        stream.flags = flags
        return stream

    async def fetch_header(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionStream]:
        """Fetch the session header (name/description/flags/lifecycle) — used by
        GET /sessions/streams/. Reads the same reconciled row as `fetch`.
        """
        return await self.fetch(project_id=project_id, session_id=session_id)

    async def set_header(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        header: SessionStreamHeaderEdit,
    ) -> Optional[SessionStream]:
        """The rename edit: full-PUT {name, description} onto the merged stream row.

        Pure DB write — no Redis nest interaction, no flags/turn_id touched. Off the
        runner's write path. Creates the row if the session has never heartbeat/run
        yet (a caller may name a session before its first turn), mirroring
        `_start_turn`'s create-or-update pattern.
        """
        _validate_session_id(session_id)
        updated = await self._dao.update_header(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            header=header,
        )
        if updated is not None:
            return updated
        try:
            return await self._dao.create(
                project_id=project_id,
                user_id=user_id,
                stream=SessionStreamCreate(
                    session_id=session_id,
                    name=header.name,
                    description=header.description,
                ),
            )
        except SessionStreamAlreadyExists:
            # A concurrent first touch (heartbeat/rename) won the race; the row now
            # exists — apply the header edit onto it.
            return await self._dao.update_header(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                header=header,
            )

    async def query_streams(
        self,
        *,
        project_id: UUID,
        filter: SessionStreamQuery,
        windowing: Optional[Windowing] = None,
        session_ids: Optional[List[str]] = None,
    ) -> List[SessionStream]:
        if filter.session_id:
            _validate_session_id(filter.session_id)
        return await self._dao.query(
            project_id=project_id,
            filter=filter,
            windowing=windowing,
            session_ids=session_ids,
        )

    async def hard_delete(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> bool:
        """Hard delete the merged stream row (S7 delete fan-out, WP5). Distinct
        from `kill`, which only soft-deletes via `delete_by_session_id`."""
        _validate_session_id(session_id)
        return await self._dao.hard_delete_by_session_id(
            project_id=project_id,
            session_id=session_id,
        )

    async def archive(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionStream]:
        """Soft-archive the stream row (S7/F2 archive fan-out, WP5). Returns the
        archived row (`deleted_at` set) as the caller's confirmation read."""
        _validate_session_id(session_id)
        await self._dao.delete_by_session_id(
            project_id=project_id,
            session_id=session_id,
        )
        return await self._dao.get_by_session_id_including_archived(
            project_id=project_id,
            session_id=session_id,
        )

    async def unarchive(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
    ) -> Optional[SessionStream]:
        """Reverse of `archive`: clears `deleted_at` on the stream row."""
        _validate_session_id(session_id)
        return await self._dao.unarchive_by_session_id(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
        )

    async def check_runner_concurrency_limit(self, *, project_id: UUID) -> None:
        """Raise ConcurrencyLimitExceeded if the per-project limit is reached."""
        count = await self._dao.count_active(project_id=project_id)
        if count >= CONCURRENCY_LIMIT:
            raise ConcurrencyLimitExceeded(limit=CONCURRENCY_LIMIT)

    async def _start_turn(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
    ) -> str:
        turn_id = str(uuid.uuid7())
        acquired = await acquire_alive(
            self._lock,
            project_id=str(project_id),
            session_id=session_id,
            turn_id=turn_id,
        )
        if not acquired:
            liveness = await get_session_liveness(
                self._lock, project_id=str(project_id), session_id=session_id
            )
            raise SessionTurnInUse(session_id=session_id, liveness=liveness)

        await acquire_running(
            self._lock,
            project_id=str(project_id),
            session_id=session_id,
            turn_id=turn_id,
        )

        flags = SessionStreamFlags(is_alive=True, is_running=True, is_attached=False)
        stream = await self._dao.get_by_session_id(
            project_id=project_id,
            session_id=session_id,
        )
        created = False
        if stream is None:
            try:
                await self._dao.create(
                    project_id=project_id,
                    user_id=user_id,
                    stream=SessionStreamCreate(
                        session_id=session_id,
                        flags=flags,
                        turn_id=turn_id,
                    ),
                )
                created = True
            except SessionStreamAlreadyExists:
                # A concurrent first touch won; its row is the one we wanted.
                pass
        if not created:
            await self._dao.update(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                stream=SessionStreamEdit(flags=flags, turn_id=turn_id),
            )
        return turn_id

    async def _mirror_flags(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        is_attached: Optional[bool] = None,
    ) -> None:
        """Re-read the Redis nest and mirror it (optionally overriding is_attached)."""
        snap = await get_session_liveness(
            self._lock, project_id=str(project_id), session_id=session_id
        )
        flags = SessionStreamFlags(
            is_alive=snap["alive"],
            is_running=snap["running"],
            is_attached=snap["attached"] if is_attached is None else is_attached,
        )
        await self._dao.update(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            stream=SessionStreamEdit(flags=flags),
        )

    async def _mark_stream_ended(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
    ) -> None:
        await self._dao.update(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            stream=SessionStreamEdit(
                flags=SessionStreamFlags(
                    is_alive=False, is_running=False, is_attached=False
                ),
            ),
        )
