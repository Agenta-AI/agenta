import {
    forwardRef,
    type ReactNode,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react"

import {modifierKeyLabel} from "@agenta/shared/utils"
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
import {
    $createParagraphNode,
    $getRoot,
    $getSelection,
    $isRangeSelection,
    defineExtension,
    type LexicalEditor,
} from "lexical"

import type {SlashCommandSection} from "./assets/slashCommands"
import {chatInputTheme} from "./assets/theme"
import {CHAT_TRANSFORMERS} from "./assets/transformers"
import {CharacterCountPlugin} from "./plugins/CharacterCountPlugin"
import {CodeFencePlugin} from "./plugins/CodeFencePlugin"
import {beginDictation, type DictationSession} from "./plugins/dictation"
import {EditableSyncPlugin} from "./plugins/EditableSyncPlugin"
import {EditorRefBridge} from "./plugins/EditorRefBridge"
import {FocusStatePlugin} from "./plugins/FocusStatePlugin"
import {LinkPastePlugin} from "./plugins/LinkPastePlugin"
import {SendButton} from "./plugins/SendButton"
import {SlashCommandPlugin} from "./plugins/SlashCommandPlugin"
import {SubmitPlugin} from "./plugins/SubmitPlugin"

/** Imperative handle for prefill / clear / focus (e.g. rewind-to-edit). */
export interface RichChatInputHandle {
    focus: () => void
    /** Drop focus before handing the keyboard to an overlay — see `blur` in the implementation. */
    blur: () => void
    clear: () => void
    /**
     * Type text at the caret, leaving the rest of the message alone. `setMarkdown` REPLACES the
     * document, which would discard whatever the user had already written.
     */
    insertText: (text: string) => void
    setMarkdown: (markdown: string) => void
    /** Read the current content as markdown without submitting (e.g. non-Enter actions). */
    getMarkdown: () => string
    /** Open a dictation session at the end of the document (see `plugins/dictation`). */
    beginDictation: () => void
    /** Push the recogniser's committed text and its provisional tail into that session. */
    updateDictation: (finalText: string, interimText: string) => void
    /** Settle the session — provisional words are kept, styled as normal text. */
    endDictation: () => void
}

export interface RichChatInputProps {
    /** Called with the message serialized to markdown on send (plain Enter or the send button). */
    onSubmit: (markdown: string) => void
    placeholder?: string
    /** Disables editing entirely. For streaming chats prefer leaving editable + routing to a queue. */
    disabled?: boolean
    /** Speech is being dictated in. Locks editing for the duration so typing cannot interleave with
     * the incoming transcript and corrupt it. */
    dictating?: boolean
    autoFocus?: boolean
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
    /** Disable submit without locking the editor (e.g. an attachment upload failed). */
    sendDisabled?: boolean
    /** Explain why submit is disabled without locking the editor. */
    sendDisabledReason?: ReactNode
    /** Hide the built-in send button (keyboard-only). */
    hideSendButton?: boolean
    /** A stream is in flight — the send button becomes a Stop button. */
    streaming?: boolean
    /** Disable the Stop control while its durable request is settling. */
    stopping?: boolean
    /** Request a durable stop (used while `streaming`). */
    onStop?: () => void
    /** Min-height class for the editor area (default `min-h-[72px]`). */
    minHeightClassName?: string
    /** Visual density: `compact` (default, chat) or `comfortable` (hero-scale surfaces) —
     * pads the editor/footer without forking the component. */
    size?: "compact" | "comfortable"
    /** Font-size class for the editor text + placeholder (default `text-xs`). */
    textSizeClassName?: string
    /** Hide just the Send/Newline shortcut hints (keep prefix + trailing). */
    hideShortcutHints?: boolean
    /** Whether plain Enter submits. Default true (chat); set false for description-style inputs. */
    submitOnEnter?: boolean
    /** Reports the current plain text on every edit (e.g. to detect the composer going empty). */
    onChange?: (text: string) => void
    /** Seed the editor once on mount (e.g. a restored per-session draft). Later changes ignored. */
    initialMarkdown?: string
    /**
     * Sections for the `/` command palette. Omitted → no palette, so the hosts that don't want one
     * are untouched. See `assets/slashCommands`.
     */
    slashCommands?: SlashCommandSection[]
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

export function ShortcutHint({keys, label}: {keys: string; label: string}) {
    return (
        <span className="flex items-center gap-1 whitespace-nowrap text-[12px] text-[var(--ag-colorTextSecondary)]">
            <kbd className="ag-surface-chip inline-flex items-center justify-center rounded px-1 py-0.5 font-[inherit] text-[12px] font-medium leading-none text-[var(--ag-colorTextSecondary)]">
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
            dictating = false,
            autoFocus = false,
            className,
            prefix,
            header,
            footer,
            trailing,
            onPasteFile,
            sendForceEnabled,
            sendDisabled,
            hideSendButton,
            streaming,
            stopping,
            onStop,
            minHeightClassName = "min-h-[72px]",
            size = "compact",
            textSizeClassName = "text-xs",
            hideShortcutHints = false,
            sendDisabledReason,
            submitOnEnter = true,
            onChange,
            initialMarkdown,
            slashCommands,
        },
        ref,
    ) {
        const editorRef = useRef<LexicalEditor | null>(null)
        const dictationRef = useRef<DictationSession | null>(null)
        // The `/` palette spans this box and floats above it.
        const boxRef = useRef<HTMLDivElement | null>(null)
        const [focused, setFocused] = useState(false)
        // Resolved after mount: SSR has no platform, and answering during render would mismatch on
        // hydration. `SubmitPlugin` accepts meta OR ctrl, so the binding matches the label on both.
        const [modKey, setModKey] = useState("⌘")

        useEffect(() => setModKey(modifierKeyLabel()), [])

        // A send empties the editor, so the session must go with it: the recogniser flushes a last
        // final result on its way out, which would otherwise rebuild its nodes in the empty box.
        const handleSubmit = useCallback(
            (markdown: string) => {
                dictationRef.current = null
                onSubmit(markdown)
            },
            [onSubmit],
        )

        // Seed once at mount. EditorRefBridge (a child) binds the editor in its own effect,
        // which runs before this one, so the ref is live here. Mount-only by design — the
        // ref freezes the first value so a re-render can't re-apply it over user edits.
        const initialMarkdownRef = useRef(initialMarkdown)
        useEffect(() => {
            const md = initialMarkdownRef.current
            if (!md?.trim()) return
            editorRef.current?.update(() => {
                $convertFromMarkdownString(md, CHAT_TRANSFORMERS)
                $getRoot().selectEnd()
            })
        }, [])

        useImperativeHandle(
            ref,
            () => ({
                // A focused editor re-asserts its selection on the next reconcile, which reads as
                // focus theft to an overlay that just autofocused itself (it dismisses).
                blur: () => editorRef.current?.blur(),
                focus: () => editorRef.current?.focus(),
                clear: () => {
                    // Same reason as a send: an emptied editor cannot host a live session.
                    dictationRef.current = null
                    editorRef.current?.update(() => {
                        const root = $getRoot()
                        root.clear()
                        root.append($createParagraphNode())
                    })
                },
                insertText: (text: string) => {
                    const editor = editorRef.current
                    if (!editor) return
                    // Focus first: the caller may have blurred us to hand an overlay the keyboard,
                    // and an insert with no range selection would land nowhere.
                    editor.focus()
                    editor.update(() => {
                        const selection = $getSelection()
                        if ($isRangeSelection(selection)) {
                            selection.insertText(text)
                            return
                        }
                        $getRoot().selectEnd()
                        const restored = $getSelection()
                        if ($isRangeSelection(restored)) restored.insertText(text)
                    })
                },
                setMarkdown: (markdown: string) =>
                    editorRef.current?.update(() => {
                        $convertFromMarkdownString(markdown, CHAT_TRANSFORMERS)
                        $getRoot().selectEnd()
                    }),
                getMarkdown: () =>
                    editorRef.current
                        ?.getEditorState()
                        .read(() => $convertToMarkdownString(CHAT_TRANSFORMERS)) ?? "",
                beginDictation: () => {
                    const editor = editorRef.current
                    if (!editor) return
                    // Settle any session still open (a re-press while the last one is closing) so
                    // its words stay put instead of being orphaned at interim opacity.
                    dictationRef.current?.end()
                    dictationRef.current = beginDictation(editor)
                },
                updateDictation: (finalText: string, interimText: string) =>
                    dictationRef.current?.update(finalText, interimText),
                endDictation: () => {
                    dictationRef.current?.end()
                    dictationRef.current = null
                },
            }),
            [],
        )

        const comfortable = size === "comfortable"
        const hintsVisible = focused && !dictating

        return (
            <LexicalExtensionComposer extension={chatInputExtension} contentEditable={null}>
                <div
                    ref={boxRef}
                    className={clsx(
                        // Single rounded border around the whole composer; overflow-hidden clips the
                        // editor + toolbar to the rounded corners. The toolbar has no divider of its
                        // own, so the bottom edge reads as one border, not two.
                        // Filled, not transparent: an outlined box reads as an outline, where a fill reads as
                        // somewhere to type. A FILL token rather than an opaque surface — it lifts off the
                        // page in dark and settles into it in light, where "elevated" is the page colour.
                        "relative flex flex-col overflow-hidden rounded-lg border border-solid bg-[var(--ag-colorFillTertiary)] shadow-[var(--ag-surface-chat-shadow)] transition-colors",
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
                                "max-h-40 overflow-y-auto break-words leading-relaxed text-[var(--ag-colorText)] outline-none",
                                comfortable ? "px-5 py-4" : "px-3 py-2.5",
                                textSizeClassName,
                                minHeightClassName,
                            )}
                            placeholder={
                                // Mirrors the editor's own box exactly — same padding, same
                                // leading. A different line-height sits the placeholder off the
                                // caret's baseline by a couple of pixels.
                                <div
                                    className={clsx(
                                        "pointer-events-none absolute inset-0 select-none break-words leading-relaxed text-[var(--ag-composer-placeholder)]",
                                        comfortable ? "px-5 py-4" : "px-3 py-2.5",
                                        textSizeClassName,
                                    )}
                                >
                                    {placeholder}
                                </div>
                            }
                        />
                    </div>

                    <div
                        className={clsx(
                            "flex items-center gap-2",
                            comfortable ? "px-4 pb-3 pt-1.5" : "px-2 py-1.5",
                        )}
                    >
                        {prefix}
                        {hideShortcutHints ? null : (
                            // The format hints are a focus-only aid: kept mounted (so their space
                            // never reflows the row) and faded in when the editor takes focus.
                            // Dictation hides them the same way — editing is locked while speech
                            // comes in, so every shortcut they advertise is inert.
                            <div
                                className={clsx(
                                    "flex flex-wrap items-center gap-2.5 transition-[opacity,transform] duration-200 ease-out",
                                    hintsVisible
                                        ? "translate-y-0 opacity-100"
                                        : "pointer-events-none translate-y-0.5 opacity-0",
                                )}
                                aria-hidden={!hintsVisible}
                            >
                                {/* Bold/Italic still work (Cmd/Ctrl+B/I) — they just no longer
                                    advertise themselves; the send/newline pair is the only pair
                                    you need told to you. */}
                                <ShortcutHint keys="↵" label="Send" />
                                <ShortcutHint keys={`${modKey} ↵`} label="Newline" />
                            </div>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                            {hideSendButton ? null : (
                                <SendButton
                                    onSubmit={handleSubmit}
                                    forceEnabled={sendForceEnabled}
                                    disabled={disabled || sendDisabled}
                                    disabledReason={sendDisabledReason}
                                    streaming={streaming}
                                    onStop={onStop}
                                    stopping={stopping}
                                />
                            )}
                            {trailing}
                        </div>
                    </div>

                    {footer ? <div className="px-2 pb-1.5">{footer}</div> : null}

                    {autoFocus ? <AutoFocusPlugin /> : null}
                    <EditorRefBridge editorRef={editorRef} />
                    <EditableSyncPlugin editable={!disabled && !dictating} />
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
                    {submitOnEnter ? (
                        <SubmitPlugin onSubmit={handleSubmit} disabled={sendDisabled} />
                    ) : null}
                    <FocusStatePlugin onFocusChange={setFocused} />
                    {onChange ? <CharacterCountPlugin onTextChange={onChange} /> : null}
                    {/* Registers Enter above SubmitPlugin, so it must mount after it. */}
                    {slashCommands?.length ? (
                        <SlashCommandPlugin
                            sections={slashCommands}
                            anchorRef={boxRef}
                            disabled={disabled || dictating}
                        />
                    ) : null}
                </div>
            </LexicalExtensionComposer>
        )
    },
)
RichChatInput.displayName = "RichChatInput"
