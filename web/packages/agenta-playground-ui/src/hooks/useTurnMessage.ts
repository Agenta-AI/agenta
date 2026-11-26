import {useCallback, useMemo, useRef, useState} from "react"

import {executionItemController, playgroundController} from "@agenta/playground"
import type {ChatMessage, MessageTarget, SimpleChatMessage} from "@agenta/playground"
import type {FileContentPart, ImageContentPart, MessageContent} from "@agenta/shared/types"
import {
    addFileToContent,
    addImageToContent,
    getAttachments,
    removeAttachmentFromContent,
    updateTextInContent,
} from "@agenta/shared/utils"
import type {PromptUploadFile} from "@agenta/ui/components/presentational"
import {atom, useAtomValue, useSetAtom} from "jotai"
import JSON5 from "json5"
import {v4 as uuidv4} from "uuid"

import {createToolCallPayloads} from "../panels/shared/ToolCallView"

export type TurnMessageKind = "user" | "assistant" | "tool"

export interface UseTurnMessageParams {
    entityId: string
    /** The session turn id (`turn-<rev>-<logical>`); a user message's own id. */
    rowId: string
    kind: TurnMessageKind
    /** Which tool reply of the turn, for `kind: "tool"`. */
    toolIndex?: number
    /** A message to show instead of the stored one (an assistant reply built from the run result). */
    messageOverride?: SimpleChatMessage | null
}

/** An open attachment slot under a user message, and the attachment it added. */
export interface UploadSlot {
    id: string
    type: "image" | "document"
    /** The image the slot shows. */
    file?: PromptUploadFile
    /** The file data the document slot shows. */
    value?: string
    /** The index, among the message's attachments, of the attachment this slot added. */
    index?: number
}

const MAX_SLOTS = 5

type Attachment = ImageContentPart | FileContentPart

function textOf(content: MessageContent | undefined | null): string {
    if (!content) return ""
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        return content
            .filter((part) => part.type === "text")
            .map((part) => (part as {type: "text"; text: string}).text)
            .join("")
    }
    return ""
}

/** Pretty JSON when the text is a JSON object or array, else the text itself. */
function toEditorText(content: MessageContent | undefined | null): string {
    const fallback = textOf(content)
    const candidates = typeof content === "string" ? [content, fallback] : [fallback]
    for (const candidate of candidates) {
        const trimmed = candidate.trim()
        if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) continue
        try {
            const parsed: unknown = JSON5.parse(candidate)
            if (parsed !== null && typeof parsed === "object") {
                return JSON.stringify(parsed, null, 2)
            }
        } catch {
            // Not JSON: show the plain text.
        }
    }
    return fallback
}

/** The slots after the attachment at `removed` left the message: later indexes move down. */
const shiftSlotIndexes = (slots: UploadSlot[], removed: number) =>
    slots.map((s) => (s.index !== undefined && s.index > removed ? {...s, index: s.index - 1} : s))

/** `content` with the attachment at `index` swapped for `next`, in place. */
function replaceAttachment(content: MessageContent, index: number, next: Attachment) {
    if (!Array.isArray(content)) return content
    let attachmentIndex = 0
    return content.map((part) => {
        if (part.type === "text") return part
        return attachmentIndex++ === index ? next : part
    })
}

const imagePart = (url: string) => getAttachments(addImageToContent(null, url))[0]
const filePart = (fileData: string, filename: string, format: string) =>
    getAttachments(addFileToContent(null, fileData, filename, format))[0]

/**
 * One chat message of the playground: finds it in the message store, and edits, re-runs,
 * removes and attaches files to it. Each message subscribes to its own message only, so typing
 * in one message does not re-render the others.
 */
