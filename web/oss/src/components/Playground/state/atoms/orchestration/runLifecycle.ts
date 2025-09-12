import {getDefaultStore} from "jotai"
import {atom} from "jotai"

import {
    chatSessionsByIdAtom,
    chatTurnsByIdAtom,
    logicalTurnIndexAtom,
    runStatusByRowRevisionAtom,
} from "@/oss/state/generation/entities"

import {
    normalizeComparisonChatTurnsMutationAtom,
    pruneLogicalTurnIndexForDisplayedVariantsMutationAtom,
} from "../generationMutations"
import {addEmptyChatTurnSystemMutationAtom} from "../mutations/chat/addEmptyTurnSystem"
import {displayedVariantsAtom} from "../variants"
import {pendingWebWorkerRequestsAtom} from "../webWorkerIntegration"

import {expectedRoundByLogicalAtom} from "./expected"

/**
 * Run Lifecycle Orchestrator
 *
 * Listens to normalized store updates and decides when to append a next user turn.
 * Rules (initial):
 * - Comparison whole-row run: when all displayed revisions for a logical turn have an assistant
 *   message (non-null), append a single next empty user turn across sessions.
 * - Single-cell rerun: do nothing (no automatic append).
 */
export const runLifecycleOrchestratorAtom = atom(null)
;(runLifecycleOrchestratorAtom as any).onMount = () => {
    console.log("runLifecycleOrchestratorAtom mounted")
    const store = getDefaultStore()

    // Track logicalIds we have appended for (per "round") to avoid duplicate appends
    const appendedFor = new Set<string>()
    // Track currently running revisions per logicalId to disambiguate whole-row vs single-cell
    const runningRevsByLogical = new Map<string, Set<string>>()

    const DEBUG = process.env.NODE_ENV !== "production"

    const tryAppendForCompletedLogical = () => {
        const displayed = (store.get(displayedVariantsAtom) || []) as string[]
        if (!Array.isArray(displayed) || displayed.length === 0) return

        const logicalIndex = (store.get(logicalTurnIndexAtom) || {}) as Record<
            string,
            Record<string, string>
        >
        const turns = (store.get(chatTurnsByIdAtom) || {}) as Record<string, any>
        const expected = (store.get(expectedRoundByLogicalAtom) || {}) as Record<
            string,
            {expectedRevIds: string[]; roundId: string; origin?: "single" | "fanout" | "rerun"}
        >

        Object.entries(logicalIndex || {}).forEach(([logicalId, map]) => {
            // Only consider if every displayed revision has a mapping for this logicalId
            const allMapped = displayed.every((revId) => Boolean((map || {})[revId]))
            if (!allMapped) return

            // Determine which revisions must be complete for this logical turn.
            // If an expected round is set, use it; otherwise fall back to all displayed.
            const expectedSet = expected[logicalId]?.expectedRevIds || displayed

            // Only append if an expected round exists for this logical turn.
            const exp = expected[logicalId]
            if (!exp) {
                return
            }
            // If multiple revisions are displayed but expected set is single (cell rerun), do not append in comparison
            if (Array.isArray(displayed) && displayed.length > 1) {
                const isSingle =
                    Array.isArray(exp.expectedRevIds) && exp.expectedRevIds.length === 1
                if (isSingle) {
                    return
                }
            }

            // Pending guard: if any expected (rowId, variantId) is still pending in the worker queue, do not append yet
            const pending = (store.get(pendingWebWorkerRequestsAtom) || {}) as Record<
                string,
                {rowId: string; variantId: string}
            >
            const hasPending = (exp.expectedRevIds || []).some((revId) => {
                const rowId = (map || {})[revId]
                if (!rowId) return false
                const st = pending[`${rowId}:${revId}`]
                return Boolean(st?.isRunning)
            })

            if (hasPending) {
                return
            }

            // Running guard: if any expected (rowId, variantId) is currently running per runStatus, wait
            const status = (store.get(runStatusByRowRevisionAtom) || {}) as Record<
                string,
                {isRunning: string | false | null; resultHash?: string | null}
            >
            const anyRunning = (exp.expectedRevIds || []).some((revId) => {
                const rowId = (map || {})[revId]
                if (!rowId) return false
                const st = status[`${rowId}:${revId}`]
                return Boolean(st?.isRunning)
            })
            if (anyRunning) {
                return
            }

            // Idempotency guard: if there's already an empty user input turn at tail for ANY displayed revision, skip append

            const sessions = (store.get(chatSessionsByIdAtom) || {}) as Record<string, any>
            const tailInfo: any = {}
            const hasEmptyTail = (displayed || []).some((revId) => {
                const turnId = (map || {})[revId]
                if (!turnId) return false
                const turn = turns[turnId]
                const sessionId = turn?.sessionId as string | undefined
                if (!sessionId) return false
                const sess = sessions[sessionId]
                const tids = (sess?.turnIds || []) as string[]
                const lastId = tids[tids.length - 1]
                if (!lastId) return false
                const last = turns[lastId]
                const user = last?.userMessage
                if (!user) return false
                const v = user?.content?.value
                const empty =
                    typeof v === "string"
                        ? v.trim().length === 0
                        : Array.isArray(v)
                          ? (() => {
                                try {
                                    const textParts = v.filter(
                                        (p: any) => p?.type?.value === "text",
                                    )
                                    if (textParts.length === 0) return true
                                    return textParts.every(
                                        (p: any) => (p?.text?.value || "").trim().length === 0,
                                    )
                                } catch {
                                    return false
                                }
                            })()
                          : false
                tailInfo[revId] = {
                    tailTurnId: lastId,
                    empty,
                    hasRoleId: Boolean(user?.role?.__id),
                    hasContentId: Boolean(user?.content?.__id),
                    hasUserMeta: Boolean(user?.__metadata),
                    hasRoleMeta: Boolean(user?.role?.__metadata),
                    hasContentMeta: Boolean(user?.content?.__metadata),
                }
                if (typeof v === "string") return empty
                if (Array.isArray(v)) {
                    try {
                        const textParts = v.filter((p: any) => p?.type?.value === "text")
                        if (textParts.length === 0) return true
                        return textParts.every(
                            (p: any) => (p?.text?.value || "").trim().length === 0,
                        )
                    } catch {
                        return false
                    }
                }
                return false
            })
            if (hasEmptyTail) {
                // Clear expected to avoid repeated attempts in this round
                if (expected[logicalId]) {
                    store.set(expectedRoundByLogicalAtom, (prev) => {
                        const next = {...prev}
                        delete next[logicalId]
                        return next
                    })
                }
                return
            }

            // Clear expected BEFORE append to avoid re-trigger loops within the same tick
            if (expected[logicalId]) {
                store.set(expectedRoundByLogicalAtom, (prev) => {
                    const next = {...prev}
                    delete next[logicalId]
                    return next
                })
            }

            store.set(addEmptyChatTurnSystemMutationAtom)
            // Post-append maintenance: normalize and prune index so UI reflects new row
            store.set(normalizeComparisonChatTurnsMutationAtom)
            store.set(pruneLogicalTurnIndexForDisplayedVariantsMutationAtom)
            appendedFor.add(logicalId)
            // Clear running set and expected round for this logical round
            runningRevsByLogical.delete(logicalId)

            // Prevent any further processing for this logicalId in this cycle
            return
        })
    }

    const unsubs: (() => void)[] = []
    // Track running revs per logicalId to disambiguate runs
    unsubs.push(
        store.sub(runStatusByRowRevisionAtom, () => {
            const status = (store.get(runStatusByRowRevisionAtom) || {}) as Record<
                string,
                {isRunning: string | false | null}
            >
            const nextMap = new Map<string, Set<string>>()
            Object.entries(status || {}).forEach(([key, v]) => {
                const [rowId, revId] = key.split(":")
                const isRunning = Boolean(v?.isRunning)
                if (!rowId || !revId) return
                // Resolve logical id for this rowId
                const turns = (store.get(chatTurnsByIdAtom) || {}) as Record<string, any>
                const t = turns[rowId]
                const lid = t?.logicalTurnId as string | undefined
                if (!lid) return
                if (isRunning) {
                    if (!nextMap.has(lid)) nextMap.set(lid, new Set<string>())
                    nextMap.get(lid)!.add(revId)
                    // New run started for this logical turn – allow future append by clearing guard
                    if (appendedFor.has(lid)) appendedFor.delete(lid)
                }
            })
            runningRevsByLogical.clear()
            nextMap.forEach((set, k) => runningRevsByLogical.set(k, set))
        }),
    )

    // When a new expected round is set for a logicalId, clear append guard so a fresh append is allowed
    unsubs.push(
        store.sub(expectedRoundByLogicalAtom, () => {
            const expected = (store.get(expectedRoundByLogicalAtom) || {}) as Record<
                string,
                {
                    expectedRevIds: string[]
                    roundId: string
                    origin?: "single" | "fanout" | "rerun"
                }
            >
            Object.keys(expected || {}).forEach((lid) => {
                if (appendedFor.has(lid)) appendedFor.delete(lid)
            })
        }),
    )
    // React to chat turns updates and displayed/index changes
    unsubs.push(store.sub(chatTurnsByIdAtom, tryAppendForCompletedLogical))
    unsubs.push(
        store.sub(displayedVariantsAtom, () => {
            const displayed = (store.get(displayedVariantsAtom) || []) as string[]
            if (Array.isArray(displayed) && displayed.length > 1) {
                // In comparison view, remove any lingering single-origin expected rounds
                const expected = (store.get(expectedRoundByLogicalAtom) || {}) as Record<
                    string,
                    {
                        expectedRevIds: string[]
                        roundId: string
                        origin?: "single" | "fanout" | "rerun"
                    }
                >
                const toClear = Object.entries(expected).filter(
                    ([, v]) => (v?.origin || "") === "single",
                )
                if (toClear.length > 0) {
                    store.set(expectedRoundByLogicalAtom, (prev) => {
                        const next = {...prev}
                        toClear.forEach(([k]) => delete next[k])
                        return next
                    })
                }
            }

            tryAppendForCompletedLogical()
        }),
    )
    unsubs.push(store.sub(logicalTurnIndexAtom, tryAppendForCompletedLogical))

    return () => {
        unsubs.forEach((u) => {
            u()
        })
        appendedFor.clear()
    }
}
