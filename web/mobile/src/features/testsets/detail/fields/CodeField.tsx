import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    codeParseError,
    parseCodeString,
    textMatchesValue,
    toCodeString,
    type CodeFormat,
    type CodeParseError,
} from "@agenta/entity-ui/testcase"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {cn} from "@agenta/ui/ui"

import {CodeErrorLine} from "./CodeErrorLine"

/**
 * The draft of a code text, with the root editor's rules: the typed text stays, it reaches the
 * value when it parses, and the text is replaced only when the value changes from outside.
 * Text that does not parse gives the error, and the value keeps its last valid state. Every
 * valid edit goes out, also one that only moves keys or spaces, so a value stored as text keeps
 * exactly the typed text. `toText` writes the value as text (one line for an input).
 */
export function useCodeDraft(
    value: unknown,
    format: CodeFormat,
    onChange: ((next: unknown, text: string) => void) | undefined,
    toText: (value: unknown, format: CodeFormat) => string = toCodeString,
) {
    const display = useMemo(() => toText(value, format), [toText, value, format])
    const [text, setText] = useState(display)
    const [error, setError] = useState<CodeParseError | null>(null)
    const typed = useRef(display)

    useEffect(() => {
        if (textMatchesValue(typed.current, format, value)) return
        typed.current = display
        setText(display)
        setError(null)
    }, [display, format, value])

    const onTextChange = useCallback(
        (next: string) => {
            // The editor repeats the text it was given: not an edit.
            if (!onChange || next === typed.current) return
            typed.current = next
            setText(next)
            const problem = codeParseError(next, format)
            setError(problem)
            if (!problem) onChange(parseCodeString<unknown>(next, format, value), next)
        },
        [format, onChange, value],
    )
    return {text, error, onTextChange}
}

/**
 * A field as JSON or YAML, with the draft rules of `useCodeDraft`. Text that does not parse
 * shows the error line. `onChange` gets the parsed value and the typed text.
 */
export const CodeField = ({
    id,
    value,
    format,
    onChange,
}: {
    id: string
    value: unknown
    format: CodeFormat
    onChange?: (next: unknown, text: string) => void
}) => {
    const {text, error, onTextChange} = useCodeDraft(value, format, onChange)

    const editorId = `testcase-field-${format}-${id}`
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <EditorProvider key={editorId} codeOnly language={format} showToolbar={false}>
                <SharedEditor
                    key={`${editorId}-shared`}
                    initialValue={text}
                    handleChange={onChange ? onTextChange : undefined}
                    editorType="border"
                    className={cn("min-h-15 overflow-hidden", error && "!border-destructive")}
                    disableDebounce
                    noProvider
                    syncWithInitialValueChanges
                    disabled={!onChange}
                    state={onChange ? undefined : "readOnly"}
                    editorProps={{
                        codeOnly: true,
                        language: format,
                        showLineNumbers: true,
                        disableLongText: true,
                    }}
                />
            </EditorProvider>
            {error ? <CodeErrorLine error={error} format={format} /> : null}
        </div>
    )
}
