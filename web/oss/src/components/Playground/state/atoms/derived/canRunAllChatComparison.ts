import {atom} from "jotai"

import {
    chatSessionsByIdAtom,
    chatTurnsByIdAtom,
    logicalTurnIndexAtom,
} from "@/oss/state/generation/entities"

import {appChatModeAtom} from "../app"
import {displayedVariantsAtom} from "../variants"

const hasValidUser = (val: any): boolean => {
    if (typeof val === "string") return val.trim().length > 0
    if (Array.isArray(val)) {
        try {
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

export const canRunAllChatComparisonAtom = atom((get) => {
    const isChat = get(appChatModeAtom)
    if (!isChat) return false

    const displayed = (get(displayedVariantsAtom) || []) as string[]
    if (!Array.isArray(displayed) || displayed.length === 0) return false

    const logicalIndex = (get(logicalTurnIndexAtom) || {}) as Record<
        string,
        Record<string, string>
    >
    const turnsById = (get(chatTurnsByIdAtom) || {}) as Record<string, any>
    const sessionsById = (get(chatSessionsByIdAtom) || {}) as Record<string, any>

    // Determine logical order from baseline session if available
    let logicalOrder: string[] = []
    const baselineRev = displayed[0]
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

    // Scan from end to find last logical turn that has valid user content across displayed variants
    for (let i = logicalOrder.length - 1; i >= 0; i--) {
        const lid = logicalOrder[i]
        const map = (logicalIndex as any)[lid] || {}
        const anyValid = (displayed || []).some((revId) => {
            const sid = map[revId]
            if (!sid) return false
            const turn = (turnsById as any)[sid]
            const val = turn?.userMessage?.content?.value
            return hasValidUser(val)
        })
        if (anyValid) return true
    }

    return false
})

