import {current} from "immer"
import {atom} from "jotai"

import {appChatModeAtom} from "@/oss/components/Playground/state/atoms/app"
import {generationInputRowIdsAtom} from "@/oss/components/Playground/state/atoms/generationProperties"
import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {
    inputRowsByIdFamilyAtom,
    inputRowIdsAtom,
    inputRowsByIdAtom,
    inputRowsByIdCacheAtom,
    inputRowVariableValueCacheAtom,
    rowIdIndexAtom,
    chatTurnIdsAtom,
    chatTurnsByIdFamilyAtom,
} from "@/oss/state/generation/entities"
import {
    addChatTurnAtom,
    attachAssistantToLastTurnAtom,
    setLastUserContentAtom,
} from "@/oss/state/newPlayground/chat/actions"
import {extractAllMessagesFromRows} from "@/oss/state/newPlayground/chat/parsers"
import {buildUserMessage} from "@/oss/state/newPlayground/helpers/messageFactory"

import {
    displayedVariantsAtom,
    displayedVariantsVariablesAtom,
    schemaInputKeysAtom,
} from "../../variants"

// Helper constants and utilities
const MESSAGE_FIELD_KEYS = new Set([
    "messages",
    "correct_answer",
    "expected_output",
    "ground_truth",
    "target",
    "label",
])

type NormalizedContentPart =
    | {type: "text"; text: string}
    | {type: "image_url"; image_url: {url: string; detail?: string}}

const unwrapValue = (input: any): any => {
    const visited = new Set<any>()
    let current = input
    while (
        current &&
        typeof current === "object" &&
        "value" in current &&
        current.value !== undefined &&
        current.value !== current &&
        !visited.has(current)
    ) {
        visited.add(current)
        current = (current as any).value
    }
    return current
}

const asString = (raw: any): string | undefined => {
    const value = unwrapValue(raw)
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return undefined
}

const buildImagePart = (raw: any): NormalizedContentPart | null => {
    const value = unwrapValue(raw)
    if (!value || typeof value !== "object") return null
    const url = asString((value as any).url ?? (value as any).uri ?? value)
    if (!url) return null
    const detail = asString((value as any).detail)
    const part: NormalizedContentPart = {type: "image_url", image_url: {url}}
    if (detail && detail.length > 0) part.image_url.detail = detail
    return part
}

const normalizeContentPart = (part: any): NormalizedContentPart | null => {
    const value = unwrapValue(part)
    if (value == null) return null

    const primitive = asString(value)
    if (primitive !== undefined) {
        return primitive.length > 0 ? {type: "text", text: primitive} : null
    }

    if (typeof value !== "object") return null

    const explicitType = asString((value as any).type)?.toLowerCase()
    if (explicitType === "image_url") {
        return buildImagePart((value as any).image_url ?? (value as any).imageUrl)
    }

    const imageCandidate = (value as any).image_url ?? (value as any).imageUrl
    const imagePart = imageCandidate ? buildImagePart(imageCandidate) : null
    if (imagePart) return imagePart

    const textValue =
        asString((value as any).text) ??
        asString((value as any).content) ??
        asString((value as any).message) ??
        asString(value)

    if (textValue && textValue.length > 0) return {type: "text", text: textValue}

    return null
}

const normalizeMessageContent = (raw: any): string | NormalizedContentPart[] => {
    const value = unwrapValue(raw)

    const primitive = asString(value)
    if (primitive !== undefined) return primitive

    if (Array.isArray(value)) {
        const parts = value
            .map((item) => normalizeContentPart(item))
            .filter((item): item is NormalizedContentPart => Boolean(item))
        return parts.length > 0 ? parts : ""
    }

    if (value && typeof value === "object") {
        const nested = (value as any).content ?? (value as any).parts
        if (nested && nested !== value) {
            const normalized = normalizeMessageContent(nested)
            if (typeof normalized === "string") {
                if (normalized.length > 0) return normalized
            } else if (normalized.length > 0) {
                return normalized
            }
        }

        const single = normalizeContentPart(value)
        if (single) return [single]
    }

    return ""
}

/**
 * Load testset rows into normalized store only.
 * - Completion: seeds inputRowsByIdAtom with variables for each displayed revision.
 * - Chat: ensures sessions and seeds one or more user turns from testset messages.
 * Custom workflows derive variables from schema keys when available.
 */
