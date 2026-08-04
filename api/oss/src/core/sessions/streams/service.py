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
from typing import Any, Dict, Iterable, List, Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.dbs.redis.sessions.contract import (
    CONCURRENCY_LIMIT,
    WATCH_LIFECYCLE_ENDED,
    WATCH_LIFECYCLE_RUNNING,
    validate_session_id as _validate_session_id_fn,
)
from oss.src.core.sessions.watch.interfaces import SessionsWatchPublisherInterface
from oss.src.dbs.redis.sessions.locks import (
    acquire_alive,
    acquire_running,
    claim_owner,
    clear_running,
    release_running,
    force_cancel_alive,
    force_clear_owner,
    get_alive_owner,
    get_owner,
    get_running_owner,
    get_session_liveness,
    is_turn_superseded,
    mark_turn_superseded,
    refresh_alive,
    refresh_running,
    release_alive,
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
from oss.src.core.sessions.dtos import (
    SESSION_ORIGIN_TAG,
    SESSION_TRIGGER_ID_TAG,
    SESSION_TRIGGER_KIND_TAG,
    SESSION_TRIGGER_NAME_TAG,
    SessionTriggerRef,
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
        watch_publisher: Optional[SessionsWatchPublisherInterface] = None,
    ) -> None:
        self._dao = streams_dao
        self._lock = lock_engine
        self._watch = watch_publisher

    async def _supersede_turns(
        self,
        *,
        project_id: UUID,
        session_id: str,
        turn_ids: Iterable[Optional[str]],
    ) -> None:
        """Tombstone every turn displaced by this edit. `displaced ⇒ dead` is the invariant
        that makes the ambiguous "`alive` held by another turn + no `running`" state safe to
        resolve as a handover: only a turn that has never been displaced can reach it."""
        for turn_id in {t for t in turn_ids if t}:
            await mark_turn_superseded(
                self._lock,
                project_id=str(project_id),
                session_id=session_id,
                turn_id=turn_id,
            )

    async def _displace_turns(self, *, project_id: UUID, session_id: str) -> None:
        """Tear alive+running off whichever turn holds them, tombstoning it first.

        The order is the point. Clearing first leaves a window in which the turn being
        displaced heartbeats, finds `alive` free and nx-acquires it straight back - a
        cancelled session then reads as alive for a whole ALIVE_TTL. Tombstoning first makes
        that beat refuse itself. The keys are still re-read after the clear, so a turn that
        took them inside the window is tombstoned too.
        """
        await self._supersede_turns(
            project_id=project_id,
            session_id=session_id,
            turn_ids=(
                await get_alive_owner(
                    self._lock, project_id=str(project_id), session_id=session_id
                ),
                await get_running_owner(
                    self._lock, project_id=str(project_id), session_id=session_id
                ),
            ),
        )
        displaced_alive = await force_cancel_alive(
            self._lock, project_id=str(project_id), session_id=session_id
        )
        displaced_running = await clear_running(
            self._lock, project_id=str(project_id), session_id=session_id
        )
        await self._supersede_turns(
            project_id=project_id,
            session_id=session_id,
            turn_ids=(displaced_alive, displaced_running),
        )

    async def _publish_lifecycle(
        self, *, project_id: UUID, session_id: str, state: str
    ) -> None:
        # Fire-and-forget relay notification; the publisher never raises.
        if self._watch is not None:
            await self._watch.lifecycle(
                project_id=str(project_id),
                session_id=session_id,
                state=state,
            )

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
            await self._displace_turns(project_id=project_id, session_id=session_id)
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
            await self._displace_turns(project_id=project_id, session_id=session_id)
            await self._mark_stream_ended(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
            )
            await self._publish_lifecycle(
                project_id=project_id,
                session_id=session_id,
                state=WATCH_LIFECYCLE_ENDED,
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
        await self._displace_turns(project_id=project_id, session_id=session_id)
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
        await self._publish_lifecycle(
            project_id=project_id,
            session_id=session_id,
            state=WATCH_LIFECYCLE_ENDED,
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

        # A turn that was already displaced (handover, cancel, steer, kill, sweep) is dead
        # forever: refuse the beat before it touches ANY lock or the row. This is what keeps
        # the ambiguous "`alive` held by another turn + no `running`" state safe to resolve as
        # a handover below — the dangerous reading of that state was a zombie beat from an
        # older turn taking the nest of a session parked awaiting approval, which then made
        # the user's approval resume look superseded and abort. A zombie is by definition a
        # turn that already lost the nest, so the tombstone written at the moment it lost it
        # is the discriminator the locks alone cannot provide. Refusing early also stops the
        # zombie's own turn-end beat from clearing the LIVE turn's `running`.
        if request.turn_id and await is_turn_superseded(
            self._lock,
            project_id=str(project_id),
            session_id=request.session_id,
            turn_id=request.turn_id,
        ):
            stream = await self._dao.get_by_session_id(
                project_id=project_id,
                session_id=request.session_id,
            )
            # Read affinity, never claim it: renewing OWNER_TTL on a dead turn's beat pins the
            # session to this replica for another full TTL, which is exactly what has to expire
            # before another replica can take the session over.
            owner = await get_owner(
                self._lock,
                project_id=str(project_id),
                session_id=request.session_id,
            )
            return SessionHeartbeatResult(
                stream=stream,
                replica_id=owner or request.replica_id,
                is_current_turn=False,
            )

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
        # being gone now is something else's doing. A row carrying a DIFFERENT turn_id is not
        # decisive on its own (it is also what a fresh turn on a previously-run session sees)
        # — the failed nx re-acquire below is what settles that case.
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
            # A failed nx acquire is NOT by itself a takeover: nx fails whenever ANY value
            # holds the key, and `alive` outlives its turn (nothing releases it at turn end, and
            # the turn-end beat clears only `running`), so every follow-up turn on a warm
            # session sees the previous turn's key. `running` is the discriminator — a real
            # takeover (steer/_start_turn) holds it under the usurper's turn id — and the
            # supersession tombstone checked above is what makes the remaining "no running"
            # case safe: any turn that could reach here dishonestly has already been
            # tombstoned by whatever displaced it.
            if not await refresh_alive(
                self._lock,
                project_id=str(project_id),
                session_id=request.session_id,
                turn_id=request.turn_id,
            ):
                acquired = await acquire_alive(
                    self._lock,
                    project_id=str(project_id),
                    session_id=request.session_id,
                    turn_id=request.turn_id,
                )
                if not acquired:
                    alive_owner = await get_alive_owner(
                        self._lock,
                        project_id=str(project_id),
                        session_id=request.session_id,
                    )
                    running_owner = await get_running_owner(
                        self._lock,
                        project_id=str(project_id),
                        session_id=request.session_id,
                    )
                    if alive_owner == request.turn_id:
                        # Two overlapping beats of this same turn raced; we still own it.
                        acquired = True
                    elif running_owner is not None and running_owner != request.turn_id:
                        pass  # a live different turn holds the session: real takeover
                    else:
                        # Stale `alive` from this session's own previous (ended or parked)
                        # turn — legitimate handover, not an interruption. The displaced turn
                        # is tombstoned so it can never beat its way back in: that is the only
                        # thing standing between this branch and a zombie stealing the nest of
                        # a parked session.
                        #
                        # Compare-and-delete against the owner read just above, never an
                        # unconditional delete: an API `_start_turn` can land in the gap
                        # between that read and this write, and clearing the key then would
                        # tombstone the live turn that had just taken the session. Losing that
                        # race leaves `acquired` False, which is the truth.
                        displaced = alive_owner
                        if displaced is None or await release_alive(
                            self._lock,
                            project_id=str(project_id),
                            session_id=request.session_id,
                            turn_id=displaced,
                        ):
                            if displaced and displaced != request.turn_id:
                                await mark_turn_superseded(
                                    self._lock,
                                    project_id=str(project_id),
                                    session_id=request.session_id,
                                    turn_id=displaced,
                                )
                            acquired = await acquire_alive(
                                self._lock,
                                project_id=str(project_id),
                                session_id=request.session_id,
                                turn_id=request.turn_id,
                            )
                if not acquired or turn_was_established:
                    is_current_turn = False
            if not await refresh_running(
                self._lock,
                project_id=str(project_id),
                session_id=request.session_id,
                turn_id=request.turn_id,
            ):
                if turn_was_established:
                    is_current_turn = False
                # Only a turn that still believes it owns the session may (re-)arm `running`:
                # acquire_running overwrites, so a superseded turn's beat would otherwise
                # stamp its own dead id over the live turn's — corrupting the very key the
                # takeover check above reads — and a cancelled turn would resurrect the
                # `running` its cancel just cleared.
                if is_current_turn:
                    await acquire_running(
                        self._lock,
                        project_id=str(project_id),
                        session_id=request.session_id,
                        turn_id=request.turn_id,
                    )
        elif not request.is_running:
            # Turn ended: drop only `running`. `alive` outlives the turn (own TTL, cleared
            # only by kill) — this is what makes the session reattachable.
            #
            # Release only what this turn owns. The arming branch above already refuses a
            # superseded turn; clearing unconditionally left the mirror hole open, where a
            # stale turn's final beat deleted the LIVE turn's lock and published `ended`
            # underneath it.
            # `turn_id` is optional on the wire, and an owner-scoped release has nothing to
            # compare without one. Treat it as a no-op rather than releasing on behalf of
            # whoever happens to hold the lock: an end beat that cannot prove ownership is
            # exactly the case this release exists to refuse.
            released = bool(request.turn_id) and await release_running(
                self._lock,
                project_id=str(project_id),
                session_id=request.session_id,
                turn_id=request.turn_id,
            )
            # Publish only on the actual transition, not on every idle heartbeat.
            if released:
                await self._publish_lifecycle(
                    project_id=project_id,
                    session_id=request.session_id,
                    state=WATCH_LIFECYCLE_ENDED,
                )

        liveness = await get_session_liveness(
            self._lock, project_id=str(project_id), session_id=request.session_id
        )
        flags = SessionStreamFlags(
            is_alive=liveness["alive"],
            is_running=liveness["running"],
            is_attached=liveness["attached"],
        )

        # The mirror write is unconditional: create when this beat is the row's first touch,
        # otherwise UPDATE. Seeding `stream` from `prior_stream` here would skip both branches
        # for every session whose row already exists (renamed, or created by an earlier beat),
        # leaving `flags` NULL on named sessions and frozen at is_running=true on the rest —
        # and `updated_at` NULL, which is the column the orphan sweep filters on.
        stream: Optional[SessionStream] = None

        # Only a current turn may stamp `turn_id`. A turn whose locks lapsed keeps beating
        # until it notices, and writing its id over the live turn's would make the live turn's
        # next beat read a foreign `prior_stream.turn_id` - concluding its own locks were
        # never established, and re-arming them. `None` leaves the column as it is.
        durable_turn_id = request.turn_id if is_current_turn else None

        if prior_stream is None:
            try:
                stream = await self._dao.create(
                    project_id=project_id,
                    user_id=None,
                    stream=SessionStreamCreate(
                        session_id=request.session_id,
                        flags=flags,
                        turn_id=durable_turn_id,
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
                stream=SessionStreamEdit(flags=flags, turn_id=durable_turn_id),
            )

        # `running` lifecycle for the path that actually runs turns. `_start_turn` publishes it
        # for send/steer, but the runner mints its own turn id and only ever heartbeats, so
        # without this the relay's `running` event never fires for a real run. Gated on the
        # turn being new to this row, so a 30s-interval beat doesn't re-publish it.
        # `stream is None` = the row is a killed tombstone; announcing a dead session as
        # running would light every watcher's badge for a run that cannot exist.
        if (
            request.turn_id
            and request.is_running
            and not turn_was_established
            and stream is not None
        ):
            await self._publish_lifecycle(
                project_id=project_id,
                session_id=request.session_id,
                state=WATCH_LIFECYCLE_RUNNING,
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

    async def set_origin(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        origin: str,
        trigger: Optional[SessionTriggerRef] = None,
    ) -> Optional[SessionStream]:
        """Record WHO started a session, and which automation did, as reserved tags.

        Written before the run, so the row usually does not exist yet — hence the same
        create-or-update shape as `set_header`. Tags are replaced wholesale, which is safe only
        because this is the first writer; the trigger identity is stamped HERE rather than by a
        second writer for exactly that reason.
        """
        _validate_session_id(session_id)
        tags: Dict[str, Any] = {SESSION_ORIGIN_TAG: origin}
        if trigger is not None:
            tags[SESSION_TRIGGER_ID_TAG] = trigger.id
            if trigger.name:
                tags[SESSION_TRIGGER_NAME_TAG] = trigger.name
            if trigger.kind:
                tags[SESSION_TRIGGER_KIND_TAG] = trigger.kind
        updated = await self._dao.update(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            stream=SessionStreamEdit(tags=tags),
        )
        if updated is not None:
            return updated
        try:
            return await self._dao.create(
                project_id=project_id,
                user_id=user_id,
                stream=SessionStreamCreate(session_id=session_id, tags=tags),
            )
        except SessionStreamAlreadyExists:
            # A concurrent first heartbeat won the race; the row exists now.
            return await self._dao.update(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                stream=SessionStreamEdit(tags=tags),
            )

    async def query_streams(
        self,
        *,
        project_id: UUID,
        filter: SessionStreamQuery,
        windowing: Optional[Windowing] = None,
        session_ids: Optional[List[str]] = None,
        exclude_session_ids: Optional[List[str]] = None,
    ) -> List[SessionStream]:
        if filter.session_id:
            _validate_session_id(filter.session_id)
        return await self._dao.query(
            project_id=project_id,
            filter=filter,
            windowing=windowing,
            session_ids=session_ids,
            exclude_session_ids=exclude_session_ids,
        )

    async def count_streams(
        self,
        *,
        project_id: UUID,
        filter: SessionStreamQuery,
        session_ids: Optional[List[str]] = None,
        exclude_session_ids: Optional[List[str]] = None,
    ) -> int:
        if filter.session_id:
            _validate_session_id(filter.session_id)
        return await self._dao.count(
            project_id=project_id,
            filter=filter,
            session_ids=session_ids,
            exclude_session_ids=exclude_session_ids,
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
        user_id: Optional[UUID],
        session_id: str,
    ) -> Optional[SessionStream]:
        """Soft-archive the stream row: set `archived_at` (hidden but restorable), distinct from
        kill's `deleted_at` so a killed session stays listed. Returns the archived confirmation."""
        _validate_session_id(session_id)
        return await self._dao.set_archived_by_session_id(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
        )

    async def unarchive(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
    ) -> Optional[SessionStream]:
        """Reverse of `archive`: clears `archived_at`, restoring the session to the list."""
        _validate_session_id(session_id)
        return await self._dao.clear_archived_by_session_id(
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
                # The unique slot is held by either a concurrent first touch (live row) or a
                # soft-deleted tombstone (STOP_KILLS_SESSION / archive). The update reconciles
                # the live case; a None result means the tombstone case, handled below.
                pass
        if not created:
            updated = await self._dao.update(
                project_id=project_id,
                user_id=user_id,
                session_id=session_id,
                stream=SessionStreamEdit(flags=flags, turn_id=turn_id),
            )
            if updated is None:
                # No live row matched: a killed tombstone occupies the slot. Resume must
                # re-nest that same row (keeps its id + header) — clear deleted_at, then re-flag it.
                await self._dao.unarchive_by_session_id(
                    project_id=project_id,
                    user_id=user_id,
                    session_id=session_id,
                )
                updated = await self._dao.update(
                    project_id=project_id,
                    user_id=user_id,
                    session_id=session_id,
                    stream=SessionStreamEdit(flags=flags, turn_id=turn_id),
                )
            # New activity un-hides an archived session: a live row must never stay archived, or it
            # would be running yet absent from the default list. Clears only when actually archived.
            if updated is not None and updated.archived_at is not None:
                await self._dao.clear_archived_by_session_id(
                    project_id=project_id,
                    user_id=user_id,
                    session_id=session_id,
                )
        await self._publish_lifecycle(
            project_id=project_id,
            session_id=session_id,
            state=WATCH_LIFECYCLE_RUNNING,
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
