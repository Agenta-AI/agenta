"""Session streams service — coordination plane.

Edits the Redis nest (alive ⊇ running ⊇ attached) and mirrors it to the durable
session_streams row. Runs nothing itself: the runner (execution plane) is the only
component that runs an agent.

Command matrix (prompt × force):
  prompt + no force  → SEND   (409 if alive)
  prompt + force     → STEER  (cancel holder, start a new turn)
  no prompt + no f.  → CANCEL (cancel holder, run nothing)
  no prompt + force  → ATTACH (steal attached, watch the live turn)
  detach / kill      → explicit lifecycle edits (see methods)
"""

import uuid_utils.compat as uuid
from typing import List, Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.dbs.redis.sessions.contract import (
    CONCURRENCY_CAP,
    validate_session_id as _validate_session_id_fn,
)
from oss.src.dbs.redis.sessions.locks import (
    acquire_alive,
    acquire_running,
    clear_running,
    force_cancel_alive,
    get_session_liveness,
    refresh_alive,
    refresh_owner,
    refresh_running,
    release_attached,
    steal_attached,
)

from oss.src.core.sessions.streams.dtos import (
    CommandMode,
    SessionHeartbeatRequest,
    SessionStream,
    SessionStreamCommandRequest,
    SessionStreamCommandResponse,
    SessionStreamCreate,
    SessionStreamEdit,
    SessionStreamFlags,
    SessionStreamQuery,
    SessionStreamStatus,
    StreamStatusCode,
)
from oss.src.core.sessions.streams.types import (
    ConcurrencyCapExceeded,
    SessionIdInvalid,
    SessionTurnInUse,
)
from oss.src.core.sessions.streams.interfaces import SessionStreamsDAOInterface

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

        has_prompt = bool(request.prompt and request.prompt.strip())

        if has_prompt and not request.force:
            mode = CommandMode.send
        elif has_prompt and request.force:
            mode = CommandMode.steer
        elif not has_prompt and not request.force:
            mode = CommandMode.cancel
        else:
            mode = CommandMode.attach

        session_id = request.session_id

        if mode == CommandMode.send:
            liveness = await get_session_liveness(self._lock, session_id=session_id)
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
            await force_cancel_alive(self._lock, session_id=session_id)
            await clear_running(self._lock, session_id=session_id)
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
            await force_cancel_alive(self._lock, session_id=session_id)
            await clear_running(self._lock, session_id=session_id)
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
        """KILL: collapse the whole nest and end the stream.

        Force-clears alive + running + attached in Redis (losing the alive lock is the
        runner's existing teardown signal), marks the row ended, and soft-deletes it.
        Idempotent: a kill on an already-dead session is a no-op success.
        """
        _validate_session_id(session_id)
        await force_cancel_alive(self._lock, session_id=session_id)
        await clear_running(self._lock, session_id=session_id)
        # Displace any watcher by stealing then releasing a throwaway attach token.
        throwaway = str(uuid.uuid7())
        await steal_attached(self._lock, session_id=session_id, watcher_id=throwaway)
        await release_attached(self._lock, session_id=session_id, watcher_id=throwaway)
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
    ) -> SessionStream:
        _validate_session_id(request.session_id)

        # replica_id refreshes affinity (which container owns the session);
        # turn_id refreshes the alive/running TTLs (proving this turn still owns the lock).
        await refresh_owner(
            self._lock,
            session_id=request.session_id,
            replica_id=request.replica_id,
        )
        if request.turn_id and request.is_running:
            await refresh_alive(
                self._lock,
                session_id=request.session_id,
                turn_id=request.turn_id,
            )
            await refresh_running(
                self._lock,
                session_id=request.session_id,
                turn_id=request.turn_id,
            )

        liveness = await get_session_liveness(self._lock, session_id=request.session_id)
        flags = SessionStreamFlags(
            is_alive=liveness["alive"],
            is_running=liveness["running"],
            is_attached=liveness["attached"],
        )

        stream = await self._dao.get_by_session_id(
            project_id=project_id,
            session_id=request.session_id,
        )

        status = request.status or SessionStreamStatus(
            code=StreamStatusCode.running
            if request.is_running
            else StreamStatusCode.idle
        )

        if stream is None:
            stream = await self._dao.create(
                project_id=project_id,
                user_id=None,
                stream=SessionStreamCreate(
                    session_id=request.session_id,
                    flags=flags,
                    turn_id=request.turn_id,
                    status=status,
                ),
            )
        else:
            stream = await self._dao.update(
                project_id=project_id,
                user_id=None,
                session_id=request.session_id,
                stream=SessionStreamEdit(
                    flags=flags, turn_id=request.turn_id, status=status
                ),
            )
        return stream

    async def fetch(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionStream]:
        """Single source-of-truth read: reconcile the Redis nest into the row's flags."""
        _validate_session_id(session_id)
        snap = await get_session_liveness(self._lock, session_id=session_id)
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

    async def query_streams(
        self,
        *,
        project_id: UUID,
        filter: SessionStreamQuery,
    ) -> List[SessionStream]:
        if filter.session_id:
            _validate_session_id(filter.session_id)
        return await self._dao.query(project_id=project_id, filter=filter)

    async def check_concurrency_cap(self, *, project_id: UUID) -> None:
        """Raise ConcurrencyCapExceeded if the per-replica cap is reached."""
        count = await self._dao.count_active(project_id=None)
        if count >= CONCURRENCY_CAP:
            raise ConcurrencyCapExceeded(cap=CONCURRENCY_CAP)

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
            session_id=session_id,
            turn_id=turn_id,
        )
        if not acquired:
            liveness = await get_session_liveness(self._lock, session_id=session_id)
            raise SessionTurnInUse(session_id=session_id, liveness=liveness)

        await acquire_running(self._lock, session_id=session_id, turn_id=turn_id)

        flags = SessionStreamFlags(is_alive=True, is_running=True, is_attached=False)
        status = SessionStreamStatus(code=StreamStatusCode.running)
        stream = await self._dao.get_by_session_id(
            project_id=project_id,
            session_id=session_id,
        )
        if stream is None:
            await self._dao.create(
                project_id=project_id,
                user_id=user_id,
                stream=SessionStreamCreate(
                    session_id=session_id,
                    flags=flags,
                    turn_id=turn_id,
                    status=status,
                ),
            )
        else:
            await self._dao.update(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                stream=SessionStreamEdit(flags=flags, turn_id=turn_id, status=status),
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
        snap = await get_session_liveness(self._lock, session_id=session_id)
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
                status=SessionStreamStatus(code=StreamStatusCode.ended),
            ),
        )
