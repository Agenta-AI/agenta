import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactNode,
} from "react"

import type {EvaluatorFeedbackSchema} from "@agenta/entities/workflow"
import {
    NUM_OPS,
    STRING_EQU_AND_CONTAINS_OPS,
    STRING_EQU_OPS,
    type FilterConditions,
    type FilterValue,
} from "@agenta/observability"
import type {
    AnnotationFeedbackCondition,
    AnnotationFeedbackValueType,
    AnnotationFilterValue,
} from "@agenta/observability/filters"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {
    cn,
    Combobox,
    Input,
    Popover,
    PopoverAnchor,
    PopoverContent,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    selectTriggerVariants,
    type ComboboxOption,
} from "@agenta/ui/ui"
import {CaretDownIcon, CheckIcon, PlusIcon, TrashIcon, XIcon} from "@phosphor-icons/react"

/**
 * AnnotationFilterRow — the evaluator + feedback sub-row of the observability filter dialog,
 * ported off antd from `oss/src/components/Filters/Filters.tsx` (lines 938–1283 plus the JSX at
 * 1560–1611 and 1763–1907 those handlers drive).
 *
 * LAYOUT IS THE CALLER'S. The original renders in two places: the evaluator control sits inline
 * on the field/operator line, the feedback control on a second line below it. So the two halves
 * are exported separately (`AnnotationEvaluatorControl`, `AnnotationFeedbackControl`) and
 * `AnnotationFilterRow` is only the stacked convenience composition. Everything the row needs
 * from the dialog — the row's annotation value, an `onChange`, the evaluator list, the feedback
 * catalogue — is a prop; this file reads no atoms and knows nothing about `FilterItem`.
 *
 * VALUE CONTRACT. `onChange(undefined)` means "this row's value is now empty" — the dialog
 * stores `[]`; `onChange(v)` means store `[v]`. That mirrors the original `setAnnotationValue`,
 * which is also where `feedback.valueType` gets its `"string"` default.
 */

/** Scalars the backend accepts for a feedback comparison. */
export type AnnotationFeedbackScalar = string | number | boolean

/** The engine types `AnnotationFeedbackCondition["value"]` as `FilterValue`; keep them aliased. */
export type AnnotationFeedbackValue = FilterValue

/** One evaluator output metric, flattened across evaluators. */
export interface AnnotationFeedbackOption {
    label: string
    value: string
    evaluatorSlug: string
    evaluatorLabel: string
    type: AnnotationFeedbackValueType
}

export interface AnnotationEvaluatorOption {
    label: string
    value: string
}

// ============================================================================
// OPERATOR SETS — composed from @agenta/observability, never redefined here
// ============================================================================

export const ALL_FEEDBACK_OPERATOR_OPTIONS: {value: FilterConditions; label: string}[] = [
    ...STRING_EQU_AND_CONTAINS_OPS,
    ...NUM_OPS,
]

const ALL_FEEDBACK_OPERATOR_VALUES = new Set<FilterConditions>(
    ALL_FEEDBACK_OPERATOR_OPTIONS.map((opt) => opt.value),
)

const NUMERIC_FEEDBACK_OPERATOR_VALUES = new Set<FilterConditions>(NUM_OPS.map((opt) => opt.value))

const FEEDBACK_VALUE_TYPE_OPTIONS: {value: AnnotationFeedbackValueType; label: string}[] = [
    {label: "Text", value: "string"},
    {label: "Number", value: "number"},
    {label: "Boolean", value: "boolean"},
]

// ============================================================================
// PURE HELPERS
// ============================================================================

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined

const isFeedbackScalar = (value: unknown): value is AnnotationFeedbackScalar =>
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"

/** JSON-schema `type` (and `items.type` for arrays) → the value type the row edits. */
export const deriveFeedbackValueType = (schema: unknown): AnnotationFeedbackValueType => {
    const record = asRecord(schema)
    const type = record?.type
    if (type === "number" || type === "integer") return "number"
    if (type === "boolean") return "boolean"
    if (type === "array") {
        const itemType = asRecord(record?.items)?.type
        if (itemType === "number" || itemType === "integer") return "number"
        if (itemType === "boolean") return "boolean"
    }
    return "string"
}

