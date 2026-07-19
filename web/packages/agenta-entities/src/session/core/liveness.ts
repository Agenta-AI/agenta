/**
 * Session liveness derivation — the client-side half of the streams "nest".
 *
 * The backend stores three primitive flags per session stream (`is_alive ⊇ is_running ⊇
 * is_attached`) and leaves the two useful predicates to be derived client-side (streams
 * `specs.md` §"The nest"):
 *   - `resumable   = is_alive && !is_running` — alive but idle; send a new turn without force.
 *   - `reattachable = is_running && !is_attached` — a live turn nobody is watching (the
 *     "closed the chat" case); attach to watch it.
 *
 * These flags are only the PROCESS axis. The runner deliberately dropped `sandbox_live` from
 * the stream nest — durable disk/sandbox liveness lives in `session_states` (`sandbox_id`) — so
 * stream flags alone cannot split a proc-dead session into JP's warm/cold/dead lifecycle
 * (warm = disk alive/fast-resume, cold = disk cold/slow-resume, dead = disk gone/remount). Until
 * a session_state/sandbox signal is threaded in (the #5197 lifecycle work), `deriveSessionLifecycle`
 * reports the coarse proc truth: `new` (no stream), `hot` (proc alive), or `cold` (proc dead — the
 * safe "needs a resume" default). `refineLifecycleWithSandbox` is the seam to split `cold` once
 * that signal exists, without changing callers.
 */
import type {SessionStream} from "./schema"

/** JP's session lifecycle vocabulary. `hot` = proc+disk alive; `warm`/`cold` = proc dead, disk
 * alive-fast / cold-slow; `dead` = proc+disk gone (respawn+remount); `new` = nothing yet. */
export type SessionLifecycle = "new" | "hot" | "warm" | "cold" | "dead"

/** The three stream flags plus the two client-derived predicates. */
export interface SessionStreamNest {
    isAlive: boolean
    isRunning: boolean
    isAttached: boolean
    /** `isAlive && !isRunning` — alive but idle; a new turn can be sent without force. */
    resumable: boolean
    /** `isRunning && !isAttached` — a live turn with nobody watching; attach to resume watching. */
    reattachable: boolean
}

/** Read the three flags off a stream row (all default `false`) and derive the two predicates.
 * A missing/`null` stream is treated as all-false (no live process). */
export function deriveStreamNest(stream: SessionStream | null | undefined): SessionStreamNest {
    const isAlive = stream?.flags?.is_alive ?? false
    const isRunning = stream?.flags?.is_running ?? false
    const isAttached = stream?.flags?.is_attached ?? false
    return {
        isAlive,
        isRunning,
        isAttached,
        resumable: isAlive && !isRunning,
        reattachable: isRunning && !isAttached,
    }
}

/**
 * Coarse lifecycle from stream flags alone (the process axis).
 *
 * `undefined`/`null` stream (no stream row for the session) → `new`. `is_alive` → `hot`.
 * Otherwise proc-dead → `cold` (the conservative "resume will take a moment" default; we can't
 * tell warm/dead apart without disk/sandbox state — see `refineLifecycleWithSandbox`).
 */
export function deriveSessionLifecycle(stream: SessionStream | null | undefined): SessionLifecycle {
    if (!stream) return "new"
    return deriveStreamNest(stream).isAlive ? "hot" : "cold"
}

/** Durable disk/sandbox signal, when known. `alive` = sandbox process/disk reachable; `warm` =
 * fast-resumable (not archived/cold-stored). Both optional so partial knowledge degrades. */
export interface SandboxLiveness {
    alive?: boolean | null
    warm?: boolean | null
}

/**
 * Refine a proc-derived lifecycle with disk/sandbox state — the seam for the warm/cold/dead split
 * once #5197's session_state/sandbox signal is threaded in. `hot`/`new` pass through (proc state
 * is authoritative there). A proc-dead (`cold`) session refines to: `warm` (disk alive + warm),
 * `cold` (disk alive, not warm), or `dead` (disk gone). With no sandbox info the coarse `cold`
 * stands, so existing callers are unaffected until they start passing sandbox data.
 *
 * FOLLOWUP(sessions,#5197): no caller passes `sandbox` yet — wire a sandbox-liveness signal from
 * `getSessionState` through the dot (`sessionDotStatusAtomFamily`) when #5197 exposes it. See
 * docs/designs/sessions/frontend-integration.md.
 */
export function refineLifecycleWithSandbox(
    lifecycle: SessionLifecycle,
    sandbox: SandboxLiveness | null | undefined,
): SessionLifecycle {
    if (lifecycle !== "cold" || !sandbox) return lifecycle
    if (sandbox.alive === false) return "dead"
    if (sandbox.alive === true) return sandbox.warm ? "warm" : "cold"
    return lifecycle
}
