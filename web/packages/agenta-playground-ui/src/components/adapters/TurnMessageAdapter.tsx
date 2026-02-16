import React, {ComponentProps, useCallback, useMemo, useRef, useState} from "react"

import {executionItemController, playgroundController} from "@agenta/playground"
import type {ChatMessage, MessageTarget, SimpleChatMessage} from "@agenta/playground"
import type {MessageContent} from "@agenta/shared/types"
import {
    addImageToContent,
    addFileToContent,
    removeAttachmentFromContent,
    getAttachments,
    updateTextInContent,
} from "@agenta/shared/utils"
import {
    ChatMessageEditor as MessageEditor,
    AttachmentButton,
    MessageAttachments,
} from "@agenta/ui/chat-message"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import JSON5 from "json5"
import {v4 as uuidv4} from "uuid"

import {openPlaygroundFocusDrawerAtom} from "../../state/focusDrawer"
import {createToolCallPayloads, ToolCallViewHeader} from "../ToolCallView"
import TurnMessageHeaderOptions from "../TurnMessageHeaderOptions"
import type {RepetitionNavProps, TurnMessageHeaderOptionsProps} from "../TurnMessageHeaderOptions"

interface Props {
    entityId: string
    rowId: string // session turn id (turn-<rev>-<logical>)
    kind: "user" | "assistant" | "tool"
    disabled?: boolean
    className?: string
    editorClassName?: string
    headerClassName?: string
    placeholder?: string
    headerRight?: React.ReactNode
    footer?: React.ReactNode
    messageOptionProps?: Partial<ComponentProps<typeof TurnMessageHeaderOptions>>
    toolCallsView?: {title?: string; json: string} | null
    toolIndex?: number
    messageOverride?: unknown
    isJSON?: boolean
    isTool?: boolean
    messageProps?: AdapterMessageProps
    editorType?: ComponentProps<typeof MessageEditor>["editorType"]
    handleRerun?: (args: {rowId: string; entityId: string}) => void
    resultHashes?: string[]
    results?: unknown[]
    repetitionProps?: RepetitionNavProps
    /** Render slot for testset drawer button (OSS-specific) */
    renderTestsetButton?: TurnMessageHeaderOptionsProps["renderTestsetButton"]
    /** Render slot for repetition navigation (OSS-specific) */
    renderRepetitionNav?: TurnMessageHeaderOptionsProps["renderRepetitionNav"]
}

type AdapterMessageProps = Partial<ComponentProps<typeof MessageEditor>> & {
    footerClassName?: string
}

