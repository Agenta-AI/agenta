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
 * FOLLOWUP(sessions,#5197): no caller passes `sandbox` yet — wire a sandbox-liveness signal
 * through the dot (`sessionDotStatusAtomFamily`) when #5197 exposes it. See
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

/** What a liveness-driven `refetchInterval` may return: a period in ms, or `false` to stop. */
export type LivenessPollInterval = number | false

/** Fast cadence: something is executing right now, so the view changes on its own. */
const RUNNING_POLL_MS = 15_000
/** Slow cadence: nothing runs, but a warm session can be resumed from another device. */
const RESUMABLE_POLL_MS = 60_000

/**
 * The cadence a liveness poll should use for the rows it last received.
 *
 * The discriminator is `is_running`, never "the alive set is non-empty". Stop ends the WORK and
 * leaves the session alive so it can resume warm, and an ordinary turn end does the same, so a
 * predicate keyed on `is_alive` holds every poll at the fast cadence for as long as `alive`
 * lives — half an hour after one Stop, in every open tab. Keyed on `is_running` the fast
 * cadence lasts exactly as long as the work does.
 *
 * `idle` is the floor for "nothing alive at all". Views that only ever render sessions they
 * already know are live leave it `false` and stop polling; a view that must also DISCOVER a run
 * it did not start (the sidebar rail) passes a slow period instead.
 */
export function livenessPollInterval(
    rows: readonly (SessionStream | null | undefined)[] | null | undefined,
    options?: {idle?: LivenessPollInterval},
): LivenessPollInterval {
    const list = rows ?? []
    if (list.some((row) => row?.flags?.is_running)) return RUNNING_POLL_MS
    if (list.some((row) => row?.flags?.is_alive)) return RESUMABLE_POLL_MS
    return options?.idle ?? false
}