export const loadTestsetNormalizedMutationAtom = atom(
    null,
    (
        get,
        set,
        params: {
            testsetData: Record<string, any>[]
            isChatVariant?: boolean
            regenerateVariableIds?: boolean
        },
    ) => {
        const {
            testsetData = [],
            isChatVariant = false,
            regenerateVariableIds = false,
        } = params || ({} as any)
        if (!Array.isArray(testsetData) || testsetData.length === 0) return

        const displayedRevIds = (get(displayedVariantsAtom) || []) as string[]
        const baseline = displayedRevIds?.[0]
        const targetRevisionIds =
            displayedRevIds && displayedRevIds.length > 0 ? displayedRevIds : [baseline || ""]

        // 1) Variables: load for chat vs completion appropriately
        const dataset = Array.isArray(testsetData) ? testsetData : []
        if (isChatVariant) {
            // Chat: update the single default row without resetting the input rows map
            const rowData = (dataset[0] || {}) as Record<string, any>
            const newRowId = `row-__default__`
            const keys = Object.keys(rowData || {}).filter((k) => !MESSAGE_FIELD_KEYS.has(k))

            set(rowIdIndexAtom, (prev) => ({
                ...(prev || {}),
                [newRowId]: {latestRevisionId: baseline},
            }))
            set(inputRowsByIdFamilyAtom(newRowId), (draft: any) => {
                if (!draft) return
                if (!Array.isArray(draft.variables)) draft.variables = []

                const byName = new Map<string, any>()
                for (const n of draft.variables) {
                    const k = (n as any)?.key ?? (n as any)?.__id
                    if (typeof k === "string" && k) byName.set(k, n)
                }
                for (const k of keys) {
                    const vRaw = (rowData as any)[k]
                    if (vRaw === undefined) continue
                    const v = Array.isArray(vRaw)
                        ? JSON.stringify(vRaw)
                        : typeof vRaw === "string"
                          ? vRaw
                          : String(vRaw ?? "")
                    const node = byName.get(k)
                    if (!node) continue
                    if (node.content && typeof node.content === "object") node.content.value = v
                    ;(node as any).value = v
                    if (regenerateVariableIds) (node as any).__id = generateId()
                }
            })
        } else {
            // Completion: reset and create a row per dataset item
            set(inputRowIdsAtom, [])
            set(inputRowsByIdAtom, {})
            set(inputRowsByIdCacheAtom, {})
            set(inputRowVariableValueCacheAtom, {})
            set(rowIdIndexAtom, {})
            for (const rowDataRaw of dataset) {
                const rowData = (rowDataRaw || {}) as Record<string, any>
                const newRowId = `row-${generateId()}`
                const keys = Object.keys(rowData || {}).filter((k) => !MESSAGE_FIELD_KEYS.has(k))
                set(rowIdIndexAtom, (prev) => ({
                    ...(prev || {}),
                    [newRowId]: {latestRevisionId: baseline},
                }))
                set(inputRowsByIdFamilyAtom(newRowId), (draft: any) => {
                    if (!draft) return
                    if (!Array.isArray(draft.variables)) draft.variables = []

                    const byName = new Map<string, any>()
                    for (const n of draft.variables) {
                        const k = (n as any)?.key ?? (n as any)?.__id
                        if (typeof k === "string" && k) byName.set(k, n)
                    }
                    for (const k of keys) {
                        const vRaw = (rowData as any)[k]
                        if (vRaw === undefined) continue
                        const v = Array.isArray(vRaw)
                            ? JSON.stringify(vRaw)
                            : typeof vRaw === "string"
                              ? vRaw
                              : String(vRaw ?? "")
                        const node = byName.get(k)
                        if (!node) continue
                        if (node.content && typeof node.content === "object") node.content.value = v
                        ;(node as any).value = v
                        if (regenerateVariableIds) (node as any).__id = generateId()
                    }
                })
                set(inputRowIdsAtom, (prev) => [...(prev || []), newRowId])
            }
        }

        if (!isChatVariant) {
            // Completion mode: no chat messages to load
            return
        }

        // 2) Messages: create chat turns from messages arrays in rows
        const allMessages = extractAllMessagesFromRows(testsetData, "messages")
        if (Array.isArray(allMessages) && allMessages.length > 0) {
            // Clear existing chat rows before loading from testset
            set(chatTurnIdsAtom, [])

            const constructTurns = (messages: any[]) => {
                const firstUserMessage = messages.find((m) => m.role === "user")

                if (firstUserMessage) {
                    const messagesAfterUserMessage = messages.slice(
                        messages.indexOf(firstUserMessage) + 1,
                    )
                    const nextUserMessage = messagesAfterUserMessage.find((m) => m.role === "user")

                    const logicalId = `lt-${generateId()}`
                    set(chatTurnIdsAtom, (prev) => [...(prev || []), logicalId])
                    set(chatTurnsByIdFamilyAtom(logicalId), (draft: any) => {
                        if (!draft) return
                        const schema = draft.userMessage?.__metadata
                            ? getMetadataLazy(draft.userMessage.__metadata as any)
                            : undefined

                        const userContent = normalizeMessageContent(firstUserMessage.content)

                        draft.userMessage = buildUserMessage(schema as any, {
                            content: userContent,
                            role: "user",
                        })

                        const turnMessages = messagesAfterUserMessage
                            ? messagesAfterUserMessage.slice(
                                  0,
                                  messagesAfterUserMessage.indexOf(nextUserMessage),
                              )
                            : messagesAfterUserMessage

                        // Choose the last non-user message between user turns as assistant content
                        const assistantSource = Array.isArray(turnMessages)
                            ? [...turnMessages].reverse().find((m) => m && m.role !== "user")
                            : null
                        const assistantContent = assistantSource
                            ? normalizeMessageContent(assistantSource.content)
                            : ""

                        if (!draft.assistantMessageByRevision) draft.assistantMessageByRevision = {}

                        for (const revId of targetRevisionIds) {
                            const assistantMessage = buildUserMessage(
                                schema as any,
                                {
                                    role: "assistant",
                                    content: assistantContent,
                                } as any,
                            )
                            // Append the same assistant message for every displayed revision in this row
                            draft.assistantMessageByRevision[revId] = assistantMessage
                        }
                    })

                    if (nextUserMessage) {
                        const nextMessages = messagesAfterUserMessage.slice(
                            messagesAfterUserMessage.indexOf(nextUserMessage),
                        )
                        constructTurns(nextMessages)
                    }
                }
            }

            constructTurns(allMessages)
        }
    },
)
