import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {
    chatTurnsByIdAtom,
    chatSessionsByIdAtom,
    logicalTurnIndexAtom,
} from "@/oss/state/generation/entities"

import {displayedVariantsAtom} from "../atoms"

// Optional: if you have a canonical logical order atom, import it here.
// Otherwise, we derive logical order by scanning all mapped turns and preserving map iteration order.

const toApiContent = (val: any): any => {
    if (typeof val === "string") return val
    if (Array.isArray(val)) {
        const parts = val
            .map((part: any) => {
                if (!part || typeof part !== "object") return null
                const type = (part?.type?.value ?? part?.type) as string | undefined
                if (type === "text") {
                    const textVal =
                        typeof part?.text === "string" ? part.text : (part?.text?.value ?? "")
                    return {type: "text", text: textVal}
                }
                if (type === "image_url" || part?.imageUrl || part?.image_url) {
                    const urlVal =
                        part?.imageUrl?.url?.value ??
                        part?.imageUrl?.value ??
                        part?.image_url?.url ??
                        part?.image_url ??
                        part?.url ??
                        ""
                    const detail = part?.imageUrl?.detail?.value ?? part?.detail ?? "auto"
                    if (!urlVal) return null
                    return {type: "image_url", image_url: {url: urlVal, detail}}
                }
                return null
            })
            .filter(Boolean)
        if (parts.length === 1 && (parts[0] as any)?.type === "text") return (parts[0] as any).text
        return parts
    }
    return ""
}

const extractImageParts = (val: any): {type: "image_url"; image_url: {url: string; detail: string}}[] => {
    if (!Array.isArray(val)) return []
    try {
        return val
            .map((part: any) => {
                if (!part || typeof part !== "object") return null
                const type = (part?.type?.value ?? part?.type) as string | undefined
                if (type === "image_url" || part?.imageUrl || part?.image_url) {
                    const urlVal =
                        part?.imageUrl?.url?.value ??
                        part?.imageUrl?.value ??
                        part?.image_url?.url ??
                        part?.image_url ??
                        part?.url ??
                        ""
                    const detail = part?.imageUrl?.detail?.value ?? part?.detail ?? "auto"
                    if (!urlVal) return null
                    return {type: "image_url", image_url: {url: urlVal, detail}}
                }
                return null
            })
            .filter(Boolean) as {type: "image_url"; image_url: {url: string; detail: string}}[]
    } catch {
        return []
    }
}

export const chatHistorySelectorFamily = atomFamily(
    (params: {revisionId: string; untilTurnId: string}) =>
        atom((get) => {
            const {revisionId, untilTurnId} = params
            const logicalIndex = (get(logicalTurnIndexAtom) || {}) as Record<
                string,
                Record<string, string>
            >
            const turns = (get(chatTurnsByIdAtom) || {}) as Record<string, any>
            const displayed = (get(displayedVariantsAtom) || []) as string[]

            // Derive a stable logical order
            // Prefer baseline session order when available; otherwise fallback to logicalIndex key order
            let logicalOrder: string[] = []
            const baseline = Array.isArray(displayed) ? displayed[0] : undefined
            const sessions = get(chatSessionsByIdAtom) as Record<string, any>
            const turnsMap = turns
            if (baseline) {
                const sid = `session-${baseline}`
                const sess = sessions?.[sid]
                const ids: string[] = Array.isArray(sess?.turnIds) ? sess.turnIds : []
                if (ids.length > 0) {
                    const lids = ids
                        .map((tid) => (turnsMap as any)?.[tid]?.logicalTurnId)
                        .filter(Boolean)
                    // De-duplicate while preserving order
                    const seen = new Set<string>()
                    for (const lid of lids) if (!seen.has(lid)) seen.add(lid)
                    logicalOrder = Array.from(seen)
                }
            }
            if (!Array.isArray(logicalOrder) || logicalOrder.length === 0) {
                logicalOrder = Object.keys(logicalIndex)
            }

            const history: {role: "user" | "assistant"; content: any}[] = []

            const buildUserContent = (ownVal: any, donorVal: any): any | null => {
                // 1) Derive own content
                let ownContent: any | null = null
                let ownHasImages = false
                if (typeof ownVal === "string") {
                    const trimmed = ownVal.trim()
                    if (trimmed.length) ownContent = toApiContent(ownVal)
                } else if (Array.isArray(ownVal)) {
                    ownContent = toApiContent(ownVal)
                    ownHasImages = extractImageParts(ownVal).length > 0
                    const hasContent =
                        (Array.isArray(ownContent) && ownContent.length > 0) ||
                        (typeof ownContent === "string" && ownContent.trim().length > 0)
                    if (!hasContent) ownContent = null
                }

                // 2) If no own content, fallback entirely to donor
                if (!ownContent) return toApiContent(donorVal)

                // 3) If own content exists but lacks images, merge donor images (if any)
                const donorImages = extractImageParts(donorVal)
                if (!ownHasImages && donorImages.length > 0) {
                    if (typeof ownContent === "string") {
                        if (ownContent.trim().length > 0) {
                            return [
                                {type: "text", text: ownContent},
                                ...donorImages,
                            ]
                        }
                    } else if (Array.isArray(ownContent)) {
                        return [...ownContent, ...donorImages]
                    }
                }
                return ownContent
            }

            for (const lid of logicalOrder) {
                const mapForLid = (logicalIndex as any)[lid] || {}
                const sid = (mapForLid as Record<string, string>)[revisionId]
                if (!sid) continue
                const turn = turns[sid]
                const uVal = turn?.userMessage?.content?.value
                const donorRev = displayed?.[0] || Object.keys(mapForLid)[0]
                const donorSid = donorRev ? (mapForLid as any)[donorRev] : undefined
                const donorTurn = donorSid ? turns[donorSid] : undefined
                const donorVal = donorTurn?.userMessage?.content?.value
                const content = buildUserContent(uVal, donorVal)
                if (content !== null && content !== undefined) history.push({role: "user", content})

                if (sid === untilTurnId) break
                const aVal = turn?.assistantMessageByRevision?.[revisionId]?.content?.value
                if (typeof aVal === "string") {
                    const trimmed = aVal.trim()
                    const isPlaceholder =
                        trimmed === "Generating response…" || trimmed === "Generating response..."
                    if (trimmed.length && !isPlaceholder)
                        history.push({role: "assistant", content: toApiContent(aVal)})
                } else if (Array.isArray(aVal)) {
                    const content = toApiContent(aVal)
                    const hasContent =
                        (Array.isArray(content) && content.length > 0) ||
                        typeof content === "string"
                    if (hasContent) history.push({role: "assistant", content})
                }
            }

            // Final safeguard for completely empty histories
            if (history.length === 0 && logicalOrder.length > 0) {
                const firstLid = logicalOrder[0]
                const mapForLid = (logicalIndex as any)[firstLid] || {}
                const donorRev = displayed?.[0] || Object.keys(mapForLid)[0]
                const donorSid = donorRev ? (mapForLid as any)[donorRev] : undefined
                const donorTurn = donorSid ? turns[donorSid] : undefined
                const donorVal = donorTurn?.userMessage?.content?.value
                const content = toApiContent(donorVal)
                const hasContent =
                    (Array.isArray(content) && content.length > 0) ||
                    (typeof content === "string" && content.trim().length > 0)
                if (hasContent) history.push({role: "user", content})
            }

            return history
        }),
)
