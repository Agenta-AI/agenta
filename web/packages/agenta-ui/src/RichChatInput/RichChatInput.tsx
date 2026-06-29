import {forwardRef, type ReactNode, useEffect, useImperativeHandle, useRef, useState} from "react"

import {CodeHighlightNode, CodeNode} from "@lexical/code"
import {HistoryExtension} from "@lexical/history"
import {ListItemNode, ListNode} from "@lexical/list"
import {$convertFromMarkdownString} from "@lexical/markdown"
import {AutoFocusPlugin} from "@lexical/react/LexicalAutoFocusPlugin"
import {ContentEditable} from "@lexical/react/LexicalContentEditable"
import {LexicalExtensionComposer} from "@lexical/react/LexicalExtensionComposer"
import {ListPlugin} from "@lexical/react/LexicalListPlugin"
import {MarkdownShortcutPlugin} from "@lexical/react/LexicalMarkdownShortcutPlugin"
import {TabIndentationPlugin} from "@lexical/react/LexicalTabIndentationPlugin"
import {RichTextExtension} from "@lexical/rich-text"
import clsx from "clsx"
import {$createParagraphNode, $getRoot, defineExtension, type LexicalEditor} from "lexical"

import {chatInputTheme} from "./assets/theme"
import {CHAT_TRANSFORMERS} from "./assets/transformers"
import {CharacterCountPlugin} from "./plugins/CharacterCountPlugin"
import {EditableSyncPlugin} from "./plugins/EditableSyncPlugin"
import {EditorRefBridge} from "./plugins/EditorRefBridge"
import {SendButton} from "./plugins/SendButton"
import {SubmitPlugin} from "./plugins/SubmitPlugin"

/** Imperative handle for prefill / clear / focus (e.g. rewind-to-edit). */
export interface RichChatInputHandle {
    focus: () => void
    clear: () => void
    setMarkdown: (markdown: string) => void
}

export interface RichChatInputProps {
    /** Called with the message serialized to markdown on send (plain Enter or the send button). */
    onSubmit: (markdown: string) => void
    placeholder?: string
    /** Disables editing entirely. For streaming chats prefer leaving editable + routing to a queue. */
    disabled?: boolean
    autoFocus?: boolean
    /** Soft character limit — shown as `count/max` and turns red when exceeded. */
    maxLength?: number
    className?: string
    /** Leading slot in the footer (e.g. an attach-files button). */
    prefix?: ReactNode
    /** Slot above the editor (e.g. a collapsible attachments panel). */
    header?: ReactNode
    /** Slot below the shortcut row (e.g. a queued-messages / stop-streaming row). */
    footer?: ReactNode
    /** Files pasted into the editor (clipboard images/files). */
    onPasteFile?: (files: FileList) => void
    /** Keep the send button enabled with empty text (e.g. attachments pending) — sends "". */
    sendForceEnabled?: boolean
    /** Hide the built-in send button (keyboard-only). */
    hideSendButton?: boolean
    /** A stream is in flight — the send button becomes a Stop button. */
    streaming?: boolean
    /** Abort the in-flight stream (used while `streaming`). */
    onStop?: () => void
}

// Static: RichText gives Cmd+B/I + block behavior, History gives undo/redo, list
// nodes back the markdown list shortcuts. Theme styles the formats.
const chatInputExtension = defineExtension({
    name: "@agenta/ui/rich-chat-input",
    namespace: "@agenta/ui/rich-chat-input",
    dependencies: [RichTextExtension, HistoryExtension],
    nodes: [ListNode, ListItemNode, CodeNode, CodeHighlightNode],
    theme: chatInputTheme,
})

function ShortcutHint({keys, label}: {keys: string; label: string}) {
    return (
        <span className="flex items-center gap-1 whitespace-nowrap text-[10px] text-[var(--ag-colorTextTertiary)]">
            <kbd className="inline-flex items-center justify-center rounded border border-solid border-[var(--ag-colorBorder)] bg-[var(--ag-colorFillTertiary)] px-1 py-0.5 font-[inherit] text-[10px] font-medium leading-none text-[var(--ag-colorTextSecondary)]">
                {keys}
            </kbd>
            {label}
        </span>
    )
}