/** Flattens `evaluatorFeedbackSchemasAtom` into the option catalogue the row consumes. */
export const buildAnnotationFeedbackOptions = (
    schemas: EvaluatorFeedbackSchema[],
): AnnotationFeedbackOption[] => {
    const options: AnnotationFeedbackOption[] = []
    schemas.forEach((evaluator) => {
        Object.entries(evaluator.properties).forEach(([key, schema]) => {
            const title = asRecord(schema)?.title
            options.push({
                label: typeof title === "string" ? title : key,
                value: key,
                evaluatorSlug: evaluator.slug ?? "",
                evaluatorLabel: evaluator.name || evaluator.slug || "",
                type: deriveFeedbackValueType(schema),
            })
        })
    })
    return options
}

/** Keeps the first option per feedback key (the "any evaluator" list). */
export const dedupeAnnotationFeedbackOptions = (
    options: AnnotationFeedbackOption[],
): AnnotationFeedbackOption[] => {
    const byKey = new Map<string, AnnotationFeedbackOption>()
    for (const option of options) if (!byKey.has(option.value)) byKey.set(option.value, option)
    return Array.from(byKey.values())
}

const coerceNumericFeedbackValue = (input: unknown): string | number | undefined => {
    if (typeof input === "number") return Number.isFinite(input) ? input : undefined
    if (typeof input === "string") {
        const trimmed = input.trim()
        if (!trimmed) return ""
        const numericPattern = /^-?(?:\d+|\d*\.\d+)$/
        return numericPattern.test(trimmed) ? Number(trimmed) : input
    }
    return undefined
}

/** `"[1, 2]"` → `[1, 2]`; anything else (or a non-scalar member) stays a plain string. */
const parseFeedbackArrayInput = (input: string): AnnotationFeedbackScalar[] | undefined => {
    const trimmed = input.trim()
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return undefined
    try {
        const parsed: unknown = JSON.parse(trimmed)
        if (!Array.isArray(parsed)) return undefined
        return parsed.every(isFeedbackScalar) ? parsed : undefined
    } catch {
        return undefined
    }
}

const ensureFeedbackOperator = (
    type: AnnotationFeedbackValueType,
    current?: FilterConditions,
): FilterConditions => {
    if (current && ALL_FEEDBACK_OPERATOR_VALUES.has(current)) return current
    const fallback = type === "number" ? NUM_OPS[0]?.value : STRING_EQU_OPS[0]?.value
    return fallback ?? ""
}

// ============================================================================
// SHARED PROPS
// ============================================================================

export interface AnnotationFilterRowProps {
    /** The row's annotation value (the dialog's `value[0]`), or undefined when empty. */
    value: AnnotationFilterValue | undefined
    /** `undefined` → the dialog clears the row value (`[]`); otherwise store `[next]`. */
    onChange: (next: AnnotationFilterValue | undefined) => void
    /** Called when removing the last sub-condition should delete the whole filter row. */
    onRemoveRow: () => void
    /** Evaluators to choose from (`{label: name, value: slug}`). */
    evaluatorOptions: AnnotationEvaluatorOption[]
    /** Every evaluator output metric; the row scopes it by the selected evaluator itself. */
    feedbackOptions: AnnotationFeedbackOption[]
    disabled?: boolean
    className?: string
    /** Portal target for the dropdown panels (pass the dialog element to keep them inside it). */
    container?: HTMLElement | null
}

// ============================================================================
// HOOK — every derivation and handler, layout-free
// ============================================================================

