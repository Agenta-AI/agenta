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
 * A field as JSON or YAML, with the root editor's rules: the typed text stays, it reaches the
 * draft only when it parses, and the text is replaced only when the value changes from outside.
 * Text that does not parse shows the error line, and the field keeps its last valid value.
 * `onChange` gets the parsed value and the typed text.
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
    const display = useMemo(() => toCodeString(value, format), [value, format])
    const [text, setText] = useState(display)
    const [error, setError] = useState<CodeParseError | null>(null)
    const typed = useRef(display)

    useEffect(() => {
        if (textMatchesValue(typed.current, format, value)) return
        typed.current = display
        setText(display)
        setError(null)
    }, [display, format, value])

    const handleChange = useCallback(
        (next: string) => {
            if (!onChange) return
            typed.current = next
            setText(next)
            const problem = codeParseError(next, format)
            setError(problem)
            if (problem) return
            if (textMatchesValue(next, format, value)) return
            onChange(parseCodeString<unknown>(next, format, value), next)
        },
        [format, onChange, value],
    )

    const editorId = `testcase-field-${format}-${id}`
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <EditorProvider key={editorId} codeOnly language={format} showToolbar={false}>
                <SharedEditor
                    key={`${editorId}-shared`}
                    initialValue={text}
                    handleChange={onChange ? handleChange : undefined}
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
