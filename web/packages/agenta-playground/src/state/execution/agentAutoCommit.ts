/**
 * Agent playground auto-commit (#6126): the config saves itself, with no button and no modal.
 *
 * Driven by the draft WRITE, not by a mounted view — a subscription dies with its component, and
 * an edit made while the config pane was off screen was then never saved.
 *
 * States are `idle`, `saving`, `error`. "About to save" is not one: a dirty draft already says
 * that, and `agentAutoCommitScheduledAtomFamily` says whether a save is actually coming.
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

/** A flush is armed. The header needs it to tell "about to save" from "dirty, nobody is coming". */
export const agentAutoCommitScheduledAtomFamily = atomFamily((_revisionId: string) => atom(false))

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

/** Check before staging a revert so a busy writer's draft and timer remain untouched. */
export const isAgentAutoCommitBusy = (revisionId: string): boolean => {
    if (inFlight.has(revisionId)) return true
    const selfCommit = getDefaultStore().get(agentSelfCommitSignalAtom)
    return !!selfCommit && Date.now() - selfCommit.at < SELF_COMMIT_QUIET_MS
}

/**
 * `skip` not ours · `clean` nothing to save · `busy` transient, try again shortly.
 *
 * No "held": a run no longer blocks the commit. The conflict that guarded against is one the
 * server tells the agent how to recover from, and holding could strand a save indefinitely.
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

    if (isAgentAutoCommitBusy(revisionId)) return "busy"

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

const setScheduled = (store: Store, revisionId: string, value: boolean) => {
    const scheduledAtom = agentAutoCommitScheduledAtomFamily(revisionId)
    if (store.get(scheduledAtom) !== value) store.set(scheduledAtom, value)
}

const clearTimer = (store: Store, revisionId: string) => {
    const timer = timers.get(revisionId)
    if (timer) {
        clearTimeout(timer)
        timers.delete(revisionId)
    }
    setScheduled(store, revisionId, false)
}

const schedule = (
    store: Store,
    revisionId: string,
    delay: number,
    isRetry: boolean,
    messageOverride?: string,
) => {
    clearTimer(store, revisionId)
    timers.set(
        revisionId,
        setTimeout(() => {
            timers.delete(revisionId)
            setScheduled(store, revisionId, false)
            // The override rides the timer: a deferred revert must still commit under its own
            // message, not the generated summary.
            void runFlush(store, revisionId, isRetry, messageOverride)
        }, delay),
    )
    setScheduled(store, revisionId, true)
}

/**
 * Stand down. A failed save keeps its error while the draft is still unsaved; once clean the
 * warning is stale and would strand the header on "Not saved" with nothing left to retry.
 */
const settleIdle = (store: Store, revisionId: string, blocker: "skip" | "clean") => {
    clearTimer(store, revisionId)
    if (blocker === "clean") {
        store.set(agentAutoCommitErrorAtomFamily(revisionId), null)
        store.set(agentAutoCommitStatusAtomFamily(revisionId), "idle")
    } else if (store.get(agentAutoCommitStatusAtomFamily(revisionId)) !== "error") {
        store.set(agentAutoCommitStatusAtomFamily(revisionId), "idle")
    }
}

/**
 * Drop a superseded revision's atoms and any flush still armed for it — `atomFamily` holds a
 * strong map and never evicts, and a timer left running re-creates the very atoms just removed.
 *
 * A revision still holding a draft is left alone: the commit keeps the draft when it cannot carry
 * a concurrent edit forward, and that armed flush is the edit's only way to land.
 */
const forgetRevision = (store: Store, revisionId: string) => {
    if (store.get(workflowMolecule.selectors.isDirty(revisionId))) return
    clearTimer(store, revisionId)
    agentAutoCommitStatusAtomFamily.remove(revisionId)
    agentAutoCommitErrorAtomFamily.remove(revisionId)
    agentAutoCommitScheduledAtomFamily.remove(revisionId)
}

const runFlush = async (
    store: Store,
    revisionId: string,
    isRetry: boolean,
    messageOverride?: string,
): Promise<boolean> => {
    const blocker = flushBlocker(store, revisionId)

    if (blocker === "skip" || blocker === "clean") {
        settleIdle(store, revisionId, blocker)
        return false
    }

    if (blocker === "busy") {
        // Reverts roll their draft back on false; never leave a timer holding their message.
        if (messageOverride === undefined) schedule(store, revisionId, DEBOUNCE_MS, isRetry)
        return false
    }

    inFlight.add(revisionId)
    store.set(agentAutoCommitStatusAtomFamily(revisionId), "saving")

    try {
        const commitMessage = messageOverride ?? buildMessage(store, revisionId)
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
                setTimeout(() => forgetRevision(store, revisionId), 0)
            }
            return true
        }

        if (!isRetry) {
            // Still working, so the header keeps saying so rather than flashing a failure the
            // retry is about to clear.
            schedule(store, revisionId, RETRY_MS, true, messageOverride)
            return false
        }

        store.set(agentAutoCommitStatusAtomFamily(revisionId), "error")
        store.set(
            agentAutoCommitErrorAtomFamily(revisionId),
            result.error?.message ?? "Couldn't save changes",
        )
        return false
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
 *
 * `commitMessage` overrides the generated summary — a revert names what it did. Returns whether
 * the commit landed, so a caller that shows its own outcome (the version-history drawer) can.
 */
export const flushAgentAutoCommitAtom = atom(
    null,
    async (
        _get,
        _set,
        {revisionId, commitMessage}: {revisionId: string; commitMessage?: string},
    ): Promise<boolean> => {
        clearTimer(getDefaultStore(), revisionId)
        // A manual retry is the user's second attempt; don't spend the automatic one on it.
        return runFlush(getDefaultStore(), revisionId, true, commitMessage)
    },
)

/** Armed on import, session-wide — apps cannot forget to opt in. Follows `workflowEntityBridge`. */
registerWorkflowDraftCallbacks({onDraftChange: scheduleAgentAutoCommit})

/** Test seam: drop every timer and status between cases. */
export const __resetAgentAutoCommit = () => {
    timers.forEach((timer) => clearTimeout(timer))
    timers.clear()
    inFlight.clear()
    afterCommitHandlers.clear()
}