export interface AnnotationFilterRowState {
    isEvaluatorActive: boolean
    isFeedbackActive: boolean
    feedback: AnnotationFeedbackCondition | undefined
    feedbackValueType: AnnotationFeedbackValueType
    /** Feedback options scoped to the selected evaluator (deduped when there is none). */
    availableFeedbackOptions: AnnotationFeedbackOption[]
    /** `availableFeedbackOptions` plus already-selected and currently-typed custom keys. */
    feedbackOptionsForSelect: {label: string; value: string}[]
    feedbackFieldValueForSelect: string | string[] | undefined
    /** The feedback value rendered in the text box (arrays/objects as JSON). */
    feedbackValueRaw: string
    feedbackFieldSearch: string
    setFeedbackFieldSearch: (query: string) => void
    addEvaluator: () => void
    addFeedback: () => void
    handleEvaluatorChange: (value?: string) => void
    handleFeedbackFieldChange: (value: string | string[]) => void
    handleFeedbackOperatorChange: (operator: FilterConditions) => void
    handleFeedbackTypeChange: (type: AnnotationFeedbackValueType) => void
    handleFeedbackValueChange: (raw: AnnotationFeedbackScalar) => void
    removeEvaluator: () => void
    removeFeedback: () => void
}

export function useAnnotationFilterRow({
    value,
    onChange,
    onRemoveRow,
    feedbackOptions,
}: Pick<
    AnnotationFilterRowProps,
    "value" | "onChange" | "onRemoveRow" | "feedbackOptions"
>): AnnotationFilterRowState {
    // Free text typed into the feedback-field picker. Lets the user name a metric even when the
    // evaluator has no output schema to suggest options.
    const [feedbackFieldSearch, setFeedbackFieldSearch] = useState("")

    const feedback = value?.feedback
    const isEvaluatorActive = value ? "evaluator" in value : false
    const isFeedbackActive = value ? "feedback" in value : false

    const setAnnotationValue = useCallback(
        (
            updater: (prev: AnnotationFilterValue | undefined) => AnnotationFilterValue | undefined,
        ) => {
            const next = updater(value ? {...value} : undefined)
            if (!next || Object.keys(next).length === 0) {
                onChange(undefined)
                return
            }

            const valueToStore: AnnotationFilterValue = {...next}
            if (valueToStore.feedback) {
                const cleanedFeedback = {...valueToStore.feedback}
                if (cleanedFeedback.valueType === undefined) cleanedFeedback.valueType = "string"
                valueToStore.feedback = cleanedFeedback
            }

            onChange(valueToStore)
        },
        [onChange, value],
    )

    const availableFeedbackOptions = useMemo(() => {
        if (value?.evaluator) {
            const filtered = feedbackOptions.filter(
                (option) => option.evaluatorSlug === value.evaluator,
            )
            // Keep the currently selected key visible even if it is not part of `filtered`.
            const selectedKey = Array.isArray(feedback?.field)
                ? feedback?.field[0]
                : feedback?.field
            const selected = selectedKey
                ? feedbackOptions.find((option) => option.value === selectedKey)
                : undefined
            if (selected && !filtered.some((option) => option.value === selected.value))
                return [selected, ...filtered]
            return filtered
        }
        // No evaluator — show deduped feedback names across all evaluators.
        return dedupeAnnotationFeedbackOptions(feedbackOptions)
    }, [feedback?.field, feedbackOptions, value?.evaluator])

    const selectedFeedbackKey = Array.isArray(feedback?.field)
        ? feedback?.field[0]
        : feedback?.field
    const selectedFeedbackOption = selectedFeedbackKey
        ? availableFeedbackOptions.find((option) => option.value === selectedFeedbackKey)
        : undefined

    const feedbackValueType: AnnotationFeedbackValueType =
        feedback?.valueType ?? selectedFeedbackOption?.type ?? "string"

    const feedbackFieldValueForSelect = useMemo(() => {
        const field = feedback?.field
        if (Array.isArray(field)) return field
        return field ?? undefined
    }, [feedback?.field])

    const feedbackOptionsForSelect = useMemo(() => {
        const options = availableFeedbackOptions.map((option) => ({
            label: option.label,
            value: option.value,
        }))
        const known = new Set(options.map((option) => option.value))

        // Keep already-selected custom keys visible with a label.
        const selectedFields = Array.isArray(feedbackFieldValueForSelect)
            ? feedbackFieldValueForSelect
            : feedbackFieldValueForSelect
              ? [feedbackFieldValueForSelect]
              : []
        for (const selected of selectedFields) {
            if (selected && !known.has(selected)) {
                options.push({label: selected, value: selected})
                known.add(selected)
            }
        }

        // Surface the typed text as a selectable option, so evaluators without an output schema
        // can still be given a feedback name. Enter or click commits it.
        const typed = feedbackFieldSearch.trim()
        if (typed && !known.has(typed)) options.unshift({label: `${typed} (custom)`, value: typed})

        return options
    }, [availableFeedbackOptions, feedbackFieldSearch, feedbackFieldValueForSelect])

    const feedbackValueRaw = useMemo(() => {
        const raw = feedback?.value
        if (Array.isArray(raw) || (raw && typeof raw === "object")) {
            try {
                return JSON.stringify(raw)
            } catch {
                return ""
            }
        }
        if (raw === undefined || raw === null) return ""
        if (typeof raw === "string") return raw
        if (typeof raw === "number") return String(raw)
        if (typeof raw === "boolean") return raw ? "true" : "false"
        return ""
    }, [feedback?.value])

    const addEvaluator = useCallback(
        () => setAnnotationValue((prev) => ({...(prev ?? {}), evaluator: ""})),
        [setAnnotationValue],
    )

    const addFeedback = useCallback(
        () =>
            setAnnotationValue((prev) => ({
                ...(prev ?? {}),
                feedback: {
                    field: undefined,
                    operator: ensureFeedbackOperator("string"),
                    value: "",
                    valueType: "string",
                },
            })),
        [setAnnotationValue],
    )

    const handleEvaluatorChange = useCallback(
        (next?: string) => {
            setAnnotationValue((prev) => {
                const base: AnnotationFilterValue = {...(prev ?? {})}

                if (!next) {
                    // Removing the evaluator keeps the feedback — it now spans any evaluator.
                    delete base.evaluator
                    return Object.keys(base).length ? base : undefined
                }

                base.evaluator = next

                if (base.feedback?.field) {
                    const allowed = new Set(
                        feedbackOptions
                            .filter((option) => option.evaluatorSlug === next)
                            .map((option) => option.value),
                    )
                    if (Array.isArray(base.feedback.field)) {
                        const kept = base.feedback.field.filter((key) => allowed.has(key))
                        base.feedback = {...base.feedback, field: kept[0] ?? undefined}
                    } else if (!allowed.has(base.feedback.field)) {
                        base.feedback = {...base.feedback, field: undefined}
                    }
                }

                return base
            })
        },
        [feedbackOptions, setAnnotationValue],
    )

    const handleFeedbackFieldChange = useCallback(
        (next: string | string[]) => {
            setAnnotationValue((prev) => {
                const base: AnnotationFilterValue = {...(prev ?? {})}
                const nextFeedback: AnnotationFeedbackCondition = {...(base.feedback ?? {})}

                // A selected evaluator narrows the row to a single feedback key.
                const nextField: string | string[] = value?.evaluator
                    ? Array.isArray(next)
                        ? next[0]
                        : next
                    : next

                const sampleKey = Array.isArray(nextField) ? nextField[0] : nextField
                const option = availableFeedbackOptions.find((opt) => opt.value === sampleKey)
                const nextType = option ? option.type : (nextFeedback.valueType ?? "string")

                nextFeedback.field = nextField
                nextFeedback.valueType = nextType
                nextFeedback.operator = ensureFeedbackOperator(nextType, nextFeedback.operator)
                nextFeedback.value = nextType === "boolean" ? true : ""

                base.feedback = nextFeedback
                return base
            })
        },
        [availableFeedbackOptions, setAnnotationValue, value?.evaluator],
    )

    const handleFeedbackOperatorChange = useCallback(
        (operator: FilterConditions) => {
            setAnnotationValue((prev) => {
                const base: AnnotationFilterValue = {...(prev ?? {})}
                const nextFeedback: AnnotationFeedbackCondition = {
                    ...(base.feedback ?? {}),
                    operator,
                }

                if (NUMERIC_FEEDBACK_OPERATOR_VALUES.has(operator)) {
                    nextFeedback.valueType = "number"
                    const coerced = coerceNumericFeedbackValue(nextFeedback.value)
                    nextFeedback.value = coerced === undefined ? "" : coerced
                }

                base.feedback = nextFeedback
                return base
            })
        },
        [setAnnotationValue],
    )

    const handleFeedbackTypeChange = useCallback(
        (type: AnnotationFeedbackValueType) => {
            setAnnotationValue((prev) => {
                const base: AnnotationFilterValue = {...(prev ?? {})}
                const nextFeedback: AnnotationFeedbackCondition = {...(base.feedback ?? {})}
                nextFeedback.valueType = type
                nextFeedback.operator = ensureFeedbackOperator(type, nextFeedback.operator)
                nextFeedback.value = type === "boolean" ? true : ""
                base.feedback = nextFeedback
                return base
            })
        },
        [setAnnotationValue],
    )

    const handleFeedbackValueChange = useCallback(
        (raw: AnnotationFeedbackScalar) => {
            setAnnotationValue((prev) => {
                const base: AnnotationFilterValue = {...(prev ?? {})}
                const current: AnnotationFeedbackCondition = {...(base.feedback ?? {})}

                const type = current.valueType ?? "string"
                let next: AnnotationFeedbackValue | undefined

                if (typeof raw === "string") next = parseFeedbackArrayInput(raw)

                if (next === undefined) {
                    if (type === "number") {
                        if (typeof raw === "number") {
                            next = Number.isFinite(raw) ? raw : current.value
                        } else {
                            const coerced = coerceNumericFeedbackValue(raw)
                            next = coerced === undefined ? "" : coerced
                        }
                    } else if (type === "boolean") {
                        if (typeof raw === "boolean") {
                            next = raw
                        } else {
                            const asText = String(raw).trim().toLowerCase()
                            next = asText === "true" ? true : asText === "false" ? false : undefined
                        }
                    } else if (typeof raw === "string") {
                        next = raw
                    } else {
                        next = String(raw)
                    }
                }

                base.feedback = {...current, value: next}
                return base
            })
        },
        [setAnnotationValue],
    )

    const removeEvaluator = useCallback(() => {
        setAnnotationValue((prev) => {
            if (!prev?.feedback) {
                onRemoveRow()
                return undefined
            }
            const next = {...prev}
            delete next.evaluator
            return Object.keys(next).length ? next : undefined
        })
    }, [onRemoveRow, setAnnotationValue])

    const removeFeedback = useCallback(() => {
        setAnnotationValue((prev) => {
            if (!prev?.feedback) return prev

            if (!prev.evaluator) {
                onRemoveRow()
                return undefined
            }
            const next = {...prev}
            delete next.feedback
            return Object.keys(next).length ? next : undefined
        })
    }, [onRemoveRow, setAnnotationValue])

    return {
        isEvaluatorActive,
        isFeedbackActive,
        feedback,
        feedbackValueType,
        availableFeedbackOptions,
        feedbackOptionsForSelect,
        feedbackFieldValueForSelect,
        feedbackValueRaw,
        feedbackFieldSearch,
        setFeedbackFieldSearch,
        addEvaluator,
        addFeedback,
        handleEvaluatorChange,
        handleFeedbackFieldChange,
        handleFeedbackOperatorChange,
        handleFeedbackTypeChange,
        handleFeedbackValueChange,
        removeEvaluator,
        removeFeedback,
    }
}

