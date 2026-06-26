/**
 * MarkdownEditor
 *
 * A Markdown-aware editor for Markdown string fields (SKILL.md body, AGENTS.md instructions). It
 * wraps the shared Lexical editor in rich-text mode — the same editor the config message editors
 * use — so it carries the same text ↔ markdown-source view toggle. Prompt-variable tokens are
 * disabled (these are documents, not templated prompts).
 *
 * View can be uncontrolled (defaults to `defaultView`, with the header/toolbar toggle flipping it)
 * or controlled via `view` + `onViewChange`. With `showToolbar`, a formatting toolbar mounts above
 * the editor (it formats the rendered rich-text view; it's disabled in source view). `editable`
 * false renders read-only (for a Preview pane), and `hideHeader` drops the built-in filename/toggle
 * header when the host supplies its own chrome.
 *
 * The whole subtree mounts under an `EditorProvider` with `noProvider` on the editor, so the editor,
 * its header, and the toolbar share one composer context.
 *
 * Controlled value: seeds from `value` and re-syncs when `value` changes from outside (e.g. a skill
 * upload populating the body), while leaving the cursor alone during local typing.
 */
import {useEffect, useId, useLayoutEffect, useRef, useState} from "react"

import {
    EditorProvider,
    MarkdownToolbar,
    SET_MARKDOWN_VIEW,
    useLexicalComposerContext,
} from "@agenta/ui"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {MarkdownLogoIcon, TextAa} from "@phosphor-icons/react"
import {Button, Tag, Tooltip} from "antd"

type MarkdownView = "source" | "rendered"

export interface MarkdownEditorProps {
    value: string
    onChange: (next: string) => void
    placeholder?: string
    disabled?: boolean
    /** Optional file-name tag shown on the left of the editor toolbar (e.g. "AGENTS.md"). */
    filename?: string
    /** Show a formatting toolbar (heading/bold/italic/lists/link/code/quote) above the editor. */
    showToolbar?: boolean
    /** Initial view when uncontrolled. @default "source" */
    defaultView?: MarkdownView
    /** Controlled view. When set, the toggle calls `onViewChange` instead of local state. */
    view?: MarkdownView
    onViewChange?: (view: MarkdownView) => void
    /** Read-only when false (e.g. a Preview pane). @default true */
    editable?: boolean
    /** Drop the built-in filename/toggle header (the host supplies its own chrome). */
    hideHeader?: boolean
    /** Draw a border around the editor. @default true */
    bordered?: boolean
    /** Fill the available height (tall min-height) instead of sizing to content. @default false */
    fill?: boolean
}

/**
 * Dispatches `SET_MARKDOWN_VIEW` whenever the desired view changes so the Lexical editor swaps
 * between rich-text and markdown-source. Mirrors the chat editor's synchronizer: a layout effect
 * handles updates, and a post-paint `requestAnimationFrame` re-dispatch covers the initial-mount
 * race where this effect can fire before the descendant MarkdownPlugin registers the command.
 */
function MarkdownViewSync({enabled}: {enabled: boolean}) {
    const [editor] = useLexicalComposerContext()

    useLayoutEffect(() => {
        editor.dispatchCommand(SET_MARKDOWN_VIEW, enabled)
    }, [editor, enabled])

    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            editor.dispatchCommand(SET_MARKDOWN_VIEW, enabled)
        })
        return () => cancelAnimationFrame(frame)
    }, [editor, enabled])

    return null
}

export function MarkdownEditor({
    value,
    onChange,
    placeholder,
    disabled,
    filename,
    showToolbar = false,
    defaultView = "source",
    view,
    onViewChange,
    editable = true,
    hideHeader = false,
    bordered = true,
    fill = false,
}: MarkdownEditorProps) {
    // Stable id shared by the provider and the editor so they target one composer. Colons from
    // useId() are dropped to keep it id/atom-key safe.
    const reactId = useId()
    const editorId = `md${reactId.replace(/:/g, "")}`

    const [text, setText] = useState(value ?? "")
    const lastExternal = useRef(value ?? "")
    const [internalView, setInternalView] = useState<MarkdownView>(defaultView)

    const effectiveView = view ?? internalView
    const markdownView = effectiveView === "source"
    const readOnly = !editable
    const editorDisabled = Boolean(disabled) || readOnly
    // The toggle is available unless the view is controlled with no change handler.
    const canToggleView = view === undefined || onViewChange !== undefined
    const setView = (next: MarkdownView) => {
        if (view !== undefined) onViewChange?.(next)
        else setInternalView(next)
    }

    // Re-seed only when the value changes from outside (not on our own edits), so an upload that
    // sets the body flows in without fighting the cursor during typing.
    useEffect(() => {
        const next = value ?? ""
        if (next !== lastExternal.current) {
            lastExternal.current = next
            setText(next)
        }
    }, [value])

    const handleChange = (next: string) => {
        setText(next)
        lastExternal.current = next
        onChange(next)
    }

    const viewToggle = canToggleView ? (
        <Tooltip title={markdownView ? "Preview markdown" : "Edit source"}>
            <Button
                type="text"
                icon={markdownView ? <MarkdownLogoIcon size={14} /> : <TextAa size={14} />}
                onClick={() => setView(markdownView ? "rendered" : "source")}
                disabled={disabled}
            />
        </Tooltip>
    ) : null

    // The toolbar lives in the editor's own header slot (inside its single border), so there is no
    // second wrapper border to flash on hover/focus. The negative margins bleed it to the border
    // edges with a divider beneath.
    const toolbarHeader = (
        <div className="-mx-[11px] -mt-[11px] mb-2 flex items-center gap-1 border-b border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-3 py-1.5">
            <MarkdownToolbar disabled={editorDisabled || markdownView} />
            <span className="ml-auto" />
            {viewToggle}
        </div>
    )

    const plainHeader = hideHeader ? undefined : (
        <div className="flex w-full items-center justify-between gap-2">
            {filename ? (
                <Tag
                    bordered
                    className="m-0 font-mono text-[11px] font-normal text-[var(--ag-c-586673,#586673)]"
                >
                    {filename}
                </Tag>
            ) : (
                <span />
            )}
            {viewToggle}
        </div>
    )

    return (
        <EditorProvider
            id={editorId}
            codeOnly={false}
            enableTokens={false}
            showToolbar={false}
            disabled={editorDisabled}
        >
            <SharedEditor
                id={editorId}
                noProvider
                editorType={bordered ? "border" : "borderless"}
                initialValue={text}
                value={text}
                handleChange={handleChange}
                disabled={editorDisabled}
                placeholder={placeholder}
                editorProps={{codeOnly: false, enableTokens: false, noProvider: true}}
                syncWithInitialValueChanges
                style={fill ? {minHeight: "calc(100vh - 220px)"} : undefined}
                header={showToolbar ? toolbarHeader : plainHeader}
            />
            <MarkdownViewSync enabled={markdownView} />
        </EditorProvider>
    )
}
