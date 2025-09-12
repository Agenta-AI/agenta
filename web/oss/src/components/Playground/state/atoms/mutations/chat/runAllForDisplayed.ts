import {atom} from "jotai"

import {
    chatTurnsByIdAtom as normChatTurnsByIdAtom,
    logicalTurnIndexAtom as normLogicalTurnIndexAtom,
    chatSessionsByIdAtom as normChatSessionsByIdAtom,
} from "@/oss/state/generation/entities"

import {appChatModeAtom} from "../../app"
import {setLastRunTurnForVariantAtom, triggerWebWorkerTestAtom} from "../../index"
import {expectedRoundByLogicalAtom} from "../../orchestration/expected"
import {displayedVariantsAtom} from "../../variants"

/**
 * For each logical turn id, triggers a test for each displayed revision's mapped session turn
 * when the user message has non-empty content.
 */
export const runAllChatForDisplayedVariantsMutationAtom = atom(null, (get, set) => {
    const isChat = get(appChatModeAtom)
    if (!isChat) return
    const displayed = (get(displayedVariantsAtom) || []) as string[]
    if (!Array.isArray(displayed) || displayed.length === 0) return

    const logicalIndex = (get(normLogicalTurnIndexAtom) || {}) as Record<
        string,
        Record<string, string>
    >
    const turnsById = (get(normChatTurnsByIdAtom) || {}) as Record<string, any>
    const sessionsById = (get(normChatSessionsByIdAtom) || {}) as Record<string, any>

    // Determine logical order using baseline session when possible; fallback to key order
    let logicalOrder: string[] = []
    const baselineRev = Array.isArray(displayed) ? displayed[0] : undefined
    if (baselineRev) {
        const sess = sessionsById[`session-${baselineRev}`]
        const tids: string[] = Array.isArray(sess?.turnIds) ? sess.turnIds : []
        if (tids.length > 0) {
            const lids = tids
                .map((tid) => (turnsById as any)?.[tid]?.logicalTurnId)
                .filter(Boolean) as string[]
            const seen = new Set<string>()
            for (const lid of lids) if (!seen.has(lid)) seen.add(lid)
            logicalOrder = Array.from(seen)
        }
    }
    if (!Array.isArray(logicalOrder) || logicalOrder.length === 0) {
        logicalOrder = Object.keys(logicalIndex)
    }

    // Helper: robust user-content check
    const hasValidUser = (val: any) => {
        if (typeof val === "string") return val.trim().length > 0
        if (Array.isArray(val)) {
            try {
                // Consider non-empty if any text part has non-empty text, or image has url
                for (const p of val) {
                    const type = p?.type?.value ?? p?.type
                    if (type === "text") {
                        const t = typeof p?.text === "string" ? p.text : p?.text?.value
                        if ((t || "").trim().length > 0) return true
                    }
                    if (type === "image_url" || p?.imageUrl || p?.image_url) {
                        const url =
                            p?.imageUrl?.url?.value ??
                            p?.imageUrl?.value ??
                            p?.image_url?.url ??
                            p?.image_url ??
                            p?.url ??
                            ""
                        if (url) return true
                    }
                }
            } catch {}
        }
        return false
    }

    // Find the last logical turn that has valid user message content across displayed variants
    let logicalId: string | undefined
    for (let i = logicalOrder.length - 1; i >= 0; i--) {
        const lid = logicalOrder[i]
        const m = (logicalIndex as any)[lid] || {}
        const anyValid = (displayed || []).some((revId) => {
            const sid = m[revId]
            if (!sid) return false
            const turn = (turnsById as any)[sid]
            const val = turn?.userMessage?.content?.value
            return hasValidUser(val)
        })
        if (anyValid) {
            logicalId = lid
            break
        }
    }
    if (!logicalId) return
    const map = (logicalIndex || {})[logicalId] || {}

    // Mark expected round for orchestrator: all displayed revs for this logical
    const roundId = `${logicalId}:${Date.now()}`
    set(expectedRoundByLogicalAtom, (prev) => ({
        ...prev,
        [logicalId]: {expectedRevIds: displayed, roundId},
    }))

    // Determine if any displayed revision has non-empty user text for this logical turn
    const anyUserText = (displayed || []).some((revId) => {
        const sid = (map as any)[revId]
        if (!sid) return false
        const t = (turnsById as any)[sid]
        const v = t?.userMessage?.content?.value
        return hasValidUser(v)
    })

    const queue: {sid: string; revId: string}[] = []
    displayed.forEach((revId) => {
        const sid = (map as any)[revId]
        if (!sid) return
        const turn = turnsById[sid]
        const val = turn?.userMessage?.content?.value
        const hasText = hasValidUser(val)
        if (!hasText && !anyUserText) return
        queue.push({sid, revId})
    })

    // Stagger dispatch to avoid potential de-duping on synchronous triggers
    queue.forEach(({sid, revId}, idx) => {
        setTimeout(() => {
            set(setLastRunTurnForVariantAtom, {
                logicalId,
                revisionId: revId,
                rowId: sid,
            } as any)
            set(triggerWebWorkerTestAtom, {rowId: sid, variantId: revId} as any)
        }, idx * 5)
    })
})