// ============================================================================
// FEEDBACK-FIELD PICKER — searchable single/multi select
// ============================================================================

/**
 * The one control with no primitive to reuse: `@agenta/ui/ui` has Select (single, no search) and
 * Combobox (single, search, but no `onSearch` seam), and the "any evaluator" row needs a
 * MULTI-select whose live query the caller can read to synthesise a custom option. Kept private
 * here rather than grown into `@agenta/ui` — that package is another track's to touch.
 */
interface FeedbackFieldPickerProps {
    options: {label: string; value: string}[]
    value: string | string[] | undefined
    multiple: boolean
    placeholder: string
    searchValue: string
    onSearchChange: (query: string) => void
    onChange: (next: string | string[]) => void
    disabled?: boolean
    className?: string
    container?: HTMLElement | null
}

function FeedbackFieldPicker({
    options,
    value,
    multiple,
    placeholder,
    searchValue,
    onSearchChange,
    onChange,
    disabled,
    className,
    container,
}: FeedbackFieldPickerProps) {
    const [open, setOpen] = useState(false)
    const [activeIndex, setActiveIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const rid = useId()
    const listId = `${rid}-listbox`

    const selectedValues = useMemo(
        () => (Array.isArray(value) ? value : value ? [value] : []),
        [value],
    )
    const labelFor = useCallback(
        (optionValue: string) =>
            options.find((option) => option.value === optionValue)?.label ?? optionValue,
        [options],
    )

    const filtered = useMemo(() => {
        const query = searchValue.trim().toLowerCase()
        if (!query) return options
        return options.filter(
            (option) =>
                option.label.toLowerCase().includes(query) ||
                option.value.toLowerCase().includes(query),
        )
    }, [options, searchValue])

    useEffect(() => setActiveIndex(0), [searchValue, open])

    const closeMenu = useCallback(() => {
        setOpen(false)
        onSearchChange("")
    }, [onSearchChange])

    const commit = useCallback(
        (option: {label: string; value: string}) => {
            if (multiple) {
                const next = selectedValues.includes(option.value)
                    ? selectedValues.filter((entry) => entry !== option.value)
                    : [...selectedValues, option.value]
                onChange(next)
                onSearchChange("")
                inputRef.current?.focus()
                return
            }
            onChange(option.value)
            closeMenu()
        },
        [closeMenu, multiple, onChange, onSearchChange, selectedValues],
    )

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            if (!open) {
                setOpen(true)
                return
            }
            if (!filtered.length) return
            const direction = event.key === "ArrowDown" ? 1 : -1
            setActiveIndex((index) => (index + direction + filtered.length) % filtered.length)
        } else if (event.key === "Enter") {
            event.preventDefault()
            const option = filtered[activeIndex]
            if (option) commit(option)
        } else if (event.key === "Escape") {
            if (open) {
                event.preventDefault()
                closeMenu()
            }
        } else if (event.key === "Backspace" && !searchValue && multiple && selectedValues.length) {
            onChange(selectedValues.slice(0, -1))
        }
    }

    const singleSelectedLabel = !multiple && selectedValues[0] ? labelFor(selectedValues[0]) : ""

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                if (next) setOpen(true)
                else closeMenu()
            }}
        >
            <PopoverAnchor asChild>
                <div
                    className={cn(
                        selectTriggerVariants({}),
                        "h-auto min-h-control cursor-text flex-wrap gap-1 py-[2px]",
                        disabled && "pointer-events-none",
                        className,
                    )}
                    onMouseDown={() => {
                        if (disabled) return
                        setOpen(true)
                        inputRef.current?.focus()
                    }}
                >
                    {multiple
                        ? selectedValues.map((entry) => (
                              <span
                                  key={entry}
                                  className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1 text-field-sm"
                              >
                                  <span className="truncate">{labelFor(entry)}</span>
                                  <button
                                      type="button"
                                      aria-label={`Remove ${labelFor(entry)}`}
                                      className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-placeholder hover:text-foreground"
                                      onMouseDown={(event) => {
                                          event.preventDefault()
                                          event.stopPropagation()
                                          onChange(
                                              selectedValues.filter((other) => other !== entry),
                                          )
                                      }}
                                  >
                                      <XIcon size={10} />
                                  </button>
                              </span>
                          ))
                        : null}
                    {!multiple && singleSelectedLabel && !searchValue ? (
                        <span className="truncate">{singleSelectedLabel}</span>
                    ) : null}
                    <input
                        ref={inputRef}
                        role="combobox"
                        aria-expanded={open}
                        aria-controls={listId}
                        aria-autocomplete="list"
                        aria-label={placeholder}
                        disabled={disabled}
                        value={searchValue}
                        placeholder={selectedValues.length ? "" : placeholder}
                        onChange={(event) => {
                            onSearchChange(event.target.value)
                            setOpen(true)
                        }}
                        onKeyDown={onKeyDown}
                        className="min-w-[24px] flex-1 border-0 bg-transparent p-0 font-[inherit] text-field-md text-foreground outline-none placeholder:text-placeholder"
                    />
                    <CaretDownIcon size={12} className="shrink-0 text-placeholder" />
                </div>
            </PopoverAnchor>
            <PopoverContent
                container={container}
                align="start"
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="max-h-60 min-w-[var(--radix-popover-trigger-width)] overflow-auto p-1"
            >
                <div role="listbox" id={listId} aria-multiselectable={multiple}>
                    {filtered.length === 0 ? (
                        <div className="px-3 py-1 text-field-md text-placeholder">No results</div>
                    ) : (
                        filtered.map((option, index) => {
                            const selected = selectedValues.includes(option.value)
                            return (
                                <div
                                    key={option.value}
                                    role="option"
                                    aria-selected={selected}
                                    data-active={index === activeIndex}
                                    onMouseEnter={() => setActiveIndex(index)}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => commit(option)}
                                    className={cn(
                                        "box-border flex min-h-control cursor-pointer items-center justify-between gap-2 rounded-control-sm px-3 py-1 text-field-md",
                                        index === activeIndex && !selected && "bg-muted",
                                        selected && "bg-controlItemBgActive font-semibold",
                                    )}
                                >
                                    <span className="truncate">{option.label}</span>
                                    {selected ? (
                                        <CheckIcon size={12} className="shrink-0 text-primary" />
                                    ) : null}
                                </div>
                            )
                        })
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}

