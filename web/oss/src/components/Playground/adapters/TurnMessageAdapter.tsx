import React, {ComponentProps, useCallback, useEffect, useMemo, useRef, useState} from "react"

import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import JSON5 from "json5"
import {v4 as uuidv4} from "uuid"

import TurnMessageHeaderOptions from "@/oss/components/Playground/adapters/TurnMessageHeaderOptions"
import MessageEditor from "@/oss/components/Playground/Components/ChatCommon/MessageEditor"
import MessageDocumentList from "@/oss/components/Playground/Components/Shared/MessageDocumentList"
import MessageImageList from "@/oss/components/Playground/Components/Shared/MessageImageList"
import {useMessageContentHandlers} from "@/oss/components/Playground/hooks/useMessageContentHandlers"
import {useMessageContentProps} from "@/oss/components/Playground/hooks/useMessageContentProps"
import {findPropertyInObject} from "@/oss/components/Playground/hooks/usePlayground/assets/helpers"
import {isComparisonViewAtom} from "@/oss/components/Playground/state/atoms"
import {chatTurnsByIdFamilyAtom, runStatusByRowRevisionAtom} from "@/oss/state/generation/entities"
import {runChatTurnAtom} from "@/oss/state/newPlayground/chat/actions"
import {responseByRowRevisionAtomFamily} from "@/oss/state/newPlayground/generation/runtime"
import {openPlaygroundFocusDrawerAtom} from "@/oss/state/playgroundFocusDrawerAtom"

import {createToolCallPayloads, ToolCallViewHeader} from "../Components/ToolCallView"

interface Props {
    variantId: string
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
    messageOverride?: any
    isJSON?: boolean
    isTool?: boolean
    messageProps?: any
    editorType?: string
    handleRerun?: (args: any) => void
    resultHashes?: string[]
    repetitionProps?: any
    hideRerun?: boolean
    hideExpandResults?: boolean
}

