import React, {ComponentProps, useCallback, useMemo, useRef, useState} from "react"

import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import {v4 as uuidv4} from "uuid"

import TurnMessageHeaderOptions from "@/oss/components/Playground/adapters/TurnMessageHeaderOptions"
import MessageEditor from "@/oss/components/Playground/Components/ChatCommon/MessageEditor"
import MessageImageList from "@/oss/components/Playground/Components/Shared/MessageImageList"
import {useMessageContentHandlers} from "@/oss/components/Playground/hooks/useMessageContentHandlers"
import {useMessageContentProps} from "@/oss/components/Playground/hooks/useMessageContentProps"
import {findPropertyInObject} from "@/oss/components/Playground/hooks/usePlayground/assets/helpers"
import {chatTurnsByIdFamilyAtom, runStatusByRowRevisionAtom} from "@/oss/state/generation/entities"
import {runChatTurnAtom} from "@/oss/state/newPlayground/chat/actions"

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
}) => {
    const editorIdRef = useRef(uuidv4())
    const turn = useAtomValue(chatTurnsByIdFamilyAtom(rowId)) as any
    const setTurn = useSetAtom(chatTurnsByIdFamilyAtom(rowId))
    const [minimized, setMinimized] = useState(false)
    const isToolKind = kind === "tool"
    const toolMessage = useMemo(() => {
        if (!turn) return null
        const messages = turn?.toolResponsesByRevision?.[variantId]
        if (!Array.isArray(messages)) return null
        return messages[toolIndex] || null
    }, [turn, variantId, toolIndex])
    const msg = useMemo(() => {
        const t = turn
        if (!t) return null
        if (kind === "assistant") return t?.assistantMessageByRevision?.[variantId] || null
        if (kind === "tool") return toolMessage
        return t?.userMessage || null
    }, [turn, variantId, kind, toolMessage])

    const {baseImageProperties, baseRoleProperty, computedText} = useMessageContentProps(msg as any)
    const text = computedText

    const {addUploadSlot, updateTextContent, removeUploadItem} = useMessageContentHandlers()
    const effectiveDisabled = disabled || isToolKind

    const deleteMessage = useCallback(() => {
        if (isToolKind) return
        const msgId = (msg as any)?.__id
        if (!msgId) return
        setTurn((draft: any) => {
            if (!draft) return
            if (kind === "assistant") {
                const cur = draft?.assistantMessageByRevision?.[variantId]
                if (cur && cur.__id === msgId) {
                    draft.assistantMessageByRevision[variantId] = null
                }
            } else {
                if (draft.userMessage && draft.userMessage.__id === msgId) {
                    draft.userMessage = null
                }
            }
        })
    }, [setTurn, kind, variantId, msg, rowId, turn, isToolKind])

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
        [kind, variantId, isToolKind, toolMessage],
    )

    const onChangeRole = useCallback(
        (v: string) => {
            if (isToolKind) return
            if (!turn || !msg) return
            setTurn((draft: any) => {
                const {target, assign} = getTarget(draft)
                if (!target || !target.role || typeof target.role !== "object") return
                const updated = {...target, role: {...target.role, value: v}}
                assign(updated)
            })
        },
        [turn, msg, getTarget, setTurn, isToolKind],
    )

    const onChangeText = useCallback(
        (v: string) => {
            // if (isToolKind) return
            setTurn((draft: any) => {
                const {target, assign} = getTarget(draft)
                if (!target) return
                const fallbackId = `content-${rowId}-${kind}`
                const content = updateTextContent(target.content as any, v, fallbackId)
                assign({...target, content})
            })
        },
        [getTarget, rowId, updateTextContent, setTurn, isToolKind],
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
    }, [addUploadSlot, setTurn, getTarget, rowId, isToolKind])

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
        (propertyId: string, url: string) => {
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
                    urlProp.content.value = url
                else urlProp.value = url
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
        // 1) prune message if applicable
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
        })
        rerun({turnId: logicalId, variantId, messageId})
    }, [rerun, rowId, variantId, msg, kind, setTurn, isToolKind])

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
            baseImageProperties.length > 0 || footer ? (
                <div
                    className={clsx([
                        "flex items-center mt-2 w-full",
                        messageProps?.footerClassName,
                    ])}
                >
                    {Array.isArray(baseImageProperties) && baseImageProperties.length > 0 && (
                        <MessageImageList
                            properties={baseImageProperties as any[]}
                            disabled={effectiveDisabled}
                            onRemove={onRemoveUploadItem}
                            onChange={onChangeUploadItem}
                        />
                    )}
                    {footer}
                </div>
            ) : null,
        [baseImageProperties, effectiveDisabled, onRemoveUploadItem, footer],
    )

    const effectivePlaceholder = useMemo(() => {
        if (placeholder) return placeholder
        return kind === "user"
            ? "Type your message…"
            : "Assistant response will appear here after run."
    }, [placeholder, kind])

    // TODO: IMPROVE THIS
    const isError = baseRoleProperty?.value === "Error"
    const editorState = isError ? "readOnly" : "filled"

    const toolPayloads = useMemo(() => {
        if (kind !== "assistant") return []
        return createToolCallPayloads(msg?.toolCalls?.value)
    }, [kind, msg])

    // return msg ? (

    // ) : null

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
                            messageId={(msg as any)?.__id}
                            resultHashes={propsResultHashes ?? resultHashes}
                            text={text}
                            minimized={minimized}
                            allowFileUpload={baseRoleProperty?.value === "user" && !isToolKind}
                            uploadCount={
                                Array.isArray(baseImageProperties) ? baseImageProperties.length : 0
                            }
                            actions={{
                                onAddUploadSlot: isToolKind ? undefined : onAddUploadSlot,
                                onRerun: isToolKind ? undefined : (propsHandleRerun ?? handleRerun),
                                onMinimize: () => setMinimized((c) => !c),
                                onDelete: isToolKind ? undefined : deleteMessage,
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
                role={baseRoleProperty?.value}
                text={text}
                disabled={false}
                className={clsx([className])}
                editorClassName={editorClassName}
                headerClassName={headerClassName}
                placeholder={effectivePlaceholder}
                onChangeRole={onChangeRole}
                onChangeText={onChangeText}
                state={editorState}
                headerRight={
                    <TurnMessageHeaderOptions
                        {...messageOptionProps}
                        id={editorIdRef.current}
                        messageId={(msg as any)?.__id}
                        resultHashes={propsResultHashes ?? resultHashes}
                        text={text}
                        minimized={minimized}
                        allowFileUpload={baseRoleProperty?.value === "user" && !isToolKind}
                        uploadCount={
                            Array.isArray(baseImageProperties) ? baseImageProperties.length : 0
                        }
                        actions={{
                            onAddUploadSlot: isToolKind ? undefined : onAddUploadSlot,
                            onRerun: isToolKind ? undefined : (propsHandleRerun ?? handleRerun),
                            onMinimize: () => setMinimized((c) => !c),
                            onDelete: isToolKind ? undefined : deleteMessage,
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
