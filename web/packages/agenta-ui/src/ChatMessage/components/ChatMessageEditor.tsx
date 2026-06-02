import React, {useEffect, useLayoutEffect, useMemo} from "react"

import {MESSAGE_CONTENT_SCHEMA} from "@agenta/shared/schemas"
import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"

import {SimpleDropdownSelect} from "../../components/presentational/select"
import {EditorProvider} from "../../Editor/Editor"
import {SET_MARKDOWN_VIEW} from "../../Editor/plugins/markdown/commands"
import {SharedEditor, type SharedEditorProps} from "../../SharedEditor"
import {cn, flexLayouts, gapClasses, justifyClasses} from "../../utils/styles"

const DEFAULT_MAX_TEXT_PASTE_CHARS = 50_000

export interface ChatMessageEditorProps {
    /** Unique ID for the editor instance */
    id?: string
    /** The role of the message (user, assistant, system, tool) */
    role: string
    /** The text content of the message */
    text: string
    /** Whether the editor is disabled */
    disabled?: boolean
    /** Additional class name for the container */
    className?: string
    /** Additional class name for the editor */
    editorClassName?: string
    /** Additional class name for the header */
    headerClassName?: string
    /** Placeholder text when empty */
    placeholder?: string
    /** Callback when role changes */
    onChangeRole?: (role: string) => void
    /** Callback when text content changes */
    onChangeText?: (text: string) => void
    /** Content to render on the right side of the header */
    headerRight?: React.ReactNode
    /** Content to render below the header */
    headerBottom?: React.ReactNode
    /** Content to render in the footer */
    footer?: React.ReactNode
    /** Whether the content is JSON */
    isJSON?: boolean
    /** Code editor language when rendering structured content */
    language?: "json" | "yaml"
    /** Whether this is a tool message */
    isTool?: boolean
    /** Custom role options for the dropdown */
    roleOptions?: {label: string; value: string}[]
    /** Whether to enable token highlighting */
    enableTokens?: boolean
    /** Template format for variable syntax highlighting */
    templateFormat?: "mustache" | "curly" | "fstring" | "jinja2"
    /** Available template variables for token highlighting */
    tokens?: string[]
    /** Editor state: filled, readOnly, etc. */
    state?: "filled" | "readOnly"
    /** Editor type: border, borderless */
    editorType?: "border" | "borderless"
    /** Custom validation schema for JSON content */
    validationSchema?: Record<string, unknown>
    /** Suspense fallback mode for editor plugins */
    loadingFallback?: "skeleton" | "none" | "static"
    /** Callback when editor focus state changes */
    onFocusChange?: (focused: boolean) => void
    /** Block paste operations that would make the message exceed this many characters. */
    maxPasteChars?: number
    /** Optional hook for custom handling when a paste exceeds the limit. */
    onPasteLimitExceeded?: SharedEditorProps["onPasteLimitExceeded"]
    /**
     * When true, render content as raw markdown source; when false, render rich text.
     * Setting only the `markdownViewAtom` CSS flag is not enough — the Lexical
     * editor needs a `SET_MARKDOWN_VIEW` command dispatch to actually swap
     * between rich-text nodes and a markdown code node. This prop wires that
     * up via an internal synchronizer mounted inside the EditorProvider.
     */
    markdownView?: boolean
}

/**
 * Dispatches `SET_MARKDOWN_VIEW` whenever `enabled` changes so the Lexical
 * editor actually swaps between rich-text and markdown-source views.
 *
 * Mirrors VariableControlAdapter's MarkdownViewSynchronizer: a `useLayoutEffect`
 * handles updates after the MarkdownPlugin handler is registered, and a
 * deferred `useEffect` + `requestAnimationFrame` re-dispatches once after paint
 * to cover the initial mount race where this component's layout effect can
 * fire before the descendant MarkdownPlugin has registered the command.
 */
const MarkdownViewSynchronizer: React.FC<{enabled: boolean}> = ({enabled}) => {
    const [editor] = useLexicalComposerContext()

    useLayoutEffect(() => {
        editor.dispatchCommand(SET_MARKDOWN_VIEW, enabled)
    }, [editor, enabled])

    useEffect(() => {
        const frameId = requestAnimationFrame(() => {
            editor.dispatchCommand(SET_MARKDOWN_VIEW, enabled)
        })
        return () => cancelAnimationFrame(frameId)
    }, [editor, enabled])

    return null
}

/**
 * A standalone chat message editor component that can be used outside of the Playground.
 * This component provides a role dropdown and text editor for editing chat messages.
 */
