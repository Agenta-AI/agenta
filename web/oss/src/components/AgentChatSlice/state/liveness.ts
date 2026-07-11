import {
    deriveSessionLifecycle,
    deriveStreamNest,
    querySessionStreams,
    type SessionLifecycle,
    type SessionStream,
    type SessionStreamNest,
} from "@agenta/entities/session"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {projectIdAtom} from "@/oss/state/project"

import {type SessionRunStatus, sessionStatusAtomFamily} from "./sessions"

/**
 * Backend liveness for the project's sessions (cross-device truth). The tab dot reads this to
 * reflect a session still running on the backend even when THIS browser isn't streaming it (a
 * reopened chat, or a run started on another device).
 *
 * ONE project-scoped query (`is_alive=true`) backs every dot rather than one fetch per session, so
 * N idle tabs cost ONE request, not N — important on cold load (see the request-count budget). Only
 * alive streams come back, which is exactly what the dot needs (running/alive vs idle); a session
 * absent from the result is dormant/cold/dead/new and simply reads as idle. Kept out of the live
 * conversation's way: the fetch is LOW-PRIORITY, polls only WHILE something is alive (empty result
 * → stop), and re-checks on tab refocus.
 */
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
        refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 15_000 : false),
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
    isLoading: boolean
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
            isLoading: get(aliveStreamsQueryAtom).isLoading,
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
