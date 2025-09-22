import {produce} from "immer"
import {atom} from "jotai"

import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"
import {
    displayedVariantsAtom,
    // displayedVariantsVariablesAtom,
} from "@/oss/components/Playground/state/atoms"
// import {updateGenerationDataPropertyMutationAtom} from "@/oss/components/Playground/state/atoms/propertyMutations"
import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {
    chatSessionsByIdAtom,
    // chatSessionIdsAtom,
    chatTurnsByIdAtom,
    // chatTurnsByIdFamilyAtom,
    chatTurnIdsAtom,
    // logicalTurnIndexAtom,
    runStatusByRowRevisionAtom,
} from "@/oss/state/generation/entities"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
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
            const revPrompts = (get(promptsAtomFamily(baseline)) || []) as any[]
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
        let {turnId, variantId, revisions, messageId} = params
        const displayed = revisions ?? (get(displayedVariantsAtom) || [])

        if (variantId) {
            const rowId = turnId
            // map[variantId] || `turn-${variantId}-${turnId}`
            set(triggerWebWorkerTestAtom, {rowId, variantId, messageId})
            return
        }

        const x = get(chatTurnIdsAtom)
        const currentIndex = x.indexOf(turnId)

        set(chatTurnIdsAtom, (prev) => {
            const newIds = [...prev]
            newIds.slice(0, currentIndex + 1)
            return newIds.slice(0, currentIndex + 1)
        })

        if (Array.isArray(displayed) && displayed.length > 0) {
            for (const rev of displayed) {
                const rowId = turnId
                //  map[rev] || `turn-${rev}-${turnId}`
                set(triggerWebWorkerTestAtom, {rowId, variantId: rev, messageId})
            }
        } else {
            // Single run without variant and no displayed revisions: let worker resolve baseline
            set(triggerWebWorkerTestAtom, {rowId: turnId, messageId})
        }
    },
)

// Run the last runnable chat row (logical turn) across displayed revisions
// Runnable means the user message has non-empty text or an image_url with a url
export const runAllChatAtom = atom(null, (get, set) => {
    const turnIds = (get(chatTurnIdsAtom) || []) as string[]
    const turnsById = (get(chatTurnsByIdAtom) || {}) as Record<string, any>
    if (!Array.isArray(turnIds) || turnIds.length === 0) return

    // Simple check: non-empty user message (string) or any array content
    const hasUser = (val: any) => {
        if (typeof val === "string") return val.trim().length > 0
        if (Array.isArray(val)) return val.length > 0
        return false
    }

    let targetId: string | undefined
    for (let i = turnIds.length - 1; i >= 0; i--) {
        const rowId = turnIds[i]
        const turn = (turnsById as any)[rowId]
        const val = turn?.userMessage
        if (val) {
            targetId = rowId
            break
        }
    }
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

export const deleteAssistantForTurnAtom = atom(
    null,
    (get, set, params: {turnId: string; variantId?: string}) => {
        const {turnId, variantId} = params
        // Remove assistant content for provided revision or all displayed
        const targetRevs = variantId
            ? [variantId]
            : ((get(displayedVariantsAtom) || []) as string[])

        set(chatTurnsByIdAtom, (prev) =>
            produce(prev as any, (draft: any) => {
                const t = draft?.[turnId]
                if (!t) return
                if (!t.assistantMessageByRevision) t.assistantMessageByRevision = {}
                for (const rev of targetRevs) {
                    if (rev in t.assistantMessageByRevision)
                        delete t.assistantMessageByRevision[rev]
                }
            }),
        )
        // Clear run status entries
        set(runStatusByRowRevisionAtom, (prev: any) => {
            const next = {...(prev || {})}
            for (const rev of targetRevs) {
                const key = `${turnId}:${rev}`
                if (key in next) delete next[key]
            }
            return next
        })
    },
)