// ============================================================================
// LABEL + BUTTONS
// ============================================================================

/** Secondary inline label ("Where", "That", "Feedback") — antd `Typography.Text type="secondary"`. */
export const AnnotationFilterLabel = ({
    children,
    className,
}: {
    children: ReactNode
    className?: string
}) => <span className={cn("whitespace-nowrap text-colorTextSecondary", className)}>{children}</span>

const AddFeedbackButton = ({onClick, disabled}: {onClick: () => void; disabled?: boolean}) => (
    <EnhancedButton type="text" icon={<PlusIcon size={14} />} onClick={onClick} disabled={disabled}>
        Add Feedback
    </EnhancedButton>
)

// ============================================================================
// EVALUATOR CONTROL — renders inline on the field/operator line
// ============================================================================

export function AnnotationEvaluatorControl(props: AnnotationFilterRowProps) {
    const {value, evaluatorOptions, disabled, className, container} = props
    const {
        isEvaluatorActive,
        isFeedbackActive,
        addEvaluator,
        addFeedback,
        handleEvaluatorChange,
        removeEvaluator,
    } = useAnnotationFilterRow(props)

    const comboboxOptions: ComboboxOption[] = useMemo(
        () =>
            evaluatorOptions.map((option) => ({
                value: option.value,
                label: option.label,
                searchValue: option.label,
            })),
        [evaluatorOptions],
    )

    if (!isEvaluatorActive) {
        return (
            <div className={cn("flex items-center gap-2", className)}>
                <EnhancedButton
                    type="text"
                    icon={<PlusIcon size={14} />}
                    onClick={addEvaluator}
                    disabled={disabled}
                >
                    Add Evaluator
                </EnhancedButton>
                {!isFeedbackActive ? (
                    <AddFeedbackButton onClick={addFeedback} disabled={disabled} />
                ) : null}
            </div>
        )
    }

    return (
        <div className={cn("flex w-full items-center gap-2", className)}>
            <Combobox
                className="w-[220px] flex-1"
                options={comboboxOptions}
                value={value?.evaluator || undefined}
                onChange={handleEvaluatorChange}
                placeholder="Evaluator"
                aria-label="Evaluator"
                allowClear
                disabled={disabled}
                container={container}
            />
            <EnhancedButton
                type="link"
                icon={<TrashIcon size={14} />}
                onClick={removeEvaluator}
                disabled={disabled}
                aria-label="Remove evaluator"
            />
        </div>
    )
}

