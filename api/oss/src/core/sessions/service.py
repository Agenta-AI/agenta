"""Session streams service — orchestrates the Redis coordination plane and the
durable session_streams table.

DATA/FORCE control matrix:
  prompt + no force  → SEND   (409 if a run is alive)
  prompt + force     → STEER  (cancel holder, run new prompt)
  no prompt + no f.  → CANCEL (cancel holder, run nothing)
  no prompt + force  → ATTACH (steal attached, watch live run)
  conn closes        → DETACH (drop attached; run keeps going)
"""

import uuid_utils.compat as uuid
from datetime import datetime, timezone
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
    force_cancel_alive,
    get_session_liveness,
    refresh_owner,
    release_attached,
    steal_attached,
)

from oss.src.core.sessions.dtos import (
    InvokeMode,
    SessionHeartbeatRequest,
    SessionInvokeRequest,
    SessionInvokeResponse,
    SessionLiveness,
    SessionStream,
    SessionStreamCreate,
    SessionStreamEdit,
    SessionStreamQuery,
    SessionStreamStatus,
    StreamStatusCode,
)
from oss.src.core.sessions.exceptions import (
    ConcurrencyCapExceeded,
    SessionIdInvalid,
    SessionRunInUse,
)
from oss.src.core.sessions.interfaces import SessionStreamsDAOInterface

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

    # ------------------------------------------------------------------
    # Control-plane: invoke (DATA/FORCE matrix)
    # ------------------------------------------------------------------

    async def invoke(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        request: SessionInvokeRequest,
    ) -> SessionInvokeResponse:
        _validate_session_id(request.session_id)

        has_prompt = bool(request.prompt and request.prompt.strip())

        # Determine mode from DATA/FORCE matrix.
        if has_prompt and not request.force:
            mode = InvokeMode.send
        elif has_prompt and request.force:
            mode = InvokeMode.steer
        elif not has_prompt and not request.force:
            mode = InvokeMode.cancel
        else:  # not has_prompt and force
            mode = InvokeMode.attach

        session_id = request.session_id

        if mode == InvokeMode.send:
            liveness = await get_session_liveness(self._lock, session_id=session_id)
            if liveness["alive"]:
                raise SessionRunInUse(session_id=session_id, liveness=liveness)
            run_id = await self._start_run(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                prompt=request.prompt,
                detached=request.detached,
            )
            return SessionInvokeResponse(
                mode=mode,
                session_id=session_id,
                run_id=run_id,
                detached=request.detached,
            )

        elif mode == InvokeMode.steer:
            await force_cancel_alive(self._lock, session_id=session_id)
            run_id = await self._start_run(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                prompt=request.prompt,
                detached=request.detached,
            )
            return SessionInvokeResponse(
                mode=mode,
                session_id=session_id,
                run_id=run_id,
                detached=request.detached,
            )

        elif mode == InvokeMode.cancel:
            await force_cancel_alive(self._lock, session_id=session_id)
            await self._mark_stream_ended(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
            )
            return SessionInvokeResponse(
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
            return SessionInvokeResponse(
                mode=mode,
                session_id=session_id,
                run_id=watcher_id,
                detached=False,
            )

    async def detach(
        self,
        *,
        session_id: str,
        watcher_id: str,
    ) -> None:
        """DETACH: drop attached lock only; run keeps going."""
        _validate_session_id(session_id)
        await release_attached(
            self._lock,
            session_id=session_id,
            watcher_id=watcher_id,
        )

    # ------------------------------------------------------------------
    # Heartbeat (runner → API → durable store)
    # ------------------------------------------------------------------

    async def heartbeat(
        self,
        *,
        project_id: UUID,
        request: SessionHeartbeatRequest,
    ) -> SessionStream:
        # Runner-internal write: no acting user, so the row is system-authored
        # (lifecycle *_by_id stays NULL).
        _validate_session_id(request.session_id)

        # Refresh the owner lock (which replica holds this session) on the hot path.
        # The alive/run lock is refreshed by the run path, not a container heartbeat.
        await refresh_owner(
            self._lock,
            session_id=request.session_id,
            replica_id=request.replica_id,
        )

        # Throttled Postgres write — only on state change or threshold elapsed.
        stream = await self._dao.get_by_session_id(
            project_id=project_id,
            session_id=request.session_id,
        )

        now = datetime.now(timezone.utc)
        if stream is None:
            stream = await self._dao.create(
                project_id=project_id,
                user_id=None,
                stream=SessionStreamCreate(
                    session_id=request.session_id,
                    sandbox_live=request.sandbox_live,
                    status=request.status
                    or SessionStreamStatus(code=StreamStatusCode.running),
                ),
            )
        else:
            # Throttled write: only update if sandbox_live changed or enough time elapsed.
            from oss.src.dbs.redis.sessions.contract import (
                HEARTBEAT_WRITE_THRESHOLD_SECONDS,
            )

            needs_write = (
                stream.sandbox_live != request.sandbox_live
                or stream.last_seen_at is None
                or (now - stream.last_seen_at).total_seconds()
                >= HEARTBEAT_WRITE_THRESHOLD_SECONDS
            )
            if needs_write:
                stream = await self._dao.update(
                    project_id=project_id,
                    user_id=None,
                    session_id=request.session_id,
                    stream=SessionStreamEdit(
                        sandbox_live=request.sandbox_live,
                        last_seen_at=now,
                        status=request.status,
                    ),
                )
        return stream

    # ------------------------------------------------------------------
    # Query / liveness
    # ------------------------------------------------------------------

    async def get_liveness(
        self,
        *,
        session_id: str,
    ) -> SessionLiveness:
        _validate_session_id(session_id)
        snap = await get_session_liveness(self._lock, session_id=session_id)
        return SessionLiveness(**snap)

    async def query_streams(
        self,
        *,
        project_id: UUID,
        filter: SessionStreamQuery,
    ) -> List[SessionStream]:
        if filter.session_id:
            _validate_session_id(filter.session_id)
        return await self._dao.query(project_id=project_id, filter=filter)

    async def get_stream_by_session(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionStream]:
        _validate_session_id(session_id)
        return await self._dao.get_by_session_id(
            project_id=project_id,
            session_id=session_id,
        )

    # ------------------------------------------------------------------
    # Concurrency cap check
    # ------------------------------------------------------------------

    async def check_concurrency_cap(self, *, project_id: UUID) -> None:
        """Raise ConcurrencyCapExceeded if the per-replica cap is reached."""
        count = await self._dao.count_active(project_id=None)
        if count >= CONCURRENCY_CAP:
            raise ConcurrencyCapExceeded(cap=CONCURRENCY_CAP)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _start_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
        prompt: Optional[str],
        detached: bool,
    ) -> str:
        run_id = str(uuid.uuid7())
        acquired = await acquire_alive(
            self._lock,
            session_id=session_id,
            run_id=run_id,
        )
        if not acquired:
            liveness = await get_session_liveness(self._lock, session_id=session_id)
            raise SessionRunInUse(session_id=session_id, liveness=liveness)

        stream = await self._dao.get_by_session_id(
            project_id=project_id,
            session_id=session_id,
        )
        status = SessionStreamStatus(code=StreamStatusCode.running)
        if stream is None:
            await self._dao.create(
                project_id=project_id,
                user_id=user_id,
                stream=SessionStreamCreate(
                    session_id=session_id,
                    sandbox_live=True,
                    status=status,
                ),
            )
        else:
            await self._dao.update(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                stream=SessionStreamEdit(
                    sandbox_live=True,
                    last_seen_at=datetime.now(timezone.utc),
                    status=status,
                ),
            )
        return run_id

    async def _mark_stream_ended(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
    ) -> None:
        await self._dao.update(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            stream=SessionStreamEdit(
                sandbox_live=False,
                status=SessionStreamStatus(code=StreamStatusCode.ended),
            ),
        )
