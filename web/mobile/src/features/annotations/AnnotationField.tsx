import {useEffect, useId, useRef, type KeyboardEvent, type ReactNode} from "react"

import {isEmptyValue, type AnnotationMetricField} from "@agenta/annotation"
import {COARSE_POINTER_QUERY, useWindowMatch} from "@agenta/ui/hooks"
import {
    Kbd,
    Segmented,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Textarea,
} from "@agenta/ui/ui"

import {AnnotationFieldLabel} from "./AnnotationFieldLabel"
import {AnnotationMultiSelect} from "./AnnotationMultiSelect"
import {AnnotationNumberField, numberStep} from "./AnnotationNumberField"
import {readStoredSize, writeStoredSize} from "./queueViewStorage"
import {focusNextField, optionIndexForKey, type FieldKeyKind} from "./useFieldFocus"

const BOOLEAN_OPTIONS = [
    {value: "true", label: "True"},
    {value: "false", label: "False"},
]
/** A value no option has, so the segmented control shows no choice instead of picking the first. */
const NO_CHOICE = ""
/** A single choice with more options than this stays a dropdown. */
const MAX_CHOICE_BUTTONS = 5
const NOTE_ROWS = 8

/**
 * An option's text with its number key, shown only while its field has the focus, and never on
 * touch (a coarse pointer), where there is usually no keyboard.
 */
const KeyedLabel = ({label, keyName}: {label: string; keyName: string | null}) => {
    const touch = useWindowMatch(COARSE_POINTER_QUERY)
    return keyName && !touch ? (
        <span className="inline-flex items-center gap-1.5">
            {label}
            <Kbd className="hidden group-focus-within/field:inline-flex">{keyName}</Kbd>
        </span>
    ) : (
        label
    )
}

/**
 * The field's frame in the queue: it takes the focus (`focus-ring-field`), shows its keys only
 * then, and hands a number key to `onKey`. Elsewhere the field draws as it is.
 */
const FieldFrame = ({
    fieldKeys,
    kind,
    optionCount,
    step,
    onKey,
    frameRef,
    children,
}: {
    fieldKeys: boolean
    kind: FieldKeyKind
    optionCount?: number
    step?: number
    onKey?: (event: KeyboardEvent<HTMLDivElement>) => void
    frameRef?: React.Ref<HTMLDivElement>
    children: ReactNode
}) =>
    fieldKeys ? (
        <div
            ref={frameRef}
            data-annotation-field
            data-field-kind={kind}
            data-field-options={optionCount}
            data-field-step={step}
            tabIndex={-1}
            onKeyDown={onKey}
            className="focus-ring-field group/field -mx-2 rounded-md border border-solid border-transparent px-2 py-1 outline-none"
        >
            {children}
        </div>
    ) : (
        <div ref={frameRef}>{children}</div>
    )

/** The note: 8 lines, and its corner drags it taller; the height is kept for this field. */
const NoteBox = ({
    id,
    value,
    readOnly,
    heightKey,
    onChange,
}: {
    id: string
    value: string
    readOnly: boolean
    heightKey?: string
    onChange: (value: string | null) => void
}) => {
    const ref = useRef<HTMLTextAreaElement>(null)
    useEffect(() => {
        const box = ref.current
        if (!box || !heightKey || typeof ResizeObserver === "undefined") return
        const stored = readStoredSize(heightKey)
        if (stored) box.style.height = `${stored}px`
        const initial = box.offsetHeight
        const observer = new ResizeObserver(() => {
            if (box.offsetHeight !== initial) writeStoredSize(heightKey, box.offsetHeight)
        })
        observer.observe(box)
        return () => observer.disconnect()
    }, [heightKey])
    return (
        <Textarea
            ref={ref}
            id={id}
            rows={NOTE_ROWS}
            placeholder="Enter a value"
            value={value}
            readOnly={readOnly}
            onChange={(event) => onChange(event.target.value || null)}
        />
    )
}

/**
 * One metric of an evaluator, drawn by its schema type: True and False, a number (with a slider
 * when the range is known), choice buttons (up to 5 options) or a select, a multi select, or the
 * note. Read only keeps the same look; the controls just stop taking input. With `fieldKeys` (the
 * queue) the field takes the focus, its number keys pick, and a pick moves the focus on.
 */
