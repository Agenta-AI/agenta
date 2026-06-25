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

/** Languages the shared code editor can highlight; `code` is the generic monospace fallback. */
export type CodeEditorLanguage = "json" | "yaml" | "code" | "python" | "javascript" | "typescript"

export interface CodeEditorProps {
    value: string
    onChange: (next: string) => void
    /** Highlight language. @default "code" */
    language?: CodeEditorLanguage
    placeholder?: string
    disabled?: boolean
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

    return (
        <div className="overflow-hidden rounded border border-solid border-[var(--ag-c-EAEFF5,#eaeff5)]">
            <SharedEditor
                editorType="border"
                initialValue={text}
                value={text}
                handleChange={handleChange}
                disabled={disabled}
                placeholder={placeholder}
                editorProps={{codeOnly: true, language}}
                syncWithInitialValueChanges
            />
        </div>
    )
}