// ============================================================================
// FEEDBACK CONTROL — renders on its own line below the field/operator line
// ============================================================================

export function AnnotationFeedbackControl(props: AnnotationFilterRowProps) {
    const {value, disabled, className, container} = props
    const {
        isEvaluatorActive,
        isFeedbackActive,
        feedback,
        feedbackValueType,
        feedbackOptionsForSelect,
        feedbackFieldValueForSelect,
        feedbackValueRaw,
        feedbackFieldSearch,
        setFeedbackFieldSearch,
        addFeedback,
        handleFeedbackFieldChange,
        handleFeedbackOperatorChange,
        handleFeedbackTypeChange,
        handleFeedbackValueChange,
        removeFeedback,
    } = useAnnotationFilterRow(props)

    if (!isEvaluatorActive && !isFeedbackActive) return null

    if (!isFeedbackActive)
        return (
            <div className={className}>
                <AddFeedbackButton onClick={addFeedback} disabled={disabled} />
            </div>
        )

    const booleanValue = feedback?.value === false ? "false" : "true"

    return (
        <div className={cn("flex w-full items-center gap-2", className)}>
            <AnnotationFilterLabel>Feedback</AnnotationFilterLabel>

            <FeedbackFieldPicker
                className="w-[180px]"
                options={feedbackOptionsForSelect}
                value={feedbackFieldValueForSelect}
                multiple={!value?.evaluator}
                placeholder={value?.evaluator ? "Feedback" : "Select one or more"}
                searchValue={feedbackFieldSearch}
                onSearchChange={setFeedbackFieldSearch}
                onChange={handleFeedbackFieldChange}
                disabled={disabled}
                container={container}
            />

            <Select
                value={feedback?.operator || ""}
                onValueChange={(next) => {
                    const option = ALL_FEEDBACK_OPERATOR_OPTIONS.find((opt) => opt.value === next)
                    if (option) handleFeedbackOperatorChange(option.value)
                }}
                disabled={disabled}
            >
                <SelectTrigger className="w-[80px]" aria-label="Feedback condition">
                    <SelectValue placeholder="Condition" />
                </SelectTrigger>
                <SelectContent container={container}>
                    {ALL_FEEDBACK_OPERATOR_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {feedbackValueType === "boolean" ? (
                <Select
                    value={booleanValue}
                    onValueChange={(next) => handleFeedbackValueChange(next === "true")}
                    disabled={disabled}
                >
                    <SelectTrigger className="flex-1" aria-label="Feedback value">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent container={container}>
                        <SelectItem value="true">true</SelectItem>
                        <SelectItem value="false">false</SelectItem>
                    </SelectContent>
                </Select>
            ) : (
                <Input
                    className="flex-1"
                    placeholder="Value"
                    aria-label="Feedback value"
                    value={feedbackValueRaw}
                    onChange={(event) => handleFeedbackValueChange(event.target.value)}
                    disabled={disabled}
                />
            )}

            <Select
                value={feedbackValueType}
                onValueChange={(next) => {
                    const option = FEEDBACK_VALUE_TYPE_OPTIONS.find((opt) => opt.value === next)
                    if (option) handleFeedbackTypeChange(option.value)
                }}
                disabled={disabled}
            >
                <SelectTrigger className="w-[100px]" aria-label="Feedback value type">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent container={container}>
                    {FEEDBACK_VALUE_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <EnhancedButton
                type="link"
                icon={<TrashIcon size={14} />}
                onClick={removeFeedback}
                disabled={disabled}
                aria-label="Remove feedback"
            />
        </div>
    )
}

// ============================================================================
// STACKED COMPOSITION — for callers that do not need the two halves apart
// ============================================================================

export function AnnotationFilterRow(props: AnnotationFilterRowProps) {
    const {className, ...rest} = props
    return (
        <div className={cn("flex w-full flex-col gap-2", className)}>
            <AnnotationEvaluatorControl {...rest} />
            <AnnotationFeedbackControl {...rest} />
        </div>
    )
}