// Extract display text from SimpleChatMessage content
function extractTextFromContent(content: MessageContent | undefined | null): string {
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

const TurnMessageAdapter: React.FC<Props> = ({
    entityId,
    rowId,
    kind,
    disabled,
    className,
    editorClassName,
    headerClassName,
    placeholder,
    headerRight,
    messageOptionProps = {},
    footer,
    toolCallsView,
    isJSON,
    isTool,
    messageProps: _messageProps,
    editorType,
    handleRerun: propsHandleRerun,
    resultHashes: propsResultHashes,
    results: propsResults,
    toolIndex = 0,
    messageOverride,
    repetitionProps,
    renderTestsetButton,
    renderRepetitionNav,
}) => {
    const openFocusDrawer = useSetAtom(openPlaygroundFocusDrawerAtom)
    const isComparisonView = useAtomValue(
        useMemo(() => playgroundController.selectors.isComparisonView(), []),
    )
    const editorIdRef = useRef(uuidv4())
    const messagesById = useAtomValue(
        useMemo(() => executionItemController.selectors.messagesById, []),
    )
    const messageIds = useAtomValue(useMemo(() => executionItemController.selectors.messageIds, []))
    const patchMessage = useSetAtom(executionItemController.actions.patchMessage)
    const deleteMsg = useSetAtom(executionItemController.actions.deleteMessage)
    const clearResponseByRowEntity = useSetAtom(executionItemController.actions.clearResponse)
    const {footerClassName, ...messageProps} = (_messageProps || {}) as AdapterMessageProps
    const [isMessageCollapsed, setIsMessageCollapsed] = useState(false)
    const isToolKind = kind === "tool"
    const sessionId = `sess:${entityId}`

    // Build the message target for reducer dispatches
    const messageTarget: MessageTarget = useMemo(
        () => ({turnId: rowId, kind, sessionId, toolIndex}),
        [rowId, kind, sessionId, toolIndex],
    )

    const msg = useMemo<SimpleChatMessage | null>(() => {
        if (messageOverride) return messageOverride as SimpleChatMessage
        if (kind === "user") {
            return (messagesById[rowId] as SimpleChatMessage) ?? null
        }
        if (kind === "assistant") {
            for (const mid of messageIds) {
                const m = messagesById[mid] as ChatMessage | undefined
                if (
                    m &&
                    m.parentId === rowId &&
                    m.sessionId === sessionId &&
                    m.role === "assistant"
                )
                    return m as SimpleChatMessage
            }
            return null
        }
        if (kind === "tool") {
            let idx = 0
            for (const mid of messageIds) {
                const m = messagesById[mid] as ChatMessage | undefined
                if (m && m.parentId === rowId && m.sessionId === sessionId && m.role === "tool") {
                    if (idx === toolIndex) return m as SimpleChatMessage
                    idx++
                }
            }
            return null
        }
        return null
    }, [messagesById, messageIds, rowId, sessionId, kind, toolIndex, messageOverride])

    const roleValue = msg?.role
    const computedText = useMemo(() => extractTextFromContent(msg?.content), [msg?.content])

    const {editorText, isJsonContent} = useMemo(() => {
        const fallback = computedText
        const candidates: string[] = []

        if (typeof msg?.content === "string") {
            candidates.push(msg.content)
        }

        candidates.push(fallback)

        for (const candidate of candidates) {
            if (typeof candidate !== "string") continue
            const trimmed = candidate.trim()
            if (!trimmed) continue
            if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue
            try {
                const parsed = JSON5.parse(candidate)
                if (parsed !== null && typeof parsed === "object") {
                    return {
                        editorText: JSON.stringify(parsed, null, 2),
                        isJsonContent: true,
                    }
                }
            } catch {
                // ignore parse errors and fall back to plain text rendering
            }
        }

        return {editorText: fallback, isJsonContent: false}
    }, [computedText, msg])

    const effectiveDisabled = Boolean(disabled)
    const isUserRole = kind === "user" && !isToolKind

    const attachments = useMemo(() => getAttachments(msg?.content ?? null), [msg?.content])
    const hasAttachments = attachments.length > 0

    const handleAddImage = useCallback(
        (imageUrl: string) => {
            patchMessage({
                target: messageTarget,
                updater: (m) => {
                    if (!m) return m
                    return {...m, content: addImageToContent(m.content ?? "", imageUrl)}
                },
            })
        },
        [messageTarget, patchMessage],
    )

    const handleAddFile = useCallback(
        (fileData: string, filename: string, format: string) => {
            patchMessage({
                target: messageTarget,
                updater: (m) => {
                    if (!m) return m
                    return {
                        ...m,
                        content: addFileToContent(m.content ?? "", fileData, filename, format),
                    }
                },
            })
        },
        [messageTarget, patchMessage],
    )

    const handleRemoveAttachment = useCallback(
        (attachmentIndex: number) => {
            patchMessage({
                target: messageTarget,
                updater: (m) => {
                    if (!m) return m
                    return {
                        ...m,
                        content: removeAttachmentFromContent(m.content ?? "", attachmentIndex),
                    }
                },
            })
        },
        [messageTarget, patchMessage],
    )

    const deleteMessage = useCallback(() => {
        if (isToolKind) return
        const msgId = msg?.id
        if (!msgId) return
        if (kind === "assistant") {
            deleteMsg({target: {turnId: rowId, kind: "assistant", sessionId}})
        } else {
            deleteMsg({target: {turnId: rowId, kind: "user"}})
        }
        if (kind === "assistant" && messageOverride) {
            clearResponseByRowEntity({rowId, entityId})
        }
    }, [
        deleteMsg,
        kind,
        entityId,
        sessionId,
        rowId,
        msg,
        isToolKind,
        messageOverride,
        clearResponseByRowEntity,
    ])

    const onChangeRole = useCallback(
        (v: string) => {
            if (isToolKind) return
            if (!msg) return
            patchMessage({
                target: messageTarget,
                updater: (m) => {
                    if (!m) return m
                    return {...m, role: v}
                },
            })
        },
        [msg, messageTarget, patchMessage, isToolKind],
    )

    const onChangeText = useCallback(
        (v: string) => {
            patchMessage({
                target: messageTarget,
                updater: (m) => {
                    if (!m) return m
                    return {...m, content: updateTextInContent(m.content ?? "", v)}
                },
            })
        },
        [messageTarget, patchMessage],
    )

    const triggerTest = useSetAtom(executionItemController.actions.triggerTest)
    const truncateChat = useSetAtom(executionItemController.actions.truncateChat)
    const runStatusMap = useAtomValue(
        useMemo(() => executionItemController.selectors.runStatusByRowEntity, []),
    ) as Record<string, {resultHash?: string | null} | undefined>

    const handleRerun = useCallback(() => {
        if (isToolKind) return
        const logicalId = String(rowId)
        const messageId = msg?.id
        if (kind === "assistant" && messageId) {
            deleteMsg({target: {turnId: rowId, kind: "assistant", sessionId}})
        } else if (kind === "user") {
            deleteMsg({target: {turnId: rowId, kind: "assistant", sessionId}})
        }
        if (messageId) {
            truncateChat({afterTurnId: logicalId})
        }
        triggerTest({
            executionId: entityId,
            step: {id: logicalId, messageId},
        })
    }, [triggerTest, truncateChat, rowId, entityId, sessionId, msg, kind, deleteMsg, isToolKind])

    const resultHashes = useMemo(() => {
        try {
            const key = `${rowId}:${entityId}`
            const entry = (runStatusMap || {})[key]
            const h = entry?.resultHash
            return h ? [h] : []
        } catch {
            return []
        }
    }, [runStatusMap, rowId, entityId])

    const fullResult = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.fullResult({
                    rowId,
                    entityId,
                }),
            [rowId, entityId],
        ),
    )
    const results = useMemo(() => {
        if (propsResults) return propsResults
        if (!fullResult?.output) return []
        const output = fullResult.output
        return Array.isArray(output) ? output.filter(Boolean) : [output]
    }, [propsResults, fullResult])

    const footerContent = useMemo(
        () => (
            <>
                {hasAttachments && isUserRole && (
                    <MessageAttachments
                        content={msg!.content!}
                        onRemove={handleRemoveAttachment}
                        disabled={effectiveDisabled}
                    />
                )}
                {footer ? (
                    <div className={clsx(["flex flex-col mt-2 w-full", footerClassName])}>
                        {footer}
                    </div>
                ) : null}
            </>
        ),
        [
            footer,
            footerClassName,
            hasAttachments,
            isUserRole,
            msg,
            handleRemoveAttachment,
            effectiveDisabled,
        ],
    )

    const effectivePlaceholder = useMemo(() => {
        if (placeholder) return placeholder
        return kind === "user" ? "Type your message…" : "Enter tool call result here and hit run"
    }, [placeholder, kind])

    // TODO: IMPROVE THIS
    const isError = roleValue === "Error"
    const editorRole = roleValue ?? kind
    const editorState = isError ? "readOnly" : "filled"
    const toolCallId = msg?.tool_call_id
    const toolName = msg?.name

    const toolPayloads = useMemo(() => {
        if (kind !== "assistant") return []
        return createToolCallPayloads(msg?.tool_calls)
    }, [kind, msg])

    return toolPayloads?.length ? (
        toolPayloads.map((p) => (
            <div
                key={p.callId}
                className={clsx(
                    "w-full",
                    {
                        "[&_.agenta-editor-wrapper]:max-h-[calc(8px+calc(3*19.88px))] [&_.agenta-editor-wrapper]:overflow-y-auto [&_.agenta-editor-wrapper]:!mb-0":
                            isMessageCollapsed,
                        "[&_.agenta-editor-wrapper]:max-h-none": !isMessageCollapsed,
                    },
                    {
                        " [&_.message-user-select]:text-[red]": isError,
                    },
                    messageProps?.className,
                )}
            >
                <MessageEditor
                    id={editorIdRef.current}
                    role={editorRole}
                    isJSON={true}
                    isTool
                    text={p?.json}
                    enableTokens={false}
                    disabled={effectiveDisabled}
                    className={clsx([className])}
                    editorClassName={editorClassName}
                    headerClassName={clsx(headerClassName, "pt-1")}
                    placeholder={effectivePlaceholder}
                    onChangeRole={onChangeRole}
                    onChangeText={onChangeText}
                    state={"readOnly"}
                    headerBottom={
                        toolCallsView ? <ToolCallViewHeader className="mt-2" {...p} /> : null
                    }
                    headerRight={
                        <TurnMessageHeaderOptions
                            {...messageOptionProps}
                            id={editorIdRef.current}
                            messageId={msg?.id}
                            resultHashes={propsResultHashes ?? resultHashes}
                            results={results}
                            text={p?.json ?? editorText}
                            collapsed={isMessageCollapsed}
                            allowFileUpload={false}
                            repetitionProps={!isComparisonView ? repetitionProps : undefined}
                            onViewAllRepeats={() => openFocusDrawer({rowId: rowId, entityId})}
                            renderTestsetButton={renderTestsetButton}
                            renderRepetitionNav={renderRepetitionNav}
                            uploadCount={0}
                            documentCount={0}
                            actions={{
                                onRerun: isToolKind
                                    ? undefined
                                    : () =>
                                          propsHandleRerun
                                              ? propsHandleRerun({rowId, entityId})
                                              : handleRerun(),
                                onToggleCollapse: () => setIsMessageCollapsed((c) => !c),
                                onDelete: isToolKind ? undefined : deleteMessage,
                            }}
                        >
                            {isUserRole && !effectiveDisabled && (
                                <AttachmentButton
                                    onAddImage={handleAddImage}
                                    onAddFile={handleAddFile}
                                    disabled={effectiveDisabled}
                                />
                            )}
                            {headerRight}
                        </TurnMessageHeaderOptions>
                    }
                    footer={footerContent}
                    editorType={editorType}
                    {...messageProps}
                />
            </div>
        ))
    ) : msg ? (
        <div
            className={clsx(
                "w-full",
                {
                    "[&_.agenta-editor-wrapper]:h-[calc(8px+calc(3*19.88px))] [&_.agenta-editor-wrapper]:overflow-y-auto [&_.agenta-editor-wrapper]:!mb-0":
                        isMessageCollapsed,
                    "[&_.agenta-editor-wrapper]:h-fit": !isMessageCollapsed,
                },
                {
                    " [&_.message-user-select]:text-[red]": isError,
                },
                messageProps?.className,
            )}
        >
            <MessageEditor
                id={editorIdRef.current}
                key={`${editorIdRef.current}-${isJsonContent}`}
                role={editorRole}
                text={editorText}
                disabled={effectiveDisabled}
                className={clsx([className])}
                editorClassName={editorClassName}
                headerClassName={headerClassName}
                placeholder={effectivePlaceholder}
                onChangeRole={onChangeRole}
                onChangeText={onChangeText}
                state={editorState}
                isJSON={isJsonContent}
                enableTokens={messageProps?.enableTokens ?? !isJsonContent}
                headerRight={
                    <TurnMessageHeaderOptions
                        {...messageOptionProps}
                        id={editorIdRef.current}
                        messageId={msg?.id}
                        resultHashes={propsResultHashes ?? resultHashes}
                        results={results}
                        text={editorText}
                        collapsed={isMessageCollapsed}
                        allowFileUpload={false}
                        repetitionProps={!isComparisonView ? repetitionProps : undefined}
                        onViewAllRepeats={() => openFocusDrawer({rowId: rowId, entityId})}
                        renderTestsetButton={renderTestsetButton}
                        renderRepetitionNav={renderRepetitionNav}
                        uploadCount={0}
                        documentCount={0}
                        actions={{
                            onRerun: isToolKind
                                ? undefined
                                : () =>
                                      propsHandleRerun
                                          ? propsHandleRerun({rowId, entityId})
                                          : handleRerun(),
                            onToggleCollapse: () => setIsMessageCollapsed((c) => !c),
                            onDelete: isToolKind ? undefined : deleteMessage,
                        }}
                    >
                        {isUserRole && !effectiveDisabled && (
                            <AttachmentButton
                                onAddImage={handleAddImage}
                                onAddFile={handleAddFile}
                                disabled={effectiveDisabled}
                            />
                        )}
                        {headerRight}
                    </TurnMessageHeaderOptions>
                }
                headerBottom={
                    editorRole === "tool" && toolCallId ? (
                        <ToolCallViewHeader className="mt-1" callId={toolCallId} name={toolName} />
                    ) : null
                }
                footer={footerContent}
                editorType={editorType}
                {...messageProps}
            />
        </div>
    ) : null
}

export default TurnMessageAdapter
