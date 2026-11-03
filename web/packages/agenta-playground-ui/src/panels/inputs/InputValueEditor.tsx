import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    FormView,
    coerceTextEdit,
    inferLogicalType,
    isChatMessagesArray,
    parseJsonEdit,
    parseYamlEdit,
    valueToDisplay,
    type ExpectedType,
    type LogicalType,
    type ViewType,
} from "@agenta/entity-ui/view-types"
import {ChatMessageList, type SimpleChatMessage} from "@agenta/ui/chat-message"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {Input, Switch, Textarea} from "@agenta/ui/ui"

export interface InputValueEditorProps {
    mode: ViewType
    /** The stored value. */
    value: unknown
    /** What the form, JSON and YAML views show: the stored value, or the schema's empty shape. */
    renderValue: unknown
    schema?: unknown
    expectedType?: ExpectedType
    editable: boolean
    templateFormat?: "mustache" | "curly" | "fstring" | "jinja2"
    /** Gets a native value: an object stays an object, a number stays a number. */
    onChange: (next: unknown) => void
}

const isEmptyValue = (value: unknown) => value === undefined || value === null || value === ""

/**
 * The body of one input card, picked by the view mode. Every edit goes out as a native value.
 * Text and code views keep what the user typed, so a half-typed JSON stays on screen and only
 * valid JSON reaches the test case.
 */
export const InputValueEditor = ({
    mode,
    value,
    renderValue,
    schema,
    expectedType,
    editable,
    templateFormat = "curly",
    onChange,
}: InputValueEditorProps) => {
    const storedType = useMemo<LogicalType>(() => inferLogicalType(value), [value])
    // A number field stays a number field while it is empty, so clearing it to type a new number
    // does not turn it into a text field that stores the new number as a string.
    const wasNumber = useRef(false)
    if (storedType === "number") wasNumber.current = true
    else if (!isEmptyValue(value)) wasNumber.current = false
    const isNumber =
        storedType === "number" ||
        (isEmptyValue(value) &&
            (wasNumber.current || expectedType === "number" || expectedType === "integer"))

    if (mode === "form") {
        // The form needs an object or an array at its root.
        const formValue: Record<string, unknown> | unknown[] = Array.isArray(renderValue)
            ? renderValue
            : renderValue !== null && typeof renderValue === "object"
              ? (renderValue as Record<string, unknown>)
              : {}
        return (
            <FormView value={formValue} editable={editable} onChange={onChange} schema={schema} />
        )
    }
    if (mode === "chat") {
        return (
            <ChatMessageList
                messages={isChatMessagesArray(value) ? (value as SimpleChatMessage[]) : []}
                onChange={onChange}
                disabled={!editable}
                enableTokens
                templateFormat={templateFormat}
                allowFileUpload={false}
            />
        )
    }
    if (mode === "json" || mode === "yaml") {
        return (
            <CodeEditor
                key={mode}
                mode={mode}
                value={renderValue}
                editable={editable}
                onChange={onChange}
            />
        )
    }
    if (isNumber && mode === "text") {
        return <NumberEditor value={value as number} editable={editable} onChange={onChange} />
    }
    if (storedType === "boolean" && mode === "text") {
        return (
            <Switch
                checked={Boolean(value)}
                disabled={!editable}
                onCheckedChange={onChange}
                aria-label="Value"
            />
        )
    }
    return (
        <TextEditor
            key={mode}
            mode={mode}
            value={value}
            storedType={storedType}
            editable={editable}
            onChange={onChange}
        />
    )
}

/** A buffer that follows the stored value when something else changes it (a refetch, a revert). */
const useBuffer = (shown: string) => {
    const [buffer, setBuffer] = useState(shown)
    useEffect(() => setBuffer(shown), [shown])
    return [buffer, setBuffer] as const
}

const TextEditor = ({
    mode,
    value,
    storedType,
    editable,
    onChange,
}: {
    mode: ViewType
    value: unknown
    storedType: LogicalType
    editable: boolean
    onChange: (next: unknown) => void
}) => {
    const [buffer, setBuffer] = useBuffer(useMemo(() => valueToDisplay(value, mode), [value, mode]))
    return (
        <Textarea
            variant="ghost"
            value={buffer}
            rows={2}
            disabled={!editable}
            placeholder="Enter a value"
            aria-label="Value"
            className="px-0"
            onChange={(event) => {
                setBuffer(event.target.value)
                onChange(coerceTextEdit(event.target.value, storedType))
            }}
        />
    )
}

const NumberEditor = ({
    value,
    editable,
    onChange,
}: {
    value: number | null | undefined
    editable: boolean
    onChange: (next: unknown) => void
}) => {
    const shown = value === null || value === undefined ? "" : String(value)
    const [buffer, setBuffer] = useState(shown)
    // Keep what the user typed ("1.", "-") unless the stored number differs from it.
    useEffect(() => setBuffer((typed) => (Number(typed) === value ? typed : shown)), [shown, value])
    return (
        <Input
            type="number"
            variant="ghost"
            value={buffer}
            disabled={!editable}
            placeholder="Enter number"
            aria-label="Value"
            className="max-w-xs px-0"
            onChange={(event) => {
                setBuffer(event.target.value)
                const typed = event.target.value
                onChange(typed === "" || Number.isNaN(Number(typed)) ? null : Number(typed))
            }}
        />
    )
}

const CodeEditor = ({
    mode,
    value,
    editable,
    onChange,
}: {
    mode: "json" | "yaml"
    value: unknown
    editable: boolean
    onChange: (next: unknown) => void
}) => {
    const [buffer, setBuffer] = useBuffer(useMemo(() => valueToDisplay(value, mode), [value, mode]))
    const handleChange = useCallback(
        (next: string) => {
            setBuffer(next)
            const parsed = mode === "json" ? parseJsonEdit(next) : parseYamlEdit(next)
            // Text that does not parse stays in the editor and never reaches the test case.
            if (parsed.ok) onChange(parsed.value)
        },
        [mode, onChange, setBuffer],
    )
    return (
        <SharedEditor
            initialValue={buffer}
            handleChange={editable ? handleChange : undefined}
            editorType="borderless"
            className="min-h-[60px] overflow-hidden !border-transparent !p-0"
            disableDebounce
            disabled={!editable}
            state={editable ? "filled" : "readOnly"}
            placeholder={mode === "json" ? "{}" : "Enter YAML"}
            editorProps={{
                codeOnly: true,
                language: mode,
                showLineNumbers: true,
                showToolbar: false,
                disableLongText: true,
            }}
        />
    )
}
