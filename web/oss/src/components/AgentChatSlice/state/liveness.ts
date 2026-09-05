import {deriveRemoteTurnPresentation, type SessionRunStatus} from "@agenta/chat/model"
import {sessionLocalSettledAtAtomFamily, sessionStatusAtomFamily} from "@agenta/chat/state"
import {
    deriveSessionLifecycle,
    deriveStreamNest,
    livenessPollInterval,
    querySessionStreams,
    type SessionLifecycle,
    type SessionStream,
    type SessionStreamNest,
} from "@agenta/entities/session"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {projectIdAtom} from "@/oss/state/project"

/** One low-priority project query supplies cross-device liveness for every tab dot. */
const aliveStreamsQueryAtom = atomWithQuery<SessionStream[] | null>((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["session-liveness", "alive", projectId],
        queryFn: ({signal}) =>
            querySessionStreams({
                projectId: projectId ?? "",
                isAlive: true,
                abortSignal: signal,
                lowPriority: true,
            }),
        enabled: Boolean(projectId),
        staleTime: 10_000,
        refetchInterval: (query) => livenessPollInterval(query.state.data),
        refetchOnWindowFocus: true,
    }
})

/** `session_id → live stream` map for O(1) per-dot lookup off the single shared query. */
const aliveStreamsMapAtom = atom((get) => {
    const streams = get(aliveStreamsQueryAtom).data ?? []
    const map = new Map<string, SessionStream>()
    for (const s of streams) map.set(s.session_id, s)
    return map
})

export interface SessionLiveness {
    /** Coarse lifecycle from stream flags (proc axis): new | hot | cold. */
    lifecycle: SessionLifecycle
    /** The stream nest + derived resumable/reattachable predicates. */
    nest: SessionStreamNest
    /** Current execution and durable Stop admission marker from the stream row. */
    turnId: string | null
    stoppingTurnId: string | null
    isLoading: boolean
    /** Server-advertised temporary frame relay for non-owning readers. */
    sharedReader: boolean
}

/**
 * Derived backend-liveness view for a session — the lifecycle label plus the nest predicates
 * (`resumable`/`reattachable`). A session not in the alive set reads as dormant (all-false nest).
 */
export const sessionLivenessAtomFamily = atomFamily((sessionId: string) =>
    atom((get): SessionLiveness => {
        const stream = get(aliveStreamsMapAtom).get(sessionId) ?? null
        return {
            lifecycle: deriveSessionLifecycle(stream),
            nest: deriveStreamNest(stream),
            turnId: stream?.turn_id ?? null,
            stoppingTurnId: stream?.stopping_turn_id ?? null,
            isLoading: get(aliveStreamsQueryAtom).isLoading,
            sharedReader: Boolean(stream?.capabilities?.shared_reader),
        }
    }),
)

/** Tab-dot status: the four local run-states plus `alive` (a warm backend sandbox, idle here). */
export type SessionDotStatus = SessionRunStatus | "alive"

/**
 * Effective status for the session tab dot. The LOCAL run-state wins whenever this browser is
 * doing something with the session (running / awaiting a HITL answer / errored) — it's the live
 * process, so its state is authoritative. Only when locally idle does it fall back to backend
 * liveness, so a session still running on another device reads as `running`, and a warm-but-idle
 * sandbox reads as `alive` (resumes instantly). Dead/cold/new → idle. Returns a plain string so a
 * dot repaints only when ITS status actually flips, not on every liveness poll.
 */
export const sessionDotStatusAtomFamily = atomFamily((sessionId: string) =>
    atom((get): SessionDotStatus => {
        const local = get(sessionStatusAtomFamily(sessionId))
        if (local !== "idle") return local
        const {nest} = get(sessionLivenessAtomFamily(sessionId))
        if (nest.isRunning) return "running"
        if (nest.isAlive) return "alive"
        return "idle"
    }),
)

/**
 * "Is someone ELSE running this session?" — the decision behind the running-elsewhere strip and
 * the transcript catch-up poll, as a pure function so it can be pinned by tests.
 *
 * `isRunning` is a project-wide poll snapshot (10s stale-time, 15s interval); the local run-state
 * is instant. Two guards close that gap (#5844):
 *  - an active local state means THIS browser owns the session, so a locally busy or
 *    approval-parked session never reads as remote (an error is settled, not active);
 *  - once a local turn has settled, the flag is only trusted again after liveness has been re-read
 *    (`livenessUpdatedAt` past the settle). Without this, every answer flipped `busy` false against
 *    a cached `is_running: true` and the strip appeared in the very tab that just ran the turn.
 */
export const isRunningElsewhere = ({
    localStatus,
    isRunning,
    localSettledAt,
    livenessUpdatedAt,
}: {
    localStatus: SessionRunStatus
    isRunning: boolean
    /** When this browser's own run of the session last settled; absent if it never ran one. */
    localSettledAt: number | undefined
    /** `dataUpdatedAt` of the liveness query the `isRunning` flag came from. */
    livenessUpdatedAt: number
}): boolean => {
    if (localStatus === "running" || localStatus === "awaiting") return false
    if (!isRunning) return false
    return localSettledAt === undefined || livenessUpdatedAt > localSettledAt
}

/** Desktop presentation for a remote/shared-path run. The strip is only the disconnected fallback. */
export const deriveSessionRemoteTurnPresentation = deriveRemoteTurnPresentation

/** `isRunningElsewhere` bound to this session's local status and the shared liveness query. */
export const sessionRunningElsewhereAtomFamily = atomFamily((sessionId: string) =>
    atom((get): boolean =>
        isRunningElsewhere({
            localStatus: get(sessionStatusAtomFamily(sessionId)),
            isRunning: get(sessionLivenessAtomFamily(sessionId)).nest.isRunning,
            localSettledAt: get(sessionLocalSettledAtAtomFamily(sessionId)),
            livenessUpdatedAt: get(aliveStreamsQueryAtom).dataUpdatedAt,
        }),
    ),
)
