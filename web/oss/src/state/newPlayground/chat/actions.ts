import {getMetadataLazy} from "@agenta/entities/legacyAppRevision"
import {generateId} from "@agenta/shared/utils"
import {produce} from "immer"
import {atom} from "jotai"

import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"
import {displayedVariantsAtom} from "@/oss/components/Playground/state/atoms"
// import {updateGenerationDataPropertyMutationAtom} from "@/oss/components/Playground/state/atoms/propertyMutations"
import {
    chatSessionsByIdAtom,
    // chatSessionIdsAtom,
    chatTurnIdsAtom,
    chatTurnsByIdAtom,
} from "@/oss/state/generation/entities"
import {moleculeBackedPromptsAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"
import {cancelTestAtom} from "@/oss/state/newPlayground/mutations/execution"
import {triggerWebWorkerTestAtom} from "@/oss/state/newPlayground/mutations/webWorkerIntegration"

/**
 * Chat actions: centralized, explicit side effects for chat turns.
 * These bridge to existing worker/test execution while we migrate fully.
 */

export const addChatTurnAtom = atom(null, (get, set) => {
    set(chatTurnIdsAtom, (prev) => {
        const setIds = new Set(prev || [])
        setIds.add(`lt-${generateId()}`)
        return Array.from(setIds)
    })
})

// Set the user content for the last turn (baseline or provided revisions[0])
export const setLastUserContentAtom = atom(
    null,
    (get, set, params: {content: any; revisions?: string[]}) => {
        const displayedRevIds = (get(displayedVariantsAtom) || []) as string[]
        const revisions =
            Array.isArray(params?.revisions) && params.revisions.length > 0
                ? params.revisions
                : displayedRevIds
        if (!Array.isArray(revisions) || revisions.length === 0) return
        const baseline = revisions[0]

        const sid = `session-${baseline}`
        const sessions = get(chatSessionsByIdAtom) as Record<string, any>
        const turns = get(chatTurnsByIdAtom) as Record<string, any>
        const lastTurnId = (sessions?.[sid]?.turnIds || []).slice(-1)[0]
        if (!lastTurnId) return
        const userId = turns?.[lastTurnId]?.userMessage?.__id
        const contentId = turns?.[lastTurnId]?.userMessage?.content?.__id
        if (userId && contentId) {
            // set(updateGenerationDataPropertyMutationAtom, {
            //     rowId: lastTurnId,
            //     propertyId: contentId,
            //     messageId: userId,
            //     revisionId: baseline,
            //     value: Array.isArray(params.content)
            //         ? params.content
            //         : String(params.content ?? ""),
            // } as any)
        }
    },
)

// Attach an assistant message to the last turn for displayed revisions (or provided revisions)
export const attachAssistantToLastTurnAtom = atom(
    null,
    (get, set, params: {content: any; revisions?: string[]}) => {
        const displayedRevIds = (get(displayedVariantsAtom) || []) as string[]
        const targetRevs =
            Array.isArray(params?.revisions) && params.revisions.length > 0
                ? params.revisions
                : displayedRevIds
        if (!Array.isArray(targetRevs) || targetRevs.length === 0) return

        const baseline = targetRevs[0]
        const sid = `session-${baseline}`
        const sessions = get(chatSessionsByIdAtom) as Record<string, any>
        const sess = sessions[sid]
        const lastTurnId = (sess?.turnIds || []).slice(-1)[0]
        if (!lastTurnId) return

        // Build assistant message using baseline metadata if available
        let node: any
        try {
            const revPrompts = (get(moleculeBackedPromptsAtomFamily(baseline)) || []) as any[]
            const sample = revPrompts
                .flatMap((p: any) => p?.messages?.value || [])
                .find(Boolean) as any
            const metaId = sample?.__metadata as string | undefined
            if (metaId)
                node = createMessageFromSchema(
                    getMetadataLazy(metaId) as any,
                    {role: "assistant", content: params.content} as any,
                )
        } catch {}
        if (!node) {
            node = {
                __id: `assistant-${generateId()}`,
                role: {__id: `role-${generateId()}`, value: "assistant"},
                content: {__id: `content-${generateId()}`, value: params.content},
            }
        }

        set(chatTurnsByIdAtom, (prev) =>
            produce(prev, (draft: any) => {
                const t = draft[lastTurnId]
                if (!t) return
                if (!t.assistantMessageByRevision) t.assistantMessageByRevision = {}
                for (const revId of targetRevs) {
                    t.assistantMessageByRevision[revId] = node
                }
            }),
        )
    },
)

export const runChatTurnAtom = atom(
    null,
    async (
        get,
        set,
        params: {turnId: string; variantId?: string; revisions?: string[]; messageId?: string},
    ) => {
        const {turnId, variantId, revisions, messageId} = params
        const displayed = revisions ?? (get(displayedVariantsAtom) || [])

        const ids = (get(chatTurnIdsAtom) || []) as string[]
        const idx = ids.indexOf(turnId)
        const isLast = idx >= 0 && idx === ids.length - 1
        if (!isLast && messageId) {
            set(chatTurnIdsAtom, (prev) => {
                const list = prev || []
                const i = list.indexOf(turnId)
                return i >= 0 ? list.slice(0, i + 1) : list
            })
        }

        const currentIds = (get(chatTurnIdsAtom) || []) as string[]
        const currentIndex = currentIds.indexOf(turnId)

        if (variantId) {
            set(chatTurnIdsAtom, (prev) => {
                const list = prev || []
                const i = list.indexOf(turnId)
                return i >= 0 ? list.slice(0, i + 1) : list
            })

            const rowId = turnId
            // map[variantId] || `turn-${variantId}-${turnId}`
            set(triggerWebWorkerTestAtom, {rowId, revisionId: variantId, messageId})
            return
        }

        set(chatTurnIdsAtom, (prev) => {
            const newIds = [...prev]
            return newIds.slice(0, currentIndex + 1)
        })

        if (Array.isArray(displayed) && displayed.length > 0) {
            for (const rev of displayed) {
                const rowId = turnId
                //  map[rev] || `turn-${rev}-${turnId}`
                set(triggerWebWorkerTestAtom, {rowId, revisionId: rev, messageId})
            }
        } else {
            // Single run without variant and no displayed revisions: let worker resolve baseline
            set(triggerWebWorkerTestAtom, {rowId: turnId, messageId})
        }
    },
)

// Run the last runnable chat row (logical turn) across displayed revisions
// Runnable means the user message has non-empty text, an image_url with a url, or a file with a file_id
export const runAllChatAtom = atom(null, (get, set) => {
    const turnIds = (get(chatTurnIdsAtom) || []) as string[]
    if (!Array.isArray(turnIds) || turnIds.length === 0) return

    // Always target the last logical turn id.
    const targetId = turnIds[turnIds.length - 1]
    if (!targetId) return
    set(runChatTurnAtom, {turnId: targetId})
})

export const cancelChatTurnAtom = atom(
    null,
    async (get, set, params: {turnId: string; variantId?: string}) => {
        const {turnId, variantId} = params
        if (variantId) {
            set(cancelTestAtom, {rowId: turnId, variantId})
            return
        }
        // Cancel across displayed variants
        const displayed = (get(displayedVariantsAtom) || []) as string[]
        for (const rev of displayed) {
            set(cancelTestAtom, {rowId: turnId, variantId: rev})
        }
    },
)
