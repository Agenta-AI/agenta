/**
 * Agent playground auto-commit (#6126): flushes the config draft to a revision on its own.
 *
 * One subscription on the entity draft covers every write path, because the drawers buffer in
 * their own scoped draft and only touch the entity draft on Save. Keyed per revision, not per
 * selection, so `web/oss` and `web/mobile` can each mount it their own way.
 */
import {isLocalDraftId} from "@agenta/entities/shared"
import {
    workflowMolecule,
    isLatestRevisionAtomFamily,
    commitWorkflowRevisionAtom,
    invalidateAgentCommittedRevisionCache,
} from "@agenta/entities/workflow"
import {classifyAgentChanges, buildCommitSummaryMessage} from "@agenta/entities/workflow/commitDiff"
import {
    agentAutoCommitHeldAtomFamily,
    agentSelfCommitSignalAtom,
    projectIdAtom,
} from "@agenta/shared/state"
import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai-family"

/** Idle gap before a flush. Long enough to coalesce a burst, short enough to feel instant. */
const DEBOUNCE_MS = 1500
/** A failed commit gets exactly one more attempt. */
const RETRY_MS = 3000
/** Skip a flush this soon after the agent committed itself, so the two writers never overlap. */
const SELF_COMMIT_QUIET_MS = 2000

export type AgentAutoCommitStatus = "idle" | "pending" | "saving" | "error"

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
 * multi-subscriber, unsubscribable, and agent-auto-commit only — which is what lets a mobile
 * pane register per mount and an app register once.
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

