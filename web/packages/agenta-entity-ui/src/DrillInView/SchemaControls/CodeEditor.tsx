/**
 * CodeEditor
 *
 * A monospace, syntax-styled editor for free-form code/command string fields (an MCP launch
 * command, a bundled skill file). It wraps the shared Lexical editor in code-only mode — the same
 * machinery {@link JsonObjectEditor} uses for JSON — but emits a plain string instead of parsing,
 * and takes a language so the content is styled correctly.
 *
 * Controlled: seeds from `value` and re-syncs when `value` changes from outside, while leaving the
 * cursor alone during local typing.
 */
import {useEffect, useRef, useState} from "react"

import {SharedEditor} from "@agenta/ui/shared-editor"
import {cn} from "@agenta/ui/styles"

/** Languages the shared code editor can highlight; `code` is the generic monospace fallback. */
export type CodeEditorLanguage = "json" | "yaml" | "code" | "python" | "javascript" | "typescript"

export interface CodeEditorProps {
    value: string
    onChange: (next: string) => void
    /** Highlight language. @default "code" */
    language?: CodeEditorLanguage
    placeholder?: string
    disabled?: boolean
    /** Emit changes immediately instead of after the shared editor's 300 ms debounce. @default false */
    disableDebounce?: boolean
    /** Fill the height the flex parent gives it, scrolling inside. Parent must be a `min-h-0`
     * flex column. @default false (content-sized) */
    grow?: boolean
}

/** Best-effort highlight language from a file path's extension, for bundled-file editing. */
export function codeLanguageFromPath(path: string | undefined): CodeEditorLanguage {
    const ext = (path ?? "").split(".").pop()?.toLowerCase()
    switch (ext) {
        case "py":
            return "python"
        case "js":
        case "mjs":
        case "cjs":
            return "javascript"
        case "ts":
        case "tsx":
            return "typescript"
        case "json":
            return "json"
        case "yaml":
        case "yml":
            return "yaml"
        default:
            return "code"
    }
}

export function CodeEditor({
    value,
    onChange,
    language = "code",
    placeholder,
    disabled,
    disableDebounce = false,
    grow = false,
}: CodeEditorProps) {
    const [text, setText] = useState(value ?? "")
    const lastExternal = useRef(value ?? "")

    // Re-seed only when the value changes from outside (not on our own edits).
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

    const editor = (
        <SharedEditor
            // `!min-h-full`: fills the scroll box (beating the component's own `min-h-[70px]`)
            // while still growing past it, so the border spans the pane AND long files scroll.
            className={grow ? "!min-h-full" : undefined}
            editorType="border"
            initialValue={text}
            value={text}
            handleChange={handleChange}
            disabled={disabled}
            placeholder={placeholder}
            editorProps={{codeOnly: true, language}}
            syncWithInitialValueChanges
            disableDebounce={disableDebounce}
        />
    )

    return (
        // No border here: SharedEditor's own `editorType="border"` already draws one, and a second
        // ring around it read as a doubled edge.
        <div className={cn("overflow-hidden rounded", grow && "flex min-h-0 flex-1 flex-col")}>
            {grow ? (
                // The scroll lives on this wrapper, NOT on SharedEditor: that component sets
                // `overflow: hidden` inline, which an `overflow-y-auto` class cannot override.
                // tabIndex: a scroll region must be keyboard-reachable (axe).
                <div tabIndex={0} className="min-h-0 flex-1 overflow-y-auto">
                    {editor}
                </div>
            ) : (
                editor
            )}
        </div>
    )
}
