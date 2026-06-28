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
import {
    type CSSProperties,
    type DragEvent,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
} from "react"

import {
    EditorProvider,
    MarkdownToolbar,
    SET_MARKDOWN_VIEW,
    useLexicalComposerContext,
} from "@agenta/ui"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {cn} from "@agenta/ui/styles"
import {registerCodeHighlighting} from "@lexical/code"
import {Tag} from "antd"

import {CodeBlockLanguageMenu} from "./CodeBlockLanguageMenu"

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
    /** Fill the drawer height (fixed, tall) with the toolbar pinned and content scrolling. For an
     * editor that IS the whole drawer body. @default false */
    fill?: boolean
    /** Cap the editor height (px or CSS length): content-sized up to the cap, then the toolbar pins
     * and the content scrolls inside. For an editor that's one field among others. */
    maxHeight?: number | string
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

/**
 * Enables Prism syntax highlighting for code blocks in the rich view. The shared editor registers
 * the CodeNode/CodeHighlightNode types but never turns on the highlighter, so fenced blocks render
 * as plain monospace until this runs. The token colors come from the `editor-token*` theme classes.
 */
function CodeHighlightSync() {
    const [editor] = useLexicalComposerContext()
    useEffect(() => registerCodeHighlighting(editor), [editor])
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
    maxHeight,
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

    // Markdown-file drop: dropping a .md/.markdown/.txt (or any text/* file) onto the editor
    // replaces its content with the file's text. We intercept in the capture phase and only for
    // file drags, so Lexical's own internal text drag/drop keeps working.
    const [dragOver, setDragOver] = useState(false)
    const dropEnabled = editable && !disabled
    const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files")
    const isMarkdownFile = (file: File) =>
        /\.(md|markdown|mdx|txt)$/i.test(file.name) ||
        file.type.startsWith("text/") ||
        file.type === "application/json" ||
        file.type === ""

    const handleDragOver = useCallback(
        (e: DragEvent) => {
            if (!dropEnabled || !isFileDrag(e)) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = "copy"
            setDragOver(true)
        },
        [dropEnabled],
    )

    const handleDragLeave = useCallback((e: DragEvent) => {
        // Ignore leaves into child nodes; only clear when the pointer exits the wrapper.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDragOver(false)
    }, [])

    const handleDrop = useCallback(
        (e: DragEvent) => {
            if (!dropEnabled || !isFileDrag(e)) return
            e.preventDefault()
            e.stopPropagation()
            setDragOver(false)
            const file = Array.from(e.dataTransfer.files).find(isMarkdownFile)
            if (!file) return
            void file.text().then((content) => handleChange(content))
        },
        // handleChange is stable enough for this usage (reads current onChange via closure).

        [dropEnabled],
    )

    const viewToggle = canToggleView ? (
        <button
            type="button"
            onClick={() => setView(markdownView ? "rendered" : "source")}
            disabled={disabled}
            className="shrink-0 cursor-pointer border-0 bg-transparent px-1 text-xs text-[var(--ag-c-97A4B0,#97a4b0)] transition-colors hover:text-[var(--ag-c-586673,#586673)] disabled:cursor-not-allowed disabled:opacity-50"
        >
            {markdownView ? "Rich text" : "Markdown"}
        </button>
    ) : null

    // Toolbar row pinned above a scroll area this component owns, so it never moves with content.
    // `justify-between` puts formatting on the left and the source/rich toggle hard-right.
    const toolbar = (
        <div className="flex shrink-0 items-center justify-between gap-1 border-b border-solid border-[var(--ag-c-EAEFF5,#eaeff5)] px-3 py-1.5">
            <MarkdownToolbar disabled={editorDisabled || markdownView} />
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

    // Bound the box on this component's own wrapper (self-sized, so it doesn't depend on the parent
    // flex/height chain). `fill` = fixed drawer-body height (≈ header+footer+padding). `maxHeight` =
    // content-sized up to a cap. Either way the toolbar pins and content scrolls inside.
    const boundStyle: CSSProperties | undefined = fill
        ? {height: "calc(100vh - 152px)"}
        : maxHeight != null
          ? {maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight}
          : undefined

    const editorEl = (
        <SharedEditor
            id={editorId}
            noProvider
            editorType={showToolbar || !bordered ? "borderless" : "border"}
            // Suppress the borderless hover/focus border so it doesn't flash inside the toolbar box.
            className={
                showToolbar
                    ? "!border-transparent hover:!border-transparent focus:!border-transparent"
                    : undefined
            }
            initialValue={text}
            value={text}
            handleChange={handleChange}
            disabled={editorDisabled}
            placeholder={placeholder}
            editorProps={{codeOnly: false, enableTokens: false, noProvider: true}}
            syncWithInitialValueChanges
            header={showToolbar ? undefined : plainHeader}
        />
    )

    // `md-prose` scopes the document prose styles (Option B) defined in editor-theme.css to these
    // Markdown editors only, so the shared prompt/chat editor theme is untouched.
    const body = showToolbar ? (
        <div
            className={cn(
                "flex flex-col overflow-hidden",
                bordered && "rounded-md border border-solid border-[var(--ag-c-BDC7D1,#bdc7d1)]",
            )}
            style={boundStyle}
        >
            {toolbar}
            <div className="md-prose min-h-0 flex-1 overflow-y-auto">{editorEl}</div>
        </div>
    ) : boundStyle ? (
        <div className="md-prose overflow-y-auto" style={boundStyle}>
            {editorEl}
        </div>
    ) : (
        <div className="md-prose">{editorEl}</div>
    )

    return (
        <EditorProvider
            id={editorId}
            codeOnly={false}
            enableTokens={false}
            showToolbar={false}
            disabled={editorDisabled}
        >
            {dropEnabled ? (
                <div
                    className="relative"
                    onDragOverCapture={handleDragOver}
                    onDragLeaveCapture={handleDragLeave}
                    onDropCapture={handleDrop}
                >
                    {body}
                    {dragOver ? (
                        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-[var(--ant-color-primary)] bg-[var(--ant-color-primary-bg,rgba(22,119,255,0.08))]">
                            <span className="rounded-md bg-[var(--ant-color-bg-elevated,#fff)] px-3 py-1.5 text-xs font-medium text-[var(--ag-c-586673,#586673)] shadow-sm">
                                Drop a Markdown file to replace the content
                            </span>
                        </div>
                    ) : null}
                </div>
            ) : (
                body
            )}
            <MarkdownViewSync enabled={markdownView} />
            <CodeHighlightSync />
            {!editorDisabled ? <CodeBlockLanguageMenu /> : null}
        </EditorProvider>
    )
}