const ChatMessageEditorInner: React.FC<ChatMessageEditorProps> = ({
    id,
    role,
    text,
    disabled,
    className,
    editorClassName,
    headerClassName,
    placeholder,
    onChangeRole,
    onChangeText,
    headerRight,
    headerBottom,
    footer,
    isJSON,
    language = "json",
    roleOptions,
    enableTokens,
    templateFormat,
    tokens,
    state = "filled",
    editorType = "border",
    validationSchema,
    loadingFallback = "skeleton",
    onFocusChange,
    maxPasteChars = DEFAULT_MAX_TEXT_PASTE_CHARS,
    onPasteLimitExceeded,
    ...props
}) => {
    const selectOptions = useMemo(
        () =>
            roleOptions ?? [
                {label: "user", value: "user"},
                {label: "assistant", value: "assistant"},
                {label: "system", value: "system"},
                {label: "tool", value: "tool"},
            ],
        [roleOptions],
    )

    // Use provided schema or default MESSAGE_CONTENT_SCHEMA for JSON mode
    const effectiveSchema = useMemo(() => {
        if (validationSchema !== undefined) {
            return validationSchema
        }
        return isJSON ? MESSAGE_CONTENT_SCHEMA : undefined
    }, [validationSchema, isJSON])

    return (
        <SharedEditor
            id={id}
            header={
                <div className={cn("w-full", flexLayouts.column, headerClassName)}>
                    <div
                        className={cn(
                            "w-full",
                            flexLayouts.rowCenter,
                            justifyClasses.between,
                            headerClassName,
                        )}
                    >
                        <SimpleDropdownSelect
                            value={role}
                            options={selectOptions}
                            onChange={(v) => onChangeRole?.(v)}
                            disabled={disabled}
                            className="message-user-select"
                        />
                        {headerRight}
                    </div>
                    {headerBottom}
                </div>
            }
            editorType={editorType}
            initialValue={text}
            value={text}
            handleChange={(v: string) => onChangeText?.(v)}
            // Chat message editors emit on every keystroke — no 300ms
            // debounce window. The default `useDebounceInput` behavior in
            // SharedEditor lets late emits with stale text race against
            // external value updates: e.g. the Refine Prompt modal writes
            // refined messages to the molecule, the chat editor receives
            // the new value, but a previously-scheduled debounced emit
            // fires shortly after with the editor's pre-refine buffer (or
            // the post-hydration text content after normalization) and
            // propagates back up through `PromptSchemaControl
            // .handleMessagesChange`. The spread `{...value, messages:
            // STALE}` overwrites the just-applied refinement, reverting
            // the prompt. Disabling the debounce makes emits synchronous
            // — every onChange propagates immediately, so the molecule's
            // state stays consistent with what the user sees.
            //
            // Performance trade-off: every keystroke fires `onChangeText`,
            // which propagates through `ChatMessageList` →
            // `MessagesSchemaControl` → `PromptSchemaControl` →
            // `setUpdate`. Each step is an atom set or callback dispatch
            // (cheap) and downstream re-renders are limited by Jotai's
            // reactive granularity. In practice the chain is fast enough
            // for normal typing cadence; the previous 300ms debounce was
            // a performance hedge, not a correctness requirement.
            //
            // Kaosiso QA 2026-06-02 (also reproduces in production).
            disableDebounce
            editorClassName={editorClassName}
            placeholder={placeholder}
            disabled={disabled}
            state={disabled ? "readOnly" : state}
            className={cn("relative", flexLayouts.column, gapClasses.xs, "rounded-md", className)}
            footer={footer}
            onFocusChange={onFocusChange}
            maxPasteChars={maxPasteChars}
            onPasteLimitExceeded={onPasteLimitExceeded}
            {...props}
            editorProps={{
                codeOnly: isJSON,
                language: isJSON ? language : undefined,
                noProvider: true,
                enableTokens: Boolean(enableTokens),
                tokens,
                templateFormat,
                showToolbar: false,
                validationSchema: effectiveSchema,
                loadingFallback,
            }}
            noProvider={true}
        />
    )
}

/**
 * Chat message editor with EditorProvider wrapper.
 * Use this component for standalone message editing outside of the Playground.
 */
const ChatMessageEditor: React.FC<ChatMessageEditorProps> = ({
    isJSON,
    isTool,
    language = "json",
    markdownView = false,
    ...props
}) => {
    const isCodeMode = Boolean(isTool || isJSON)
    return (
        <EditorProvider
            codeOnly={isCodeMode}
            language={isCodeMode ? language : undefined}
            enableTokens={Boolean(props.enableTokens)}
            tokens={props.tokens}
            templateFormat={props.templateFormat}
            showToolbar={false}
            disabled={props.disabled}
            id={`${props.id}-${isJSON}-${language}`}
            loadingFallback={props.loadingFallback}
        >
            <ChatMessageEditorInner isJSON={isJSON} language={language} {...props} />
            {/* Sync markdown view AFTER ChatMessageEditorInner so descendant
                MarkdownPlugin has registered SET_MARKDOWN_VIEW by the time the
                synchronizer's effects fire. Only mounted in rich-text mode —
                code mode editors don't include MarkdownPlugin. */}
            {!isCodeMode && <MarkdownViewSynchronizer enabled={markdownView} />}
        </EditorProvider>
    )
}

export default ChatMessageEditor