export const RichChatInput = forwardRef<RichChatInputHandle, RichChatInputProps>(
    function RichChatInput(
        {
            onSubmit,
            placeholder = "Type a message…",
            disabled = false,
            autoFocus = false,
            maxLength,
            className,
            prefix,
            header,
            footer,
            onPasteFile,
            sendForceEnabled,
            hideSendButton,
            streaming,
            onStop,
        },
        ref,
    ) {
        const editorRef = useRef<LexicalEditor | null>(null)
        const [count, setCount] = useState(0)
        const [modKey, setModKey] = useState("⌘")

        useEffect(() => {
            if (typeof navigator !== "undefined" && !/Mac|iPhone|iPad/.test(navigator.userAgent)) {
                setModKey("Ctrl")
            }
        }, [])

        useImperativeHandle(
            ref,
            () => ({
                focus: () => editorRef.current?.focus(),
                clear: () =>
                    editorRef.current?.update(() => {
                        const root = $getRoot()
                        root.clear()
                        root.append($createParagraphNode())
                    }),
                setMarkdown: (markdown: string) =>
                    editorRef.current?.update(() => {
                        $convertFromMarkdownString(markdown, CHAT_TRANSFORMERS)
                        $getRoot().selectEnd()
                    }),
            }),
            [],
        )

        const overLimit = typeof maxLength === "number" && count > maxLength

        return (
            <LexicalExtensionComposer extension={chatInputExtension} contentEditable={null}>
                <div
                    className={clsx(
                        // overflow-hidden so the footer row + its top border clip to the rounded
                        // corners (otherwise the bottom corners read as squared-off cut-offs).
                        "relative flex flex-col overflow-hidden rounded-lg border border-solid bg-[var(--ag-colorBgContainer)] transition-colors",
                        // Neutral, low-key focus emphasis — a soft border darkening rather than the
                        // full brand-primary ring, which was too loud for a chat composer.
                        "border-[var(--ag-colorBorder)] focus-within:border-[var(--ag-colorTextTertiary)]",
                        disabled && "opacity-60",
                        className,
                    )}
                    onPaste={(e) => {
                        const files = e.clipboardData?.files
                        // Take over the paste when it carries files so the editor doesn't also
                        // insert a sibling text/html payload from the same clipboard.
                        if (files && files.length > 0) {
                            e.preventDefault()
                            onPasteFile?.(files)
                        }
                    }}
                >
                    {header}

                    <div className="relative">
                        <ContentEditable
                            aria-label="Chat message"
                            aria-placeholder={placeholder}
                            className="max-h-40 min-h-[72px] overflow-y-auto break-words px-3 py-2.5 text-xs leading-relaxed text-[var(--ag-colorText)] outline-none"
                            placeholder={
                                <div className="pointer-events-none absolute left-3 top-2.5 select-none text-xs text-[var(--ag-colorTextPlaceholder)]">
                                    {placeholder}
                                </div>
                            }
                        />
                    </div>

                    <div className="flex items-center gap-2 border-t border-solid border-[var(--ag-colorBorderSecondary)] px-2 py-1.5">
                        {prefix}
                        <div className="flex flex-wrap items-center gap-2.5">
                            <ShortcutHint keys={`${modKey} B`} label="Bold" />
                            <ShortcutHint keys={`${modKey} I`} label="Italic" />
                            <ShortcutHint keys="↵" label="Send" />
                            <ShortcutHint keys={`${modKey} ↵`} label="Newline" />
                        </div>
                        <span
                            className={clsx(
                                "ml-auto shrink-0 text-xs tabular-nums",
                                overLimit
                                    ? "text-[var(--ag-colorError)]"
                                    : "text-[var(--ag-colorTextTertiary)]",
                            )}
                        >
                            {typeof maxLength === "number" ? `${count}/${maxLength}` : count}
                        </span>
                        {hideSendButton ? null : (
                            <SendButton
                                onSubmit={onSubmit}
                                forceEnabled={sendForceEnabled}
                                disabled={disabled}
                                streaming={streaming}
                                onStop={onStop}
                            />
                        )}
                    </div>

                    {footer ? <div className="px-2 pb-1.5">{footer}</div> : null}

                    {autoFocus ? <AutoFocusPlugin /> : null}
                    <EditorRefBridge editorRef={editorRef} />
                    <EditableSyncPlugin editable={!disabled} />
                    <ListPlugin />
                    {/* Tab / Shift+Tab indents + outdents list items (nesting). */}
                    <TabIndentationPlugin />
                    <MarkdownShortcutPlugin transformers={CHAT_TRANSFORMERS} />
                    <SubmitPlugin onSubmit={onSubmit} />
                    <CharacterCountPlugin onCountChange={setCount} />
                </div>
            </LexicalExtensionComposer>
        )
    },
)