const TurnMessageAdapter: React.FC<Props> = ({
    variantId,
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
    messageProps,
    editorType,
    handleRerun: propsHandleRerun,
    resultHashes: propsResultHashes,
    toolIndex = 0,
    messageOverride,
    repetitionProps,
    hideRerun,
    hideExpandResults,
}) => {
    const openFocusDrawer = useSetAtom(openPlaygroundFocusDrawerAtom)
    const isComparisonView = useAtomValue(isComparisonViewAtom)
    const editorIdRef = useRef(uuidv4())
    const turn = useAtomValue(chatTurnsByIdFamilyAtom(rowId)) as any
    const setTurn = useSetAtom(chatTurnsByIdFamilyAtom(rowId))
    const setResponse = useSetAtom(
        useMemo(
            () => responseByRowRevisionAtomFamily({rowId, revisionId: variantId}),
            [rowId, variantId],
        ),
    )
    const [minimized, setMinimized] = useState(() => kind === "tool")
    const autoMinimizedRef = useRef(false)
    const isToolKind = kind === "tool"
    const toolMessage = useMemo(() => {
        if (!turn) return null
        const messages = turn?.toolResponsesByRevision?.[variantId]
        if (!Array.isArray(messages)) return null
        return messages[toolIndex] || null
    }, [turn, variantId, toolIndex])
    const msg = useMemo(() => {
        if (messageOverride) return messageOverride
        const t = turn
        if (kind === "assistant") {
            const m = t?.assistantMessageByRevision?.[variantId] || null
            return m
        }
        if (kind === "tool") return toolMessage
        return t?.userMessage || null
    }, [turn, variantId, kind, toolMessage, messageOverride])

    const {baseImageProperties, baseFileProperties, baseRoleProperty, computedText} =
        useMessageContentProps(msg as any)

    const {editorText, isJsonContent} = useMemo(() => {
        const fallback = typeof computedText === "string" ? computedText : ""
        const candidates: string[] = []
        const rawContent = (msg as any)?.content

        if (typeof rawContent === "string") {
            candidates.push(rawContent)
        } else if (rawContent && typeof rawContent === "object") {
            const value = (rawContent as any).value
            if (typeof value === "string") candidates.push(value)
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

    const {addUploadSlot, updateTextContent, removeUploadItem} = useMessageContentHandlers()
    const effectiveDisabled = Boolean(disabled)

    // Shared helper to get and assign the current target message node (user/assistant)
    const getTarget = useCallback(
        (draft: any) => {
            if (!draft.assistantMessageByRevision) draft.assistantMessageByRevision = {}
            if (isToolKind) {
                if (!draft.toolResponsesByRevision) draft.toolResponsesByRevision = {}
                const list: any[] = Array.isArray(draft.toolResponsesByRevision[variantId])
                    ? [...draft.toolResponsesByRevision[variantId]]
                    : []
                const target = list[toolIndex] || null
                const assign = (updated: any) => {
                    const nextList = Array.isArray(draft.toolResponsesByRevision[variantId])
                        ? [...draft.toolResponsesByRevision[variantId]]
                        : []
                    nextList[toolIndex] = updated
                    draft.toolResponsesByRevision[variantId] = nextList.filter((m) => m != null)
                }
                return {target, assign}
            }
            const target =
                kind === "assistant"
                    ? draft.assistantMessageByRevision?.[variantId]
                    : draft.userMessage
            const assign = (updated: any) => {
                if (kind === "assistant") draft.assistantMessageByRevision[variantId] = updated
                else draft.userMessage = updated
            }
            return {target, assign}
        },
        [kind, variantId, isToolKind, toolIndex],
    )

    const deleteMessage = useCallback(() => {
        if (isToolKind) {
            setTurn((draft: any) => {
                if (!draft) return
                const {assign} = getTarget(draft)
                assign(null)
            })
            return
        }
        const msgId = (msg as any)?.__id
        if (!msgId) return
        setTurn((draft: any) => {
            if (!draft) return
            if (kind === "assistant") {
                const cur = draft?.assistantMessageByRevision?.[variantId]
                // When messageOverride is used (e.g., from result/error), the __id won't match
                // the stored message. In that case, delete if there's any assistant message.
                if (messageOverride) {
                    draft.assistantMessageByRevision[variantId] = null
                } else if (cur && cur.__id === msgId) {
                    draft.assistantMessageByRevision[variantId] = null
                }
            } else {
                if (draft.userMessage && draft.userMessage.__id === msgId) {
                    draft.userMessage = null
                }
            }
        })
        // Also clear the response that generates the messageOverride
        if (kind === "assistant" && messageOverride) {
            setResponse(null)
        }
    }, [setTurn, kind, variantId, msg, isToolKind, messageOverride, setResponse, getTarget])

    const onChangeRole = useCallback(
        (v: string) => {
            if (isToolKind) return
            if (!msg) return
            setTurn((draft: any) => {
                const {target, assign} = getTarget(draft)
                if (!target || !target.role || typeof target.role !== "object") return
                const updated = {...target, role: {...target.role, value: v}}
                assign(updated)
            })
        },
        [msg, getTarget, setTurn, isToolKind],
    )

    const onChangeText = useCallback(
        (v: string) => {
            setTurn((draft: any) => {
                const {target, assign} = getTarget(draft)
                if (!target) return
                const fallbackId = `content-${rowId}-${kind}`
                const content = updateTextContent(target.content as any, v, fallbackId)
                assign({...target, content})
            })
        },
        [getTarget, rowId, kind, updateTextContent, setTurn],
    )

    const onAddUploadSlot = useCallback(() => {
        if (isToolKind) return
        setTurn((draft: any) => {
            if (!draft) return
            const {target, assign} = getTarget(draft)
            if (!target) return
            const result = addUploadSlot({contentProperty: target.content as any, max: 5})
            if (!result) return
            const content = target.content || {__id: `content-${rowId}-${kind}`, value: []}
            assign({...target, content: {...content, value: result}})
        })
    }, [addUploadSlot, setTurn, getTarget, rowId, kind, isToolKind])

    const onAddDocumentSlot = useCallback(() => {
        if (isToolKind) return
        setTurn((draft: any) => {
            if (!draft) return
            const {target, assign} = getTarget(draft)
            if (!target) return
            const result = addUploadSlot({
                contentProperty: target.content as any,
                max: 5,
                attachmentType: "file",
            })
            if (!result) return
            const content = target.content || {__id: `content-${rowId}-${kind}`, value: []}
            assign({...target, content: {...content, value: result}})
        })
    }, [addUploadSlot, setTurn, getTarget, rowId, kind, isToolKind])

    const onRemoveUploadItem = useCallback(
        (propertyId: string) => {
            if (isToolKind) return
            setTurn((draft: any) => {
                if (!draft) return
                const {target, assign} = getTarget(draft)
                if (!target || !target.content) return
                const next = removeUploadItem({contentProperty: target.content as any, propertyId})
                if (!next) return
                assign({...target, content: {...target.content, value: next}})
            })
        },
        [setTurn, getTarget, removeUploadItem, isToolKind],
    )

    const onChangeUploadItem = useCallback(
        (propertyId: string, value: string) => {
            if (isToolKind) return
            setTurn((draft: any) => {
                if (!draft) return
                const {target, assign} = getTarget(draft)
                if (!target || !target.content) return
                const content = target.content as any
                const parts = Array.isArray(content.value) ? (content.value as any[]) : []
                const idx = parts.findIndex((part: any) =>
                    Boolean(findPropertyInObject(part, propertyId)),
                )
                if (idx < 0) return
                const targetPart = parts[idx]
                const urlProp = findPropertyInObject(targetPart, propertyId) as any
                if (!urlProp) return
                if (urlProp?.content && typeof urlProp.content === "object")
                    urlProp.content.value = value
                else urlProp.value = value
                assign({...target, content})
            })
        },
        [setTurn, getTarget, isToolKind],
    )

    // writes flow through chatTurnsByIdFamilyAtom setter; no external mutation atoms needed

    const rerun = useSetAtom(runChatTurnAtom)
    const runStatusMap = useAtomValue(runStatusByRowRevisionAtom) as Record<string, any>

    const handleRerun = useCallback(() => {
        if (isToolKind) return
        const logicalId = String(rowId)
        const messageId = (msg as any)?.__id as string | undefined
        // 1) Clear response cache FIRST to prevent stale data display
        setResponse(null)
        // 2) prune message and tool responses if applicable
        setTurn((draft: any) => {
            if (!draft) return
            if (!draft.assistantMessageByRevision) draft.assistantMessageByRevision = {}
            if (kind === "assistant" && messageId) {
                const cur = draft.assistantMessageByRevision?.[variantId]
                if (cur && cur.__id === messageId)
                    draft.assistantMessageByRevision[variantId] = null
            } else if (kind === "user") {
                // Rerunning a user message should clear any assistant response on this row/revision
                draft.assistantMessageByRevision[variantId] = null
            }
            // Clear tool responses for this revision
            if (draft.toolResponsesByRevision && variantId in draft.toolResponsesByRevision) {
                delete draft.toolResponsesByRevision[variantId]
                // Clean up empty object
                if (Object.keys(draft.toolResponsesByRevision).length === 0) {
                    delete draft.toolResponsesByRevision
                }
            }
        })
        // 3) Trigger rerun
        rerun({turnId: logicalId, variantId, messageId})
    }, [rerun, rowId, variantId, msg, kind, setTurn, setResponse, isToolKind])

    const resultHashes = useMemo(() => {
        try {
            const key = `${rowId}:${variantId}`
            const entry = (runStatusMap || {})[key]
            const h = entry?.resultHash
            return h ? [h] : []
        } catch {
            return []
        }
    }, [runStatusMap, rowId, variantId])

    const footerContent = useMemo(
        () =>
            baseImageProperties.length > 0 || baseFileProperties.length > 0 || footer ? (
                <div className={clsx(["flex flex-col mt-2 w-full", messageProps?.footerClassName])}>
                    <div className="flex flex-col gap-2 w-full">
                        {Array.isArray(baseImageProperties) && baseImageProperties.length > 0 && (
                            <MessageImageList
                                properties={baseImageProperties as any[]}
                                disabled={effectiveDisabled}
                                onRemove={onRemoveUploadItem}
                                onChange={onChangeUploadItem}
                            />
                        )}
                        {Array.isArray(baseFileProperties) && baseFileProperties.length > 0 && (
                            <MessageDocumentList
                                items={baseFileProperties as any[]}
                                disabled={effectiveDisabled}
                                onRemove={onRemoveUploadItem}
                                onChange={onChangeUploadItem}
                            />
                        )}
                    </div>

                    {footer}
                </div>
            ) : null,
        [
            baseImageProperties,
            baseFileProperties,
            effectiveDisabled,
            onRemoveUploadItem,
            onChangeUploadItem,
            footer,
        ],
    )

    const effectivePlaceholder = useMemo(() => {
        if (placeholder) return placeholder
        return kind === "user" ? "Type your message…" : "Enter tool call result here and hit run"
    }, [placeholder, kind])

    // TODO: IMPROVE THIS
    const isError = baseRoleProperty?.value === "Error"
    const editorState = isError ? "readOnly" : "filled"

    const toolPayloads = useMemo(() => {
        if (kind !== "assistant") return []
        return createToolCallPayloads(msg?.toolCalls?.value)
    }, [kind, msg])

    useEffect(() => {
        const shouldAutoMinimize = isToolKind || (kind === "assistant" && toolPayloads.length > 0)
        if (!shouldAutoMinimize || autoMinimizedRef.current) return
        setMinimized(true)
        autoMinimizedRef.current = true
    }, [isToolKind, kind, toolPayloads.length])

    return toolPayloads?.length ? (
        toolPayloads.map((p) => (
            <div
                key={p.callId}
                className={clsx(
                    "w-full",
                    {
                        "[&_.agenta-editor-wrapper]:h-[calc(8px+calc(3*19.88px))] [&_.agenta-editor-wrapper]:overflow-y-auto [&_.agenta-editor-wrapper]:!mb-0":
                            minimized,
                        "[&_.agenta-editor-wrapper]:h-fit": !minimized,
                    },
                    {
                        " [&_.message-user-select]:text-[red]": isError,
                    },
                    messageProps?.className,
                )}
            >
                <MessageEditor
                    id={editorIdRef.current}
                    role={baseRoleProperty?.value}
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
                        p.name || p.callId ? (
                            <ToolCallViewHeader className="mt-2" name={p.name} callId={p.callId} />
                        ) : null
                    }
                    headerRight={
                        <TurnMessageHeaderOptions
                            {...messageOptionProps}
                            id={editorIdRef.current}
                            messageId={(msg as any)?.__id}
                            resultHashes={propsResultHashes ?? resultHashes}
                            text={p?.json ?? editorText}
                            minimized={minimized}
                            allowFileUpload={baseRoleProperty?.value === "user" && !isToolKind}
                            repetitionProps={!isComparisonView ? repetitionProps : undefined}
                            onViewAllRepeats={
                                hideExpandResults
                                    ? undefined
                                    : () => openFocusDrawer({rowId: rowId, variantId})
                            }
                            uploadCount={
                                Array.isArray(baseImageProperties) ? baseImageProperties.length : 0
                            }
                            documentCount={
                                Array.isArray(baseFileProperties) ? baseFileProperties.length : 0
                            }
                            actions={{
                                onAddUploadSlot:
                                    isToolKind || messageOptionProps?.allowFileUpload === false
                                        ? undefined
                                        : onAddUploadSlot,
                                onAddDocumentSlot:
                                    isToolKind || messageOptionProps?.allowFileUpload === false
                                        ? undefined
                                        : onAddDocumentSlot,
                                onRerun:
                                    isToolKind || hideRerun
                                        ? undefined
                                        : (propsHandleRerun ?? handleRerun),
                                onMinimize: () => setMinimized((c) => !c),
                                onDelete: deleteMessage,
                            }}
                        >
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
                        minimized,
                    "[&_.agenta-editor-wrapper]:h-fit": !minimized,
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
                role={baseRoleProperty?.value}
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
                        messageId={(msg as any)?.__id}
                        resultHashes={propsResultHashes ?? resultHashes}
                        text={editorText}
                        minimized={minimized}
                        allowFileUpload={baseRoleProperty?.value === "user" && !isToolKind}
                        repetitionProps={!isComparisonView ? repetitionProps : undefined}
                        onViewAllRepeats={
                            hideExpandResults
                                ? undefined
                                : () => openFocusDrawer({rowId: rowId, variantId})
                        }
                        uploadCount={
                            Array.isArray(baseImageProperties) ? baseImageProperties.length : 0
                        }
                        documentCount={
                            Array.isArray(baseFileProperties) ? baseFileProperties.length : 0
                        }
                        actions={{
                            onAddUploadSlot:
                                isToolKind || messageOptionProps?.allowFileUpload === false
                                    ? undefined
                                    : onAddUploadSlot,
                            onAddDocumentSlot:
                                isToolKind || messageOptionProps?.allowFileUpload === false
                                    ? undefined
                                    : onAddDocumentSlot,
                            onRerun:
                                isToolKind || hideRerun
                                    ? undefined
                                    : (propsHandleRerun ?? handleRerun),
                            onMinimize: () => setMinimized((c) => !c),
                            onDelete: deleteMessage,
                        }}
                    >
                        {headerRight}
                    </TurnMessageHeaderOptions>
                }
                headerBottom={
                    baseRoleProperty?.value === "tool" && msg?.toolCallId?.value ? (
                        <ToolCallViewHeader
                            className="mt-1"
                            callId={msg.toolCallId.value}
                            name={msg.name.value}
                        />
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