export function useTurnMessage({
    entityId,
    rowId,
    kind,
    toolIndex = 0,
    messageOverride,
}: UseTurnMessageParams) {
    const sessionId = `sess:${entityId}`
    const isToolKind = kind === "tool"

    // One derived atom per message. A derived atom only notifies when its value changes, and the
    // reducer keeps the object of every message it does not patch, so this message's subscribers
    // run again only when this message (or its run status) changes.
    const storedMessageAtom = useMemo(
        () =>
            atom((get): SimpleChatMessage | null => {
                const byId = get(executionItemController.selectors.messagesById) as Record<
                    string,
                    ChatMessage
                >
                if (kind === "user") return (byId[rowId] as SimpleChatMessage) ?? null
                const ids = get(executionItemController.selectors.messageIds) as string[]
                let toolsSeen = 0
                for (const id of ids) {
                    const m = byId[id]
                    if (!m || m.parentId !== rowId || m.sessionId !== sessionId) continue
                    if (kind === "assistant" && m.role === "assistant") {
                        return m as SimpleChatMessage
                    }
                    if (kind === "tool" && m.role === "tool") {
                        if (toolsSeen === toolIndex) return m as SimpleChatMessage
                        toolsSeen++
                    }
                }
                return null
            }),
        [kind, rowId, sessionId, toolIndex],
    )
    // Any child message (assistant, Error, tool) means the turn has run. Gates Re-run.
    const hasBeenRunAtom = useMemo(
        () =>
            atom((get) => {
                const byId = get(executionItemController.selectors.messagesById) as Record<
                    string,
                    ChatMessage
                >
                const ids = get(executionItemController.selectors.messageIds) as string[]
                return ids.some((id) => {
                    const m = byId[id]
                    return Boolean(m && m.parentId === rowId && m.sessionId === sessionId)
                })
            }),
        [rowId, sessionId],
    )
    const resultHashAtom = useMemo(
        () =>
            atom((get) => {
                const map = get(executionItemController.selectors.runStatusByRowEntity) as Record<
                    string,
                    {resultHash?: string | null} | undefined
                >
                return map?.[`${rowId}:${entityId}`]?.resultHash ?? null
            }),
        [rowId, entityId],
    )

    const storedMessage = useAtomValue(storedMessageAtom)
    const hasBeenRun = useAtomValue(hasBeenRunAtom)
    const resultHash = useAtomValue(resultHashAtom)
    const isComparisonView = useAtomValue(
        useMemo(() => playgroundController.selectors.isComparisonView(), []),
    )
    const fullResult = useAtomValue(
        useMemo(
            () => executionItemController.selectors.fullResult({rowId, entityId}),
            [rowId, entityId],
        ),
    )

    const patchMessage = useSetAtom(executionItemController.actions.patchMessage)
    const deleteMessage = useSetAtom(executionItemController.actions.deleteMessage)
    const clearResponse = useSetAtom(executionItemController.actions.clearResponse)
    const triggerTest = useSetAtom(executionItemController.actions.triggerTest)
    const truncateChat = useSetAtom(executionItemController.actions.truncateChat)
    const clearSessionResponses = useSetAtom(executionItemController.actions.clearSessionResponses)

    const message = messageOverride ?? storedMessage
    const editorText = useMemo(() => toEditorText(message?.content), [message?.content])
    const toolPayloads = useMemo(
        () => (kind === "assistant" ? createToolCallPayloads(message?.tool_calls) : []),
        [kind, message?.tool_calls],
    )
    const resultHashes = useMemo(() => (resultHash ? [resultHash] : []), [resultHash])
    const results = useMemo(() => {
        const output = fullResult?.output
        if (!output) return []
        return Array.isArray(output) ? output.filter(Boolean) : [output]
    }, [fullResult])

    const target: MessageTarget = useMemo(
        () => ({turnId: rowId, kind, sessionId, toolIndex}),
        [rowId, kind, sessionId, toolIndex],
    )
    const patchContent = useCallback(
        (change: (content: MessageContent) => MessageContent) =>
            patchMessage({
                target,
                updater: (m) => (m ? {...m, content: change(m.content ?? "")} : m),
            }),
        [patchMessage, target],
    )

    const onChangeText = useCallback(
        (text: string) => patchContent((content) => updateTextInContent(content, text)),
        [patchContent],
    )

    const onChangeRole = useCallback(
        (role: string) => {
            if (isToolKind || !message) return
            patchMessage({target, updater: (m) => (m ? {...m, role} : m)})
        },
        [isToolKind, message, patchMessage, target],
    )

    const rerun = useCallback(() => {
        if (isToolKind) return
        const messageId = message?.id
        if (isComparisonView) {
            // Compare: clear only this revision's replies from this turn on.
            clearSessionResponses({sessionId, afterUserMessageId: rowId})
        } else {
            // Single view: delete this turn's reply, then every later turn (they depend on it).
            if (kind === "user" || messageId) {
                deleteMessage({target: {turnId: rowId, kind: "assistant", sessionId}})
            }
            if (messageId) truncateChat({afterTurnId: rowId})
        }
        triggerTest({executionId: entityId, step: {id: rowId, messageId}})
    }, [
        isToolKind,
        kind,
        message?.id,
        isComparisonView,
        clearSessionResponses,
        sessionId,
        rowId,
        deleteMessage,
        truncateChat,
        triggerTest,
        entityId,
    ])

    const remove = useCallback(() => {
        if (!message?.id) return
        if (isToolKind) deleteMessage({target})
        else if (kind === "assistant") {
            deleteMessage({target: {turnId: rowId, kind: "assistant", sessionId}})
        } else deleteMessage({target: {turnId: rowId, kind: "user"}})
        // A reply shown from the run result also lives in the run state.
        if (kind === "assistant" && messageOverride) clearResponse({rowId, entityId})
    }, [
        message?.id,
        isToolKind,
        deleteMessage,
        target,
        kind,
        rowId,
        sessionId,
        messageOverride,
        clearResponse,
        entityId,
    ])

    // -- Attachments ------------------------------------------------------------------------

    const [uploadSlots, setUploadSlotsState] = useState<UploadSlot[]>([])
    // The slots as of the last change, so two changes before a re-render see each other.
    const slotsRef = useRef<UploadSlot[]>([])
    const setUploadSlots = useCallback((change: (prev: UploadSlot[]) => UploadSlot[]) => {
        slotsRef.current = change(slotsRef.current)
        setUploadSlotsState(slotsRef.current)
    }, [])
    const imageSlotCount = uploadSlots.filter((s) => s.type === "image").length
    const documentSlotCount = uploadSlots.filter((s) => s.type === "document").length
    const canAddImage = imageSlotCount < MAX_SLOTS
    const canAddDocument = documentSlotCount < MAX_SLOTS

    const addUploadSlot = useCallback(
        (type: UploadSlot["type"]) =>
            setUploadSlots((prev) =>
                prev.filter((s) => s.type === type).length >= MAX_SLOTS
                    ? prev
                    : [...prev, {id: uuidv4(), type}],
            ),
        [setUploadSlots],
    )

    /**
     * Puts `part` in the message as the slot's attachment, replacing the one it added before, and
     * records its index on the slot.
     */
    const attachToSlot = useCallback(
        (slotId: string, part: Attachment, append: (content: MessageContent) => MessageContent) => {
            const owned = slotsRef.current.find((s) => s.id === slotId)?.index
            let index = owned
            patchContent((content) => {
                if (owned !== undefined) return replaceAttachment(content, owned, part)
                index = getAttachments(content).length
                return append(content)
            })
            return index
        },
        [patchContent],
    )

    const setSlotImage = useCallback(
        (slotId: string, file: PromptUploadFile | null) => {
            if (!file) return
            const base64 = typeof file.base64 === "string" ? file.base64 : undefined
            const url = base64 || file.url || file.thumbUrl
            const index = url
                ? attachToSlot(slotId, imagePart(url), (content) => addImageToContent(content, url))
                : undefined
            setUploadSlots((prev) =>
                prev.map((s) => (s.id === slotId ? {...s, file, index: index ?? s.index} : s)),
            )
        },
        [attachToSlot, setUploadSlots],
    )

    const setSlotDocument = useCallback(
        (slotId: string, fileData: string, filename: string, format: string) => {
            const index = attachToSlot(slotId, filePart(fileData, filename, format), (content) =>
                addFileToContent(content, fileData, filename, format),
            )
            setUploadSlots((prev) =>
                prev.map((s) => (s.id === slotId ? {...s, value: fileData, index} : s)),
            )
        },
        [attachToSlot, setUploadSlots],
    )

    const removeSlot = useCallback(
        (slotId: string) => {
            const index = slotsRef.current.find((s) => s.id === slotId)?.index
            setUploadSlots((prev) => {
                const rest = prev.filter((s) => s.id !== slotId)
                return index === undefined ? rest : shiftSlotIndexes(rest, index)
            })
            if (index === undefined) return
            patchContent((content) => removeAttachmentFromContent(content, index))
        },
        [patchContent, setUploadSlots],
    )

    /** Adds a file that no slot owns (a pasted snippet). */
    const addFile = useCallback(
        (fileData: string, filename: string, format: string) =>
            patchContent((content) => addFileToContent(content, fileData, filename, format)),
        [patchContent],
    )

    // The attachments no open slot shows: the ones the message already had, and snippets.
    const attachments = useMemo(() => getAttachments(message?.content ?? null), [message?.content])
    const listedIndexes = useMemo(() => {
        const owned = new Set(uploadSlots.map((s) => s.index))
        return attachments.map((_, index) => index).filter((index) => !owned.has(index))
    }, [attachments, uploadSlots])
    const listedAttachments = useMemo<MessageContent>(
        () => listedIndexes.map((index) => attachments[index]),
        [listedIndexes, attachments],
    )

    const removeListedAttachment = useCallback(
        (listedIndex: number) => {
            const index = listedIndexes[listedIndex]
            if (index === undefined) return
            setUploadSlots((prev) => shiftSlotIndexes(prev, index))
            patchContent((content) => removeAttachmentFromContent(content, index))
        },
        [listedIndexes, patchContent, setUploadSlots],
    )

    return {
        message,
        role: message?.role,
        isError: message?.role === "Error",
        editorText,
        hasBeenRun,
        isComparisonView,
        toolPayloads,
        resultHashes,
        results,
        onChangeText,
        onChangeRole,
        rerun,
        remove,
        uploadSlots,
        imageSlotCount,
        documentSlotCount,
        canAddImage,
        canAddDocument,
        addUploadSlot,
        setSlotImage,
        setSlotDocument,
        removeSlot,
        addFile,
        listedAttachments,
        removeListedAttachment,
    }
}

export type TurnMessageModel = ReturnType<typeof useTurnMessage>
