/**
 * Agent playground auto-commit (#6126): the config saves itself, with no button and no modal.
 *
 * Driven by the WRITE, not by a view. `registerWorkflowDraftCallbacks` fires on every real edit
 * to a workflow draft, wherever it came from — a drawer, a slash command, an approval card, the
 * agent itself — so there is nothing to mount and nothing to keep on screen. The first cut
 * subscribed from a component, which meant an edit made while the config pane was hidden was
 * never saved at all, and a save parked mid-run could strand its status with no way to resume.
 *
 * Three states, and no fourth: `idle`, `saving`, `error`. "About to save" is not a state — a
 * dirty draft already says that, and the header reads it directly.
 */
import {isLocalDraftId} from "@agenta/entities/shared"
import {
    workflowMolecule,
    registerWorkflowDraftCallbacks,
    commitWorkflowRevisionAtom,
    invalidateAgentCommittedRevisionCache,
} from "@agenta/entities/workflow"
import {classifyAgentChanges, buildCommitSummaryMessage} from "@agenta/entities/workflow/commitDiff"
import {agentSelfCommitSignalAtom, projectIdAtom} from "@agenta/shared/state"
import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai-family"

/** Idle gap before a flush. Long enough to coalesce a burst, short enough to feel instant. */
const DEBOUNCE_MS = 1500
/** A failed commit gets exactly one more attempt. */
const RETRY_MS = 3000
/** Skip a flush this soon after the agent committed itself, so the two writers never overlap. */
const SELF_COMMIT_QUIET_MS = 2000

export type AgentAutoCommitStatus = "idle" | "saving" | "error"

export const agentAutoCommitStatusAtomFamily = atomFamily((_revisionId: string) =>
    atom<AgentAutoCommitStatus>("idle"),
)

export const agentAutoCommitErrorAtomFamily = atomFamily((_revisionId: string) =>
    atom<string | null>(null),
)

/** Commits in flight, so a second flush can never stack on the first. */
const inFlight = new Set<string>()

/**
 * Host reactions to an auto-commit. Distinct from `registerWorkflowCommitCallbacks` in
 * `@agenta/entities`, which is single-slot and fires for EVERY commit: this one is
 * multi-subscriber, unsubscribable, and agent-auto-commit only — which is what lets each app
 * add its own follow-up work.
 *
 * Keyed so a module re-evaluation (HMR) replaces its handler instead of stacking a second one.
 */
type AfterCommitHandler = (revisionId: string, newRevisionId: string) => void
const afterCommitHandlers = new Map<string, AfterCommitHandler>()

export const registerAgentAutoCommitHandler = (
    key: string,
    handler: AfterCommitHandler,
): (() => void) => {
    afterCommitHandlers.set(key, handler)
    return () => {
        if (afterCommitHandlers.get(key) === handler) afterCommitHandlers.delete(key)
    }
}

type Store = ReturnType<typeof getDefaultStore>

/**
 * `skip` not ours · `clean` nothing to save · `busy` transient, try again shortly.
 *
 * There is deliberately no "held" any more. A run used to block the commit, because the agent's
 * own `commit_revision` sends a `base_revision_id` the server checks against HEAD — but that
 * conflict is a designed, recoverable error (the server's `next_step` tells the agent to re-read
 * and re-anchor), while holding produced a "Save pending" that could outlive its own wake-up.
 */
const flushBlocker = (store: Store, revisionId: string): "skip" | "clean" | "busy" | null => {
    if (!revisionId) return "skip"
    if (!store.get(projectIdAtom)) return "skip"
    if (!store.get(workflowMolecule.selectors.isAgent(revisionId))) return "skip"
    // Onboarding mints an ephemeral agent inside the real playground; committing it would
    // create the workflow before the user has decided to.
    if (store.get(workflowMolecule.selectors.isEphemeral(revisionId))) return "skip"
    if (isLocalDraftId(revisionId)) return "skip"
    if (!store.get(workflowMolecule.selectors.isDirty(revisionId))) return "clean"

    if (inFlight.has(revisionId)) return "busy"

    const selfCommit = store.get(agentSelfCommitSignalAtom)
    if (selfCommit && Date.now() - selfCommit.at < SELF_COMMIT_QUIET_MS) return "busy"

    return null
}

/** The message the commit modal would have suggested, generated without the modal. */
const buildMessage = (store: Store, revisionId: string): string | undefined => {
    const local = store.get(workflowMolecule.selectors.configuration(revisionId))
    const server = store.get(workflowMolecule.selectors.serverConfiguration(revisionId))
    const sections = classifyAgentChanges(local, server)
    return sections.length ? buildCommitSummaryMessage(sections) : undefined
}

/** Timers per revision: the idle debounce, and the single post-failure retry. */
const timers = new Map<string, ReturnType<typeof setTimeout>>()

const clearTimer = (revisionId: string) => {
    const timer = timers.get(revisionId)
    if (timer) {
        clearTimeout(timer)
        timers.delete(revisionId)
    }
}

