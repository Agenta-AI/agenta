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
    type MouseEvent,
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
import {Badge} from "@agenta/ui/ui"
import {registerCodeHighlighting} from "@lexical/code"

import {CodeBlockLanguageMenu} from "./CodeBlockLanguageMenu"

// Pure drop predicates — no component state, so they live at module scope (stable identity, no
// need to thread them through the drag/drop callback deps).
const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files")
const isMarkdownFile = (file: File) =>
    /\.(md|markdown|mdx|txt)$/i.test(file.name) ||
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    file.type === ""

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
    /** Fill whatever height the flex parent gives it (no viewport math), toolbar pinned and content
     * scrolling. The parent chain must be a flex column with `min-h-0`. @default false */
    grow?: boolean
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
    grow = false,
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

    // Stable so the memoized drop handler below never captures a stale `onChange` — some consumers
    // (e.g. SkillFormView) pass a fresh inline `onChange` every render.
    const handleChange = useCallback(
        (next: string) => {
            setText(next)
            lastExternal.current = next
            onChange(next)
        },
        [onChange],
    )

    // Markdown-file drop: dropping a .md/.markdown/.txt (or any text/* file) onto the editor
    // replaces its content with the file's text. We intercept in the capture phase and only for
    // file drags, so Lexical's own internal text drag/drop keeps working.
    const [dragOver, setDragOver] = useState(false)
    const dropEnabled = editable && !disabled

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
        [dropEnabled, handleChange],
    )

    const viewToggle = canToggleView ? (
        <button
            type="button"
            onClick={() => setView(markdownView ? "rendered" : "source")}
            disabled={disabled}
            className="shrink-0 cursor-pointer border-0 bg-transparent px-1 text-xs text-[var(--ag-zinc-5)] transition-colors hover:text-[var(--ag-c-586673)] disabled:cursor-not-allowed disabled:opacity-50"
        >
            {markdownView ? "Rich text" : "Source"}
        </button>
    ) : null

    // Toolbar row pinned above a scroll area this component owns, so it never moves with content.
    // `justify-between` puts formatting on the left and the source/rich toggle hard-right.
    const toolbar = (
        // border-0 first: preflight is off, so a bare `border-b` still paints the UA's other
        // three sides — the top one doubling up with the container's own border.
        <div className="flex shrink-0 items-center justify-between gap-1 border-0 border-b border-solid border-[var(--ag-c-EAEFF5)] px-3 py-1.5">
            <MarkdownToolbar disabled={editorDisabled || markdownView} />
            {viewToggle}
        </div>
    )

    const plainHeader = hideHeader ? undefined : (
        <div className="flex w-full items-center justify-between gap-2">
            {filename ? (
                // antd v6's default Tag variant is `filled` (borderless), so the `bordered` this
                // carried was a no-op — the neutral Badge is the exact equivalent.
                <Badge className="font-mono text-xs font-normal leading-[22.4px] text-[var(--ag-c-586673)]">
                    {filename}
                </Badge>
            ) : (
                <span />
            )}
            {viewToggle}
        </div>
    )

    // Bound the box on this component's own wrapper (self-sized, so it doesn't depend on the parent
    // flex/height chain). `fill` = fixed drawer-body height (≈ header+footer+padding). `maxHeight` =
    // content-sized up to a cap. Either way the toolbar pins and content scrolls inside.
    const boundStyle: CSSProperties | undefined = grow
        ? undefined
        : fill
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

    // The contenteditable is only as tall as its content, so a click in the empty space below it
    // would otherwise land on the scroll region and focus nothing. Redirect those to the editor,
    // caret at the end. Clicks on the text itself fall through untouched.
    const focusOnBlankClick = (e: MouseEvent<HTMLDivElement>) => {
        if (editorDisabled) return
        const target = e.target as HTMLElement
        if (target.closest('[contenteditable="true"]')) return
        // Classic (space-taking) scrollbars dispatch mousedown to the scroll box itself; without
        // this the handler would preventDefault the drag and jerk the caret to the end.
        const rect = e.currentTarget.getBoundingClientRect()
        if (
            e.clientX - rect.left >= e.currentTarget.clientWidth ||
            e.clientY - rect.top >= e.currentTarget.clientHeight
        )
            return
        const input = e.currentTarget.querySelector<HTMLElement>('[contenteditable="true"]')
        if (!input) return
        e.preventDefault()
        input.focus()
        const range = document.createRange()
        range.selectNodeContents(input)
        range.collapse(false)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
    }

    // `md-prose` scopes the document prose styles (Option B) defined in editor-theme.css to these
    // Markdown editors only, so the shared prompt/chat editor theme is untouched.
    const body = showToolbar ? (
        <div
            className={cn(
                "flex flex-col overflow-hidden",
                grow && "min-h-0 flex-1",
                bordered && "rounded-md border border-solid border-[var(--ag-c-BDC7D1)]",
            )}
            style={boundStyle}
        >
            {toolbar}
            {/* tabIndex: a scroll region must be keyboard-reachable (axe scrollable-region-focusable)
                — in rendered/read-only view it has no focusable content of its own. */}
            <div
                tabIndex={0}
                className="md-prose min-h-0 flex-1 overflow-y-auto"
                onMouseDown={focusOnBlankClick}
            >
                {editorEl}
            </div>
        </div>
    ) : boundStyle || grow ? (
        <div
            tabIndex={0}
            className={cn("md-prose overflow-y-auto", grow && "min-h-0 flex-1")}
            style={boundStyle}
            onMouseDown={focusOnBlankClick}
        >
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
            // `!`: the provider hardcodes a `min-h-[70px]` floor that would block shrinking.
            className={grow ? "!min-h-0 flex-1" : undefined}
        >
            {dropEnabled ? (
                <div
                    className={cn("relative", grow && "flex min-h-0 flex-1 flex-col")}
                    onDragOverCapture={handleDragOver}
                    onDragLeaveCapture={handleDragLeave}
                    onDropCapture={handleDrop}
                >
                    {body}
                    {dragOver ? (
                        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-[var(--ant-color-primary)] bg-[var(--ant-color-primary-bg,rgba(22,119,255,0.08))]">
                            <span className="rounded-md bg-[var(--ant-color-bg-elevated,#fff)] px-3 py-1.5 text-xs font-medium text-[var(--ag-c-586673)] shadow-sm">
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
            {/* Source view wraps the whole document in one markdown CodeNode — its picker is
                meaningless there, so the menu is for author-inserted blocks in rich text only. */}
            {!markdownView && <CodeBlockLanguageMenu editable={!editorDisabled} />}
        </EditorProvider>
    )
}