export const AnnotationField = ({
    fieldKey,
    field,
    readOnly = false,
    fieldKeys = false,
    heightKey,
    onChange,
}: {
    fieldKey: string
    field: AnnotationMetricField
    readOnly?: boolean
    fieldKeys?: boolean
    /** Where the note keeps its height in this browser. */
    heightKey?: string
    onChange: (value: unknown) => void
}) => {
    const id = useId()
    const frameRef = useRef<HTMLDivElement>(null)
    const type = Array.isArray(field.type) ? field.type[0] : field.type
    const value = field.value
    const canClear = !readOnly && !isEmptyValue(value)
    const clear = () => onChange(null)
    const keys = fieldKeys && !readOnly
    const pick = (next: unknown) => {
        onChange(next)
        if (keys) focusNextField(frameRef.current)
    }
    const keyPicker = (options: readonly unknown[]) => (event: KeyboardEvent<HTMLDivElement>) => {
        if (!keys || event.metaKey || event.ctrlKey || event.altKey) return
        const index = optionIndexForKey(event.key, options.length)
        if (index === null) return
        event.preventDefault()
        pick(options[index])
    }

    if (type === "boolean") {
        return (
            <FieldFrame
                fieldKeys={fieldKeys}
                kind="boolean"
                frameRef={frameRef}
                onKey={keyPicker([true, false])}
            >
                <AnnotationFieldLabel
                    label={fieldKey}
                    canClear={canClear}
                    onClear={clear}
                    trailing={
                        <div inert={readOnly}>
                            <Segmented
                                size="sm"
                                aria-label={fieldKey}
                                options={BOOLEAN_OPTIONS.map((option, index) => ({
                                    value: option.value,
                                    label: (
                                        <KeyedLabel
                                            label={option.label}
                                            keyName={keys ? String(index + 1) : null}
                                        />
                                    ),
                                }))}
                                value={typeof value === "boolean" ? String(value) : NO_CHOICE}
                                onChange={(next) => pick(next === "true")}
                            />
                        </div>
                    }
                />
            </FieldFrame>
        )
    }

    if (type === "number" || type === "integer" || type === "float") {
        const isInteger = type === "integer"
        const ranged = field.minimum !== undefined && field.maximum !== undefined
        return (
            <FieldFrame
                fieldKeys={fieldKeys}
                kind={ranged ? "slider" : "other"}
                step={numberStep(isInteger)}
                frameRef={frameRef}
            >
                <AnnotationNumberField
                    label={fieldKey}
                    value={typeof value === "number" ? value : null}
                    min={field.minimum}
                    max={field.maximum}
                    isInteger={isInteger}
                    readOnly={readOnly}
                    onChange={onChange}
                />
            </FieldFrame>
        )
    }

    const itemOptions = field.items?.enum
    if (type === "array" && itemOptions && itemOptions.length > 0) {
        const selected = (Array.isArray(value) ? value : isEmptyValue(value) ? [] : [value]).map(
            String,
        )
        return (
            <FieldFrame fieldKeys={fieldKeys} kind="other" frameRef={frameRef}>
                <div className="flex flex-col gap-1.5">
                    <AnnotationFieldLabel
                        label={fieldKey}
                        htmlFor={id}
                        canClear={canClear}
                        onClear={clear}
                    />
                    <div inert={readOnly}>
                        <AnnotationMultiSelect
                            id={id}
                            options={itemOptions.map(String)}
                            value={selected}
                            onChange={onChange}
                        />
                    </div>
                </div>
            </FieldFrame>
        )
    }

    const options = field.enum
    if (Array.isArray(field.type) && options && options.length > 0) {
        // The null option saves the text "null", as the old view did: a real null reads as "no
        // value" in the form, so it could never complete an item.
        const optionText = (option: unknown) =>
            option === null ? "none of the above" : String(option)
        const buttons = options.length <= MAX_CHOICE_BUTTONS
        return (
            <FieldFrame
                fieldKeys={fieldKeys}
                kind={buttons ? "choice" : "other"}
                optionCount={buttons ? options.length : undefined}
                frameRef={frameRef}
                onKey={buttons ? keyPicker(options.map(String)) : undefined}
            >
                <div className="flex flex-col gap-1.5">
                    <AnnotationFieldLabel
                        label={fieldKey}
                        htmlFor={buttons ? undefined : id}
                        canClear={canClear}
                        onClear={clear}
                    />
                    <div inert={readOnly}>
                        {buttons ? (
                            <Segmented
                                size="sm"
                                aria-label={fieldKey}
                                options={options.map((option, index) => ({
                                    value: String(option),
                                    label: (
                                        <KeyedLabel
                                            label={optionText(option)}
                                            keyName={keys ? String(index + 1) : null}
                                        />
                                    ),
                                }))}
                                value={isEmptyValue(value) ? NO_CHOICE : String(value)}
                                onChange={(next) => pick(String(next))}
                            />
                        ) : (
                            <Select
                                value={isEmptyValue(value) ? "" : String(value)}
                                onValueChange={onChange}
                            >
                                <SelectTrigger id={id} className="w-full">
                                    <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent>
                                    {options.map((option) => (
                                        <SelectItem key={String(option)} value={String(option)}>
                                            {optionText(option)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                </div>
            </FieldFrame>
        )
    }

    return (
        <FieldFrame fieldKeys={fieldKeys} kind="other" frameRef={frameRef}>
            <div className="flex flex-col gap-1.5">
                <AnnotationFieldLabel
                    label={fieldKey}
                    htmlFor={id}
                    canClear={canClear}
                    onClear={clear}
                />
                <NoteBox
                    id={id}
                    value={
                        typeof value === "string" ? value : isEmptyValue(value) ? "" : String(value)
                    }
                    readOnly={readOnly}
                    heightKey={heightKey}
                    onChange={onChange}
                />
            </div>
        </FieldFrame>
    )
}
