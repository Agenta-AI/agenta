import {
    memo,
    useCallback,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react"

import type {SimpleChatMessage} from "@agenta/playground"
import {ChatMessageEditor} from "@agenta/ui/chat-message"
import {
    getViewOptions,
    messageViewModeAtom,
    toMessageViewMode,
    ViewModeDropdown,
} from "@agenta/ui/drill-in"
import {cn} from "@agenta/ui/ui"
import {useAtom} from "jotai"
import {v4 as uuidv4} from "uuid"

import {useTurnMessage, type TurnMessageKind} from "../../hooks/useTurnMessage"
import {ToolCallViewHeader} from "../shared/ToolCallView"

import {MessageAttachmentSlots} from "./MessageAttachmentSlots"
import {MessageToolbar} from "./MessageToolbar"
import {PasteLimitDialog, type PasteOverLimit} from "./PasteLimitDialog"

export interface ChatMessageProps {
    entityId: string
    /** The session turn id (`turn-<rev>-<logical>`). */
    rowId: string
    kind: TurnMessageKind
    /** Which tool reply of the turn, for `kind: "tool"`. */
    toolIndex?: number
    /** A message to show instead of the stored one (a reply built from the run result). */
    messageOverride?: SimpleChatMessage | null
    /** Content under the message, such as the repeat pager of the last reply. */
    footer?: ReactNode
    /** Replaces the message's own re-run, for example to re-run every revision in compare. */
    onRerun?: () => void
}

const TOOL_ROLE_OPTIONS = [{label: "tool", value: "tool"}]

/**
 * A collapsed message keeps its header and shows the first lines of its text, which fade out
 * over the last line. The mask runs in px from the top, so a shorter text does not fade.
 */
const COLLAPSED_BODY_CLASS =
    "[&_.agenta-editor-wrapper]:max-h-16 [&_.agenta-editor-wrapper]:overflow-hidden [&_.agenta-editor-wrapper]:[mask-image:linear-gradient(to_bottom,black_40px,transparent_64px)]"

/**
 * In the text view the editor shows the markdown source, where the editor's own placeholder never
 * shows, so an empty message draws it here, at the start of the (empty) source line.
 */
const EMPTY_TEXT_PLACEHOLDER_CLASS =
    "[&_.editor-input.markdown-view_.editor-code]:before:pointer-events-none [&_.editor-input.markdown-view_.editor-code]:before:absolute [&_.editor-input.markdown-view_.editor-code]:before:select-none [&_.editor-input.markdown-view_.editor-code]:before:text-muted-foreground [&_.editor-input.markdown-view_.editor-code]:before:content-[var(--chat-message-placeholder)]"

/**
 * One message of the chat: a user, assistant or tool message in its own editor, with the role,
 * the view mode and the buttons of the message. A reply with tool calls shows one read-only
 * editor for each call.
 */
export const ChatMessage = memo(
    ({
        entityId,
        rowId,
        kind,
        toolIndex = 0,
        messageOverride,
        footer,
        onRerun,
    }: ChatMessageProps) => {
        const model = useTurnMessage({entityId, rowId, kind, toolIndex, messageOverride})
        const {message, role, isError, editorText, toolPayloads} = model
        const isTool = kind === "tool"
        const isUser = kind === "user"

        const editorId = useRef(uuidv4()).current
        const [collapsed, setCollapsed] = useState(false)
        const autoCollapsed = useRef(false)
        // The message collapses by itself ONCE, when its tool calls or its tool result first have
        // content. A later manual expand sticks.
        const hasContent = Boolean(
            message?.content && (typeof message.content !== "string" || message.content.length > 0),
        )
        const shouldAutoCollapse =
            (kind === "assistant" && toolPayloads.length > 0) || (isTool && hasContent)
        useEffect(() => {
            if (autoCollapsed.current || !shouldAutoCollapse) return
            autoCollapsed.current = true
            setCollapsed(true)
        }, [shouldAutoCollapse])

        // Shared and saved across all message editors.
        const [viewMode, setViewMode] = useAtom(messageViewModeAtom)
        const chatViewMode = toMessageViewMode(viewMode)
        const isCodeMode = chatViewMode === "json" || chatViewMode === "yaml"
        const language: "json" | "yaml" = chatViewMode === "yaml" ? "yaml" : "json"

        const [paste, setPaste] = useState<PasteOverLimit | null>(null)
        const onPasteLimitExceeded = useCallback((over: PasteOverLimit) => {
            setPaste(over)
            return true
        }, [])
        const closePaste = useCallback(() => setPaste(null), [])

        if (!message) return null

        const toolbar = (text: string) => (
            <MessageToolbar
                onRerun={isTool ? undefined : (onRerun ?? model.rerun)}
                rerunDisabled={isUser && !model.hasBeenRun}
                onAddImage={isUser ? () => model.addUploadSlot("image") : undefined}
                onAddDocument={isUser ? () => model.addUploadSlot("document") : undefined}
                canAddImage={model.canAddImage}
                canAddDocument={model.canAddDocument}
                copyText={text}
                onRemove={model.remove}
                collapsed={collapsed}
                onToggleCollapse={() => setCollapsed((current) => !current)}
            >
                <ViewModeDropdown
                    value={chatViewMode}
                    options={getViewOptions(text)}
                    onChange={setViewMode}
                />
            </MessageToolbar>
        )

        const editorProps = {
            role: role ?? kind,
            isJSON: isCodeMode,
            language,
            markdownView: chatViewMode === "text",
            enableTokens: !isCodeMode,
            // Each message is a bordered card, as in the old playground.
            editorType: "border" as const,
            // On a narrow message the buttons wrap below the role.
            headerClassName: "flex-wrap",
        }

        const placeholder = isUser
            ? "Type your message…"
            : "Enter tool call result here and hit run"
        const showPlaceholder =
            !editorText && !isError && toolPayloads.length === 0 && chatViewMode === "text"

        const wrapperClass = cn(
            "group/message w-full",
            isError && "[&_.message-user-select]:text-destructive",
            // A tool reply and an error have a fixed role: show it, but do not let it change.
            (isTool || isError) &&
                "[&_.message-user-select]:pointer-events-none [&_.message-user-select_svg]:hidden",
            collapsed && COLLAPSED_BODY_CLASS,
            showPlaceholder && EMPTY_TEXT_PLACEHOLDER_CLASS,
        )
        const wrapperStyle = showPlaceholder
            ? ({"--chat-message-placeholder": JSON.stringify(placeholder)} as CSSProperties)
            : undefined

        const attachments = isUser ? (
            <MessageAttachmentSlots
                listedAttachments={model.listedAttachments}
                uploadSlots={model.uploadSlots}
                onRemoveListed={model.removeListedAttachment}
                onSetImage={model.setSlotImage}
                onSetDocument={model.setSlotDocument}
                onRemoveSlot={model.removeSlot}
            />
        ) : null

        const editorFooter =
            attachments || footer ? (
                <>
                    {attachments}
                    {footer ? <div className="mt-2 flex w-full flex-col">{footer}</div> : null}
                </>
            ) : undefined

        return (
            <div className={wrapperClass} style={wrapperStyle} data-testid={`chat-message-${kind}`}>
                {toolPayloads.length > 0 ? (
                    toolPayloads.map((payload, index) => (
                        <ChatMessageEditor
                            key={`${editorId}-${viewMode}-${payload.callId ?? index}`}
                            id={`${editorId}-${payload.callId ?? index}`}
                            {...editorProps}
                            text={payload.json}
                            disabled
                            state="readOnly"
                            onChangeRole={model.onChangeRole}
                            headerRight={toolbar(payload.json)}
                            headerBottom={
                                payload.name || payload.callId ? (
                                    <ToolCallViewHeader
                                        className="mt-2"
                                        name={payload.name}
                                        callId={payload.callId}
                                    />
                                ) : null
                            }
                            footer={index === toolPayloads.length - 1 ? editorFooter : undefined}
                        />
                    ))
                ) : (
                    <ChatMessageEditor
                        key={`${editorId}-${viewMode}`}
                        id={editorId}
                        {...editorProps}
                        text={editorText}
                        disabled={isError}
                        state={isError ? "readOnly" : "filled"}
                        roleOptions={
                            isTool
                                ? TOOL_ROLE_OPTIONS
                                : isError
                                  ? [{label: "Error", value: "Error"}]
                                  : undefined
                        }
                        placeholder={placeholder}
                        onFocusChange={(focused) => {
                            if (focused) setCollapsed(false)
                        }}
                        onChangeRole={model.onChangeRole}
                        onChangeText={model.onChangeText}
                        onPasteLimitExceeded={isUser ? onPasteLimitExceeded : undefined}
                        headerRight={toolbar(editorText)}
                        headerBottom={
                            isTool && message.tool_call_id ? (
                                <ToolCallViewHeader
                                    className="mt-1"
                                    callId={message.tool_call_id}
                                    name={message.name}
                                />
                            ) : null
                        }
                        footer={editorFooter}
                    />
                )}
                {isUser ? (
                    <PasteLimitDialog paste={paste} onAttach={model.addFile} onClose={closePaste} />
                ) : null}
            </div>
        )
    },
)
ChatMessage.displayName = "ChatMessage"
