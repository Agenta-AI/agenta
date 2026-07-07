import {forwardRef, type ReactNode, useEffect, useImperativeHandle, useRef, useState} from "react"

import {CodeHighlightNode, CodeNode} from "@lexical/code"
import {HistoryExtension} from "@lexical/history"
import {LinkNode} from "@lexical/link"
import {ListItemNode, ListNode} from "@lexical/list"
import {$convertFromMarkdownString, $convertToMarkdownString} from "@lexical/markdown"
import {AutoFocusPlugin} from "@lexical/react/LexicalAutoFocusPlugin"
import {ClickableLinkPlugin} from "@lexical/react/LexicalClickableLinkPlugin"
import {ContentEditable} from "@lexical/react/LexicalContentEditable"
import {LexicalExtensionComposer} from "@lexical/react/LexicalExtensionComposer"
import {LinkPlugin} from "@lexical/react/LexicalLinkPlugin"
import {ListPlugin} from "@lexical/react/LexicalListPlugin"
import {MarkdownShortcutPlugin} from "@lexical/react/LexicalMarkdownShortcutPlugin"
import {TabIndentationPlugin} from "@lexical/react/LexicalTabIndentationPlugin"
import {RichTextExtension} from "@lexical/rich-text"
import clsx from "clsx"
import {$createParagraphNode, $getRoot, defineExtension, type LexicalEditor} from "lexical"

import {chatInputTheme} from "./assets/theme"
import {CHAT_TRANSFORMERS} from "./assets/transformers"
import {CharacterCountPlugin} from "./plugins/CharacterCountPlugin"
import {CodeFencePlugin} from "./plugins/CodeFencePlugin"
import {EditableSyncPlugin} from "./plugins/EditableSyncPlugin"
import {EditorRefBridge} from "./plugins/EditorRefBridge"
import {LinkPastePlugin} from "./plugins/LinkPastePlugin"
import {SendButton} from "./plugins/SendButton"
import {SubmitPlugin} from "./plugins/SubmitPlugin"

/** Imperative handle for prefill / clear / focus (e.g. rewind-to-edit). */
export interface RichChatInputHandle {
    focus: () => void
    clear: () => void
    setMarkdown: (markdown: string) => void
    /** Read the current content as markdown without submitting (e.g. non-Enter actions). */
    getMarkdown: () => string
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
    /** Trailing slot in the toolbar row, right-aligned (e.g. custom submit actions). */
    trailing?: ReactNode
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
    /** Min-height class for the editor area (default `min-h-[72px]`). */
    minHeightClassName?: string
    /** Font-size class for the editor text + placeholder (default `text-xs`). */
    textSizeClassName?: string
    /** Hide just the Bold/Italic/Send/Newline shortcut hints (keep prefix + trailing). */
    hideShortcutHints?: boolean
    /** Whether plain Enter submits. Default true (chat); set false for description-style inputs. */
    submitOnEnter?: boolean
    /** Reports the current plain text on every edit (e.g. to detect the composer going empty). */
    onChange?: (text: string) => void
}

// Static: RichText gives Cmd+B/I + block behavior, History gives undo/redo, list
// nodes back the markdown list shortcuts. Theme styles the formats.
const chatInputExtension = defineExtension({
    name: "@agenta/ui/rich-chat-input",
    namespace: "@agenta/ui/rich-chat-input",
    dependencies: [RichTextExtension, HistoryExtension],
    nodes: [ListNode, ListItemNode, CodeNode, CodeHighlightNode, LinkNode],
    theme: chatInputTheme,
})