/** `skip` not ours · `clean` nothing to save · `held` a run owns it · `busy` transient. */
const flushBlocker = (
    store: Store,
    revisionId: string,
    force: boolean,
): "skip" | "clean" | "held" | "busy" | null => {
    if (!revisionId) return "skip"
    if (!store.get(projectIdAtom)) return "skip"
    if (!store.get(workflowMolecule.selectors.isAgent(revisionId))) return "skip"
    // Onboarding mints an ephemeral agent inside the real playground; committing it would
    // create the workflow before the user has decided to.
    if (store.get(workflowMolecule.selectors.isEphemeral(revisionId))) return "skip"
    if (isLocalDraftId(revisionId)) return "skip"
    if (!store.get(workflowMolecule.selectors.isDirty(revisionId))) return "clean"

    // An older revision stays manual: it is editable with no visual distinction, so an
    // accidental keystroke there must not silently rewrite history. An explicit Save forces.
    if (!force && !store.get(isLatestRevisionAtomFamily(revisionId))) return "skip"

    if (store.get(agentAutoCommitHeldAtomFamily(revisionId))) return "held"

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

type Store = ReturnType<typeof getDefaultStore>

/** Timers per revision: the idle debounce, and the single post-failure retry. */
const timers = new Map<string, ReturnType<typeof setTimeout>>()

const clearTimer = (revisionId: string) => {
    const timer = timers.get(revisionId)
    if (timer) {
        clearTimeout(timer)
        timers.delete(revisionId)
    }
}

const schedule = (
    store: Store,
    revisionId: string,
    delay: number,
    force: boolean,
    isRetry: boolean,
) => {
    clearTimer(revisionId)
    timers.set(
        revisionId,
        setTimeout(() => {
            timers.delete(revisionId)
            void runFlush(store, revisionId, force, isRetry)
        }, delay),
    )
}

/** `canReschedule` is false on unmount: a timer armed there orphans itself and re-arms forever. */
const runFlush = async (
    store: Store,
    revisionId: string,
    force: boolean,
    isRetry: boolean,
    canReschedule = true,
) => {
    const blocker = flushBlocker(store, revisionId, force)

    if (blocker === "skip" || blocker === "clean") {
        clearTimer(revisionId)
        // A failed save keeps its error only while the draft is still unsaved; once clean the
        // warning is stale and would strand the entity on "Not saved" with a dead button.
        if (blocker === "clean") {
            store.set(agentAutoCommitErrorAtomFamily(revisionId), null)
            store.set(agentAutoCommitStatusAtomFamily(revisionId), "idle")
        } else if (store.get(agentAutoCommitStatusAtomFamily(revisionId)) !== "error") {
            store.set(agentAutoCommitStatusAtomFamily(revisionId), "idle")
        }
        return
    }

    // Park; the hold subscription re-arms on release. Polling spins for the whole turn.
    if (blocker === "held") {
        clearTimer(revisionId)
        store.set(agentAutoCommitStatusAtomFamily(revisionId), "pending")
        return
    }

    if (blocker === "busy") {
        store.set(agentAutoCommitStatusAtomFamily(revisionId), "pending")
        if (canReschedule) schedule(store, revisionId, DEBOUNCE_MS, force, isRetry)
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
            // unattended writer notices: `isLatest` keeps answering with the superseded id.
            invalidateAgentCommittedRevisionCache()
            const newRevisionId = result.newRevisionId
            if (newRevisionId) {
                afterCommitHandlers.forEach((handler) => handler(revisionId, newRevisionId))
            }
            return
        }

        if (!isRetry && canReschedule) {
            store.set(agentAutoCommitStatusAtomFamily(revisionId), "pending")
            schedule(store, revisionId, RETRY_MS, force, true)
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

/** Commit now. `force` bypasses the not-latest skip; the hold and in-flight guards still apply. */
export const flushAgentAutoCommitAtom = atom(
    null,
    async (_get, _set, {revisionId, force = false}: {revisionId: string; force?: boolean}) => {
        clearTimer(revisionId)
        // A manual Save is the user's second attempt; don't spend the automatic retry on it.
        await runFlush(getDefaultStore(), revisionId, force, force)
    },
)

/**
 * Mount per revision to arm auto-commit; subscribing is what starts it.
 *
 * It commits EDITS only — mounting never flushes a draft it did not witness, or every remount
 * would commit. A stranded draft surfaces in the header as Draft + Save instead.
 */
export const agentAutoCommitEngineAtomFamily = atomFamily((revisionId: string) => {
    const engineAtom = atom(0)

    engineAtom.onMount = () => {
        // No SSR guard needed: subscribing is inert until a user edit schedules a timer.
        const store = getDefaultStore()
        const draftAtom = workflowMolecule.atoms.draft(revisionId)

        const unsub = store.sub(draftAtom, () => {
            const blocker = flushBlocker(store, revisionId, false)
            if (blocker === "skip" || blocker === "clean") {
                void runFlush(store, revisionId, false, false)
                return
            }

            // A fresh edit supersedes a standing failure — re-arm the normal timer.
            store.set(agentAutoCommitStatusAtomFamily(revisionId), "pending")
            store.set(agentAutoCommitErrorAtomFamily(revisionId), null)
            schedule(store, revisionId, DEBOUNCE_MS, false, false)
        })

        // A hold releasing must wake a parked flush: a held flush deliberately arms no timer.
        const unsubHold = store.sub(agentAutoCommitHeldAtomFamily(revisionId), () => {
            if (store.get(agentAutoCommitHeldAtomFamily(revisionId))) return
            if (store.get(agentAutoCommitStatusAtomFamily(revisionId)) !== "pending") return
            schedule(store, revisionId, DEBOUNCE_MS, false, false)
        })

        return () => {
            unsub()
            unsubHold()
            const hadPendingWork = timers.has(revisionId)
            clearTimer(revisionId)
            if (!hadPendingWork) return

            // Stand down rather than strand "pending": both wake-up subscriptions are gone.
            if (flushBlocker(store, revisionId, false) !== null) {
                if (store.get(agentAutoCommitStatusAtomFamily(revisionId)) !== "error") {
                    store.set(agentAutoCommitStatusAtomFamily(revisionId), "idle")
                }
                return
            }

            // Last chance to land a pending edit, as SUB 9 flushes its snapshot on unmount.
            void runFlush(store, revisionId, false, true, false)
        }
    }

    return engineAtom
})
