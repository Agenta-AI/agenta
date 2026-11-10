import React, {ComponentProps, useCallback, useEffect, useMemo, useRef, useState} from "react"

import type {SimpleChatMessage} from "@agenta/playground"
import {getAttachments} from "@agenta/shared/utils"
import {message, modal} from "@agenta/ui"
import {
    ChatMessageEditor as MessageEditor,
    MessageAttachments,
    createSnippetPdfAttachment,
} from "@agenta/ui/chat-message"
import {
    getCollapseStyle,
    PromptImageUpload,
    PromptDocumentUpload,
} from "@agenta/ui/components/presentational"
import {messageViewModeAtom, toMessageViewMode} from "@agenta/ui/drill-in"
import clsx from "clsx"
import {useAtom, useSetAtom} from "jotai"
import {v4 as uuidv4} from "uuid"

import {useTurnMessage} from "../../hooks/useTurnMessage"
import {openPlaygroundFocusDrawerAtom} from "../../state/focusDrawer"
import {ToolCallViewHeader} from "../ToolCallView"
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
    const editorIdRef = useRef(uuidv4())
    const {
        message: msg,
        role: roleValue,
        isError,
        editorText,
        hasBeenRun,
        isComparisonView,
        toolPayloads,
        resultHashes,
        results: storedResults,
        onChangeText,
        onChangeRole,
        rerun: handleRerun,
        remove: deleteMessage,
        uploadSlots,
        imageSlotCount,
        documentSlotCount,
        addUploadSlot,
        setSlotImage: handleUploadFileChange,
        setSlotDocument: handleDocumentFileChange,
        removeSlot: handleRemoveUploadSlot,
        addFile: handleAddFileAttachment,
        listedAttachments,
        removeListedAttachment: handleRemoveAttachment,
    } = useTurnMessage({
        entityId,
        rowId,
        kind,
        toolIndex,
        messageOverride: messageOverride ? (messageOverride as SimpleChatMessage) : undefined,
    })
    const {
        footerClassName,
        onPasteLimitExceeded: messageOnPasteLimitExceeded,
        ...messageProps
    } = (_messageProps || {}) as AdapterMessageProps
    const [isMessageCollapsed, setIsMessageCollapsed] = useState(false)
    const autoMinimizedRef = useRef(false)
    const isToolKind = kind === "tool"

    const editorCollapseStyle = getCollapseStyle(isMessageCollapsed)

    const handleEditorFocusChange = useCallback(
        (focused: boolean) => {
            if (focused && isMessageCollapsed) {
                setIsMessageCollapsed(false)
            }
        },
        [isMessageCollapsed],
    )

    // Shared + persisted across all message editors (see messageViewModeAtom).
    // The atom is typed `ViewMode` (can hold "form"), so coerce to a mode this
    // editor can actually render before deriving any mode-dependent state.
    const [viewMode, setViewMode] = useAtom(messageViewModeAtom)
    const chatViewMode = toMessageViewMode(viewMode)
    const isCodeMode = chatViewMode === "json" || chatViewMode === "yaml"
    const editorLanguage = chatViewMode === "yaml" ? "yaml" : "json"

    const effectiveDisabled = Boolean(disabled)
    const isUserRole = kind === "user" && !isToolKind

    const hasListedAttachments = getAttachments(listedAttachments).length > 0

    const handleAddUploadSlot = useCallback(() => addUploadSlot("image"), [addUploadSlot])
    const handleAddDocumentSlot = useCallback(() => addUploadSlot("document"), [addUploadSlot])

    const handleAddSnippetAttachment = useCallback(
        async (pastedText: string) => {
            const {fileData, filename, mimeType} = await createSnippetPdfAttachment(pastedText)
            handleAddFileAttachment(fileData, filename, mimeType)
            message?.success(`Attached ${filename} as a snippet.`)
        },
        [handleAddFileAttachment],
    )

    const defaultOnPasteLimitExceeded = useCallback(
        ({
            pastedText,
            maxPasteChars,
            overBy,
        }: {
            pastedText: string
            maxPasteChars: number
            overBy: number
        }) => {
            if (!isUserRole || effectiveDisabled || !modal) {
                return false
            }

            const limitSummary =
                overBy > 0
                    ? `This paste is ${overBy.toLocaleString()} characters over the ${maxPasteChars.toLocaleString()}-character limit.`
                    : `This paste exceeds the ${maxPasteChars.toLocaleString()}-character limit.`

            modal.confirm({
                title: "That's too long to paste",
                content: `${limitSummary} To keep the editor responsive, you can attach the pasted content as a snippet instead.`,
                okText: "Create Snippet",
                cancelText: "Dismiss",
                centered: true,
                onOk: async () => {
                    try {
                        await handleAddSnippetAttachment(pastedText)
                    } catch (error) {
                        message?.error(
                            error instanceof Error
                                ? error.message
                                : "Failed to create snippet attachment.",
                        )
                        throw error
                    }
                },
            })

            return true
        },
        [effectiveDisabled, handleAddSnippetAttachment, isUserRole],
    )

    const onPasteLimitExceeded =
        messageOnPasteLimitExceeded ??
        (isUserRole && !effectiveDisabled ? defaultOnPasteLimitExceeded : undefined)

    const results = propsResults ?? storedResults

    const footerContent = useMemo(
        () => (
            <>
                {hasListedAttachments && isUserRole && (
                    <MessageAttachments
                        content={listedAttachments}
                        onRemove={handleRemoveAttachment}
                        disabled={effectiveDisabled}
                    />
                )}
                {isUserRole &&
                    uploadSlots.map((slot) =>
                        slot.type === "image" ? (
                            <PromptImageUpload
                                key={slot.id}
                                disabled={effectiveDisabled}
                                imageFile={slot.file}
                                handleUploadFileChange={(file) =>
                                    handleUploadFileChange(slot.id, file)
                                }
                                handleRemoveUploadFile={() => handleRemoveUploadSlot(slot.id)}
                            />
                        ) : (
                            <PromptDocumentUpload
                                key={slot.id}
                                disabled={effectiveDisabled}
                                value={slot.value}
                                onFileChange={(fileData, filename, format) =>
                                    handleDocumentFileChange(slot.id, fileData, filename, format)
                                }
                                onRemove={() => handleRemoveUploadSlot(slot.id)}
                            />
                        ),
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
            hasListedAttachments,
            isUserRole,
            listedAttachments,
            handleRemoveAttachment,
            effectiveDisabled,
            uploadSlots,
            handleUploadFileChange,
            handleDocumentFileChange,
            handleRemoveUploadSlot,
        ],
    )

    const effectivePlaceholder = useMemo(() => {
        if (placeholder) return placeholder
        return kind === "user" ? "Type your message…" : "Enter tool call result here and hit run"
    }, [placeholder, kind])

    const editorRole = roleValue ?? kind
    const editorState = isError ? "readOnly" : "filled"
    const toolCallId = msg?.tool_call_id
    const toolName = msg?.name

    const msgId = msg?.id
    useEffect(() => {
        // Auto-collapse generated tool/assistant-with-tool-calls messages.
        // We use autoMinimizedRef so a message is only auto-collapsed ONCE
        // to not override explicit user interactions to open it later.
        if (autoMinimizedRef.current) return

        // 1. If it's an Assistant message that has generated tool_calls payload
        const isAssistantWithTools = kind === "assistant" && toolPayloads.length > 0

        // 2. If it's a generated Tool response message and it has actual content
        const hasTextContent = Boolean(
            msg?.content && (typeof msg.content !== "string" || msg.content.length > 0),
        )
        const isGeneratedToolOutput = isToolKind && hasTextContent

        const readyToCollapse = isAssistantWithTools || isGeneratedToolOutput

        if (!readyToCollapse) return

        setIsMessageCollapsed(true)
        autoMinimizedRef.current = true

        // Observe msg?.content so streaming/delayed text updates re-trigger the collapse check
    }, [msgId, kind, isToolKind, toolPayloads.length, msg?.content])

    return (
        <>
            {toolPayloads?.length ? (
                toolPayloads.map((p) => (
                    <div
                        key={p.callId}
                        style={editorCollapseStyle}
                        className={clsx(
                            "w-full",
                            {
                                " [&_.message-user-select]:text-[red]": isError,
                            },
                            messageProps?.className,
                        )}
                    >
                        <MessageEditor
                            id={`${editorIdRef.current}-${p.callId}`}
                            key={`${editorIdRef.current}-${viewMode}-${p.callId}`}
                            role={editorRole}
                            isJSON={isCodeMode}
                            isTool={isCodeMode}
                            language={editorLanguage}
                            markdownView={chatViewMode === "text"}
                            onFocusChange={handleEditorFocusChange}
                            text={p?.json}
                            enableTokens={messageProps?.enableTokens ?? !isCodeMode}
                            disabled={effectiveDisabled}
                            className={clsx([className])}
                            editorClassName={editorClassName}
                            headerClassName={clsx(headerClassName, "pt-1")}
                            placeholder={effectivePlaceholder}
                            onChangeRole={onChangeRole}
                            onChangeText={onChangeText}
                            state={"readOnly"}
                            headerBottom={
                                p.name || p.callId ? (
                                    <ToolCallViewHeader
                                        className="mt-2"
                                        name={p.name}
                                        callId={p.callId}
                                    />
                                ) : null
                            }
                            headerRight={
                                <TurnMessageHeaderOptions
                                    {...messageOptionProps}
                                    id={`${editorIdRef.current}-${p.callId}`}
                                    messageId={msg?.id}
                                    disabled={kind === "user" && !hasBeenRun}
                                    resultHashes={propsResultHashes ?? resultHashes}
                                    results={results}
                                    text={p?.json ?? editorText}
                                    viewMode={chatViewMode}
                                    onViewModeChange={setViewMode}
                                    collapsed={isMessageCollapsed}
                                    allowFileUpload={isUserRole && !effectiveDisabled}
                                    repetitionProps={
                                        !isComparisonView ? repetitionProps : undefined
                                    }
                                    onViewAllRepeats={() =>
                                        openFocusDrawer({rowId: rowId, entityId})
                                    }
                                    renderTestsetButton={renderTestsetButton}
                                    renderRepetitionNav={renderRepetitionNav}
                                    uploadCount={imageSlotCount}
                                    documentCount={documentSlotCount}
                                    actions={{
                                        onRerun: isToolKind
                                            ? undefined
                                            : () =>
                                                  propsHandleRerun
                                                      ? propsHandleRerun({rowId, entityId})
                                                      : handleRerun(),
                                        onToggleCollapse: () => setIsMessageCollapsed((c) => !c),
                                        onDelete: deleteMessage,
                                        onAddUploadSlot: handleAddUploadSlot,
                                        onAddDocumentSlot: handleAddDocumentSlot,
                                    }}
                                >
                                    {headerRight}
                                </TurnMessageHeaderOptions>
                            }
                            footer={footerContent}
                            editorType={editorType}
                            onPasteLimitExceeded={onPasteLimitExceeded}
                            {...messageProps}
                        />
                    </div>
                ))
            ) : msg ? (
                <div
                    style={editorCollapseStyle}
                    className={clsx(
                        "w-full",
                        {
                            " [&_.message-user-select]:text-[red]": isError,
                        },
                        messageProps?.className,
                    )}
                >
                    <MessageEditor
                        id={editorIdRef.current}
                        key={`${editorIdRef.current}-${viewMode}`}
                        role={editorRole}
                        text={editorText}
                        disabled={effectiveDisabled}
                        onFocusChange={handleEditorFocusChange}
                        className={clsx([className])}
                        editorClassName={editorClassName}
                        headerClassName={headerClassName}
                        placeholder={effectivePlaceholder}
                        onChangeRole={onChangeRole}
                        onChangeText={onChangeText}
                        state={editorState}
                        isJSON={isCodeMode}
                        language={editorLanguage}
                        markdownView={chatViewMode === "text"}
                        enableTokens={messageProps?.enableTokens ?? !isCodeMode}
                        headerRight={
                            <TurnMessageHeaderOptions
                                {...messageOptionProps}
                                id={editorIdRef.current}
                                messageId={msg?.id}
                                disabled={kind === "user" && !hasBeenRun}
                                resultHashes={propsResultHashes ?? resultHashes}
                                results={results}
                                text={editorText}
                                viewMode={chatViewMode}
                                onViewModeChange={setViewMode}
                                collapsed={isMessageCollapsed}
                                allowFileUpload={isUserRole && !effectiveDisabled}
                                repetitionProps={!isComparisonView ? repetitionProps : undefined}
                                onViewAllRepeats={() => openFocusDrawer({rowId: rowId, entityId})}
                                renderTestsetButton={renderTestsetButton}
                                renderRepetitionNav={renderRepetitionNav}
                                uploadCount={imageSlotCount}
                                documentCount={documentSlotCount}
                                actions={{
                                    onRerun: isToolKind
                                        ? undefined
                                        : () =>
                                              propsHandleRerun
                                                  ? propsHandleRerun({rowId, entityId})
                                                  : handleRerun(),
                                    onToggleCollapse: () => setIsMessageCollapsed((c) => !c),
                                    onDelete: deleteMessage,
                                    onAddUploadSlot: handleAddUploadSlot,
                                    onAddDocumentSlot: handleAddDocumentSlot,
                                }}
                            >
                                {headerRight}
                            </TurnMessageHeaderOptions>
                        }
                        headerBottom={
                            editorRole === "tool" && toolCallId ? (
                                <ToolCallViewHeader
                                    className="mt-1"
                                    callId={toolCallId}
                                    name={toolName}
                                />
                            ) : null
                        }
                        footer={footerContent}
                        editorType={editorType}
                        onPasteLimitExceeded={onPasteLimitExceeded}
                        {...messageProps}
                    />
                </div>
            ) : null}
        </>
    )
}

export default TurnMessageAdapter
