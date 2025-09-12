import {produce} from "immer"
import {atom} from "jotai"

import {
    chatTurnsByIdAtom as normChatTurnsByIdAtom,
    logicalTurnIndexAtom as normLogicalTurnIndexAtom,
} from "@/oss/state/generation/entities"

import {displayedVariantsAtom} from "../../variants"

/**
 * Update a turn's userMessage.content value in normalized chat turns.
 * - Ensures userMessage/content nodes exist
 * - If content is an array of parts, ensures a first text part is present and updates it
 * - Otherwise sets content.value directly to the provided string
 */
export const setUserMessageContentMutationAtom = atom(
    null,
    (get, set, params: {turnId: string; value: string}) => {
        const {turnId, value} = params || ({} as any)
        if (!turnId) return
        set(
            normChatTurnsByIdAtom,
            produce((draft: any) => {
                const t = draft[turnId]
                if (!t) return
                if (!t.userMessage) t.userMessage = {content: {value: ""}} as any
                if (!t.userMessage.content) t.userMessage.content = {value: ""} as any

                const content = t.userMessage.content as any
                const current = content.value

                if (Array.isArray(current)) {
                    const parts = current as any[]
                    let textIdx = parts.findIndex((p: any) => p?.type?.value === "text")
                    if (textIdx === -1) {
                        const textPart = {
                            __id: (parts[0]?.__id as string) || undefined,
                            __metadata: (parts[0]?.__metadata as any) || {},
                            type: {value: "text"},
                            text: {value: ""},
                        }
                        parts.unshift(textPart)
                        textIdx = 0
                    }
                    const textPart = parts[textIdx]
                    if (textPart?.text && typeof textPart.text === "object") {
                        textPart.text.value = value
                    } else {
                        parts[textIdx].text = {value}
                    }
                    content.value = parts
                } else {
                    content.value = value
                }
            }),
        )
    },
)

/**
 * Update user message content for ALL displayed revisions for a given logical turn id.
 * Useful when editing the baseline column in comparison view to keep peers in sync by default.
 */
export const setUserMessageContentForLogicalDisplayedMutationAtom = atom(
    null,
    (get, set, params: {logicalId: string; value: string}) => {
        const {logicalId, value} = params || ({} as any)
        if (!logicalId) return
        const index = (get(normLogicalTurnIndexAtom) || {}) as Record<
            string,
            Record<string, string>
        >
        const map = (index || {})[logicalId] || {}
        const displayed = (get(displayedVariantsAtom) || []) as string[]
        const turnIds = displayed
            .map((revId) => map[revId])
            .filter((sid): sid is string => typeof sid === "string" && sid.length > 0)

        for (const sid of turnIds) {
            set(setUserMessageContentMutationAtom, {turnId: sid, value})
        }
    },
)