const schedule = (store: Store, revisionId: string, delay: number, isRetry: boolean) => {
    clearTimer(revisionId)
    timers.set(
        revisionId,
        setTimeout(() => {
            timers.delete(revisionId)
            void runFlush(store, revisionId, isRetry)
        }, delay),
    )
}

/**
 * Stand down. A failed save keeps its error while the draft is still unsaved; once clean the
 * warning is stale and would strand the header on "Not saved" with nothing left to retry.
 */
const settleIdle = (store: Store, revisionId: string, blocker: "skip" | "clean") => {
    clearTimer(revisionId)
    if (blocker === "clean") {
        store.set(agentAutoCommitErrorAtomFamily(revisionId), null)
        store.set(agentAutoCommitStatusAtomFamily(revisionId), "idle")
    } else if (store.get(agentAutoCommitStatusAtomFamily(revisionId)) !== "error") {
        store.set(agentAutoCommitStatusAtomFamily(revisionId), "idle")
    }
}

/** Drop a superseded revision's atoms; `atomFamily` holds a strong map and never evicts. */
const forgetRevision = (revisionId: string) => {
    agentAutoCommitStatusAtomFamily.remove(revisionId)
    agentAutoCommitErrorAtomFamily.remove(revisionId)
}

const runFlush = async (store: Store, revisionId: string, isRetry: boolean) => {
    const blocker = flushBlocker(store, revisionId)

    if (blocker === "skip" || blocker === "clean") {
        settleIdle(store, revisionId, blocker)
        return
    }

    if (blocker === "busy") {
        schedule(store, revisionId, DEBOUNCE_MS, isRetry)
        return
    }

    inFlight.add(revisionId)
    store.set(agentAutoCommitStatusAtomFamily(revisionId), "saving")

    try {
        const commitMessage = buildMessage(store, revisionId)
        const result = await store.set(commitWorkflowRevisionAtom, {revisionId, commitMessage})

        if (result.success) {
            store.set(agentAutoCommitStatusAtomFamily(revisionId), "idle")
            store.set(agentAutoCommitErrorAtomFamily(revisionId), null)
            // The commit atom invalidates everything BUT the latest-revision query, which an
            // unattended writer notices: the next read keeps answering with the superseded id.
            invalidateAgentCommittedRevisionCache()
            const newRevisionId = result.newRevisionId
            if (newRevisionId) {
                afterCommitHandlers.forEach((handler) => handler(revisionId, newRevisionId))
                // Deferred a tick so subscribers reading this revision during the switch
                // finish first. Safe: it is superseded.
                setTimeout(() => forgetRevision(revisionId), 0)
            }
            return
        }

        if (!isRetry) {
            // Still working, so the header keeps saying so rather than flashing a failure the
            // retry is about to clear.
            schedule(store, revisionId, RETRY_MS, true)
            return
        }

        store.set(agentAutoCommitStatusAtomFamily(revisionId), "error")
        store.set(
            agentAutoCommitErrorAtomFamily(revisionId),
            result.error?.message ?? "Couldn't save changes",
        )
    } finally {
        inFlight.delete(revisionId)
    }
}

/** Arm the debounce for a revision that just changed. */
const scheduleAgentAutoCommit = (revisionId: string) => {
    const store = getDefaultStore()
    const blocker = flushBlocker(store, revisionId)
    if (blocker === "skip" || blocker === "clean") {
        settleIdle(store, revisionId, blocker)
        return
    }
    // A fresh edit supersedes a standing failure — re-arm the normal timer.
    store.set(agentAutoCommitErrorAtomFamily(revisionId), null)
    if (store.get(agentAutoCommitStatusAtomFamily(revisionId)) === "error") {
        store.set(agentAutoCommitStatusAtomFamily(revisionId), "idle")
    }
    schedule(store, revisionId, DEBOUNCE_MS, false)
}

/**
 * Save now, skipping the debounce. The header's failure notice uses it to retry; the timer path
 * needs nothing else.
 */
export const flushAgentAutoCommitAtom = atom(
    null,
    async (_get, _set, {revisionId}: {revisionId: string}) => {
        clearTimer(revisionId)
        // A manual retry is the user's second attempt; don't spend the automatic one on it.
        await runFlush(getDefaultStore(), revisionId, true)
    },
)

/**
 * Armed on import, for the whole session. The apps do not opt in and cannot forget to: the
 * predicate above is what decides whether a given write is one of ours, and it is evaluated
 * per write against live state.
 *
 * Module-scope registration follows `workflowEntityBridge`, which wires the commit callbacks
 * the same way.
 */
registerWorkflowDraftCallbacks({onDraftChange: scheduleAgentAutoCommit})

/** Test seam: drop every timer and status between cases. */
export const __resetAgentAutoCommit = () => {
    timers.forEach((timer) => clearTimeout(timer))
    timers.clear()
    inFlight.clear()
    afterCommitHandlers.clear()
}