function ShortcutHint({keys, label}: {keys: string; label: string}) {
    return (
        <span className="flex items-center gap-1 whitespace-nowrap text-[10px] text-[var(--ag-colorTextSecondary)]">
            <kbd className="ag-surface-chip inline-flex items-center justify-center rounded px-1 py-0.5 font-[inherit] text-[10px] font-medium leading-none text-[var(--ag-colorTextSecondary)]">
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
            trailing,
            onPasteFile,
            sendForceEnabled,
            hideSendButton,
            streaming,
            onStop,
            minHeightClassName = "min-h-[72px]",
            textSizeClassName = "text-xs",
            hideShortcutHints = false,
            submitOnEnter = true,
            onChange,
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
                getMarkdown: () =>
                    editorRef.current
                        ?.getEditorState()
                        .read(() => $convertToMarkdownString(CHAT_TRANSFORMERS)) ?? "",
            }),
            [],
        )

        const overLimit = typeof maxLength === "number" && count > maxLength

        return (
            <LexicalExtensionComposer extension={chatInputExtension} contentEditable={null}>
                <div
                    className={clsx(
                        // Single rounded border around the whole composer; overflow-hidden clips the
                        // editor + toolbar to the rounded corners. The toolbar has no divider of its
                        // own, so the bottom edge reads as one border, not two.
                        "relative flex flex-col overflow-hidden rounded-lg border border-solid bg-[var(--ag-colorBgContainer)] shadow-[var(--ag-surface-chat-shadow)] transition-colors",
                        // The primary input reads as a defined, slightly-lifted field: a visible edge
                        // + soft shadow, then the accent border on focus (1px, no glow).
                        "border-[var(--ag-composer-border)] focus-within:border-[var(--ag-composer-focus)]",
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
                            className={clsx(
                                "max-h-40 overflow-y-auto break-words px-3 py-2.5 leading-relaxed text-[var(--ag-colorText)] outline-none",
                                textSizeClassName,
                                minHeightClassName,
                            )}
                            placeholder={
                                <div
                                    className={clsx(
                                        "pointer-events-none absolute left-3 top-2.5 select-none text-[var(--ag-composer-placeholder)]",
                                        textSizeClassName,
                                    )}
                                >
                                    {placeholder}
                                </div>
                            }
                        />
                    </div>

                    <div className="flex items-center gap-2 px-2 py-1.5">
                        {prefix}
                        {hideShortcutHints ? null : (
                            <div className="flex flex-wrap items-center gap-2.5">
                                <ShortcutHint keys={`${modKey} B`} label="Bold" />
                                <ShortcutHint keys={`${modKey} I`} label="Italic" />
                                <ShortcutHint keys="↵" label="Send" />
                                <ShortcutHint keys={`${modKey} ↵`} label="Newline" />
                            </div>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                            {/* Only show a counter when there's a limit to track against, or when the
                                user has actually typed — a lone "0" beside the button is just clutter. */}
                            {(typeof maxLength === "number" || count > 0) && (
                                <span
                                    className={clsx(
                                        "shrink-0 text-xs tabular-nums",
                                        overLimit
                                            ? "text-[var(--ag-colorError)]"
                                            : "text-[var(--ag-colorTextTertiary)]",
                                    )}
                                >
                                    {typeof maxLength === "number"
                                        ? `${count}/${maxLength}`
                                        : count}
                                </span>
                            )}
                            {hideSendButton ? null : (
                                <SendButton
                                    onSubmit={onSubmit}
                                    forceEnabled={sendForceEnabled}
                                    disabled={disabled}
                                    streaming={streaming}
                                    onStop={onStop}
                                />
                            )}
                            {trailing}
                        </div>
                    </div>

                    {footer ? <div className="px-2 pb-1.5">{footer}</div> : null}

                    {autoFocus ? <AutoFocusPlugin /> : null}
                    <EditorRefBridge editorRef={editorRef} />
                    <EditableSyncPlugin editable={!disabled} />
                    <ListPlugin />
                    {/* Tab / Shift+Tab indents + outdents list items (nesting). */}
                    <TabIndentationPlugin />
                    {/* Link node behavior + the TOGGLE_LINK_COMMAND the paste plugin dispatches.
                        ClickableLinkPlugin opens a clicked link in a new tab (newTab defaults true);
                        it still lets you drag-select link text to edit it. */}
                    <LinkPlugin />
                    <ClickableLinkPlugin newTab />
                    <LinkPastePlugin />
                    <MarkdownShortcutPlugin transformers={CHAT_TRANSFORMERS} />
                    {/* Enter on a lone ``` fence opener → code block (runs before SubmitPlugin). */}
                    <CodeFencePlugin />
                    {submitOnEnter ? <SubmitPlugin onSubmit={onSubmit} /> : null}
                    <CharacterCountPlugin onCountChange={setCount} onTextChange={onChange} />
                </div>
            </LexicalExtensionComposer>
        )
    },
)
