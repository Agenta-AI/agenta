import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react"

import {buildFormFieldsFromSchema, type FormFieldDescriptor} from "@agenta/shared/utils"
import {Editor} from "@agenta/ui/editor"
import {CaretLeft, CaretRight, Check, MinusCircle, Plus} from "@phosphor-icons/react"
import {
    Button,
    Collapse,
    DatePicker,
    Form,
    Input,
    InputNumber,
    Switch,
    Select,
    Tag,
    Typography,
} from "antd"
import type {FormInstance, InputRef} from "antd"

import {
    OTHER_ENUM_OPTION,
    commitCustomValue,
    enumOptionsOf,
    isOffOptionsValue,
    partitionCustomValues,
    resolveDigitSelection,
    selectOptionsWithOther,
    splitOtherFromSelection,
    toggleCardSelection,
    typeCustomValue,
    wantsChoiceCards,
    type EnumOption,
} from "./schemaFormOptions"

export interface SchemaFormHandle {
    getValues: () => Promise<Record<string, unknown>>
    /** Stepper mode: jump to the step holding this field (e.g. after a validation failure). */
    goToField?: (name: string | (string | number)[]) => void
}

interface Props {
    schema: Record<string, unknown> | null | undefined
    form: FormInstance
    disabled?: boolean
    jsonMode?: boolean
    /** Render optional fields inline instead of behind an "Optional (N)" collapse. */
    flat?: boolean
    /** Opt-in `format` handling (date/date-time/multiline/email/uri) — see BuildFormFieldsOptions. */
    formats?: boolean
    /** Opt-in: render enum fields with an "Other…" custom-value escape hatch (elicitation forms). */
    openEnums?: boolean
    /** Fires with ALL current values on any field change (e.g. draft persistence). */
    onValuesChange?: (values: Record<string, unknown>) => void
    /** One question at a time + a final review step (elicitation "x-ag-stepper" hint). */
    stepper?: boolean
}

const SchemaForm = forwardRef<SchemaFormHandle, Props>(
    (
        {schema, form, disabled, jsonMode, flat, formats, openEnums, onValuesChange, stepper},
        ref,
    ) => {
        const fields = useMemo(
            () =>
                buildFormFieldsFromSchema(schema, "", {
                    formats: !!formats,
                    openEnums: !!openEnums,
                }),
            [schema, formats, openEnums],
        )
        const requiredFields = useMemo(() => fields.filter((f) => f.required), [fields])
        // Stepper: fields stay MOUNTED and are CSS-hidden per step (unmounting would drop antd
        // registration — defaults and typed values would vanish from an untouched submit).
        const [step, setStep] = useState(0)
        const stepperOn = !!stepper && fields.length > 1
        const onReview = stepperOn && step >= fields.length
        const stepRefs = useRef<(HTMLDivElement | null)[]>([])
        const reviewRef = useRef<HTMLDivElement | null>(null)
        const prevStepRef = useRef(step)
        // On step CHANGE (never mount — the composer may own focus), focus the answer surface
        // so digits/arrows/typing land with zero Tab presses.
        useEffect(() => {
            if (!stepperOn || prevStepRef.current === step) return
            prevStepRef.current = step
            requestAnimationFrame(() => {
                const root = onReview ? reviewRef.current : stepRefs.current[step]
                root?.querySelector<HTMLElement>(
                    '[tabindex="0"], input:not([type="hidden"]), textarea',
                )?.focus()
            })
        }, [step, stepperOn, onReview])
        Form.useWatch([], form) // review rows re-render as answers change
        const optionalFields = useMemo(() => fields.filter((f) => !f.required), [fields])

        // JSON editor state
        const jsonRef = useRef("")
        const [jsonError, setJsonError] = useState<string | null>(null)

        // Sync form → JSON when entering JSON mode
        const lastFormSnapshot = useRef<string>("{}")
        const syncFormToJson = useCallback(() => {
            try {
                const values = form.getFieldsValue(true)
                const cleaned = cleanFormValues(values)
                const json = JSON.stringify(cleaned, null, 2)
                lastFormSnapshot.current = json
                jsonRef.current = json
                setJsonError(null)
            } catch {
                lastFormSnapshot.current = "{}"
                jsonRef.current = "{}"
            }
        }, [form])

        // When jsonMode turns on, snapshot form values
        const prevJsonMode = useRef(jsonMode)
        if (jsonMode && !prevJsonMode.current) {
            syncFormToJson()
        }
        prevJsonMode.current = jsonMode

        const handleJsonChange = useCallback(({textContent}: {textContent: string}) => {
            jsonRef.current = textContent
            try {
                JSON.parse(textContent)
                setJsonError(null)
            } catch (e) {
                setJsonError(e instanceof Error ? e.message : "Invalid JSON")
            }
        }, [])

        useImperativeHandle(
            ref,
            () => ({
                getValues: async () => {
                    if (jsonMode) {
                        const text = jsonRef.current
                        const parsed = JSON.parse(text)
                        if (typeof parsed !== "object" || parsed === null) {
                            throw new Error("Input must be a JSON object")
                        }
                        return parsed as Record<string, unknown>
                    } else {
                        const values = await form.validateFields()
                        return cleanFormValues(values)
                    }
                },
                goToField: (name) => {
                    const flatName = Array.isArray(name) ? name.join(".") : name
                    const i = fields.findIndex((f) => f.name === flatName)
                    if (i >= 0) setStep(i)
                },
            }),
            [jsonMode, form, fields],
        )

        if (fields.length === 0 && !jsonMode) {
            return (
                <Typography.Text type="secondary" className="text-xs">
                    No input parameters required.
                </Typography.Text>
            )
        }

        if (jsonMode) {
            return (
                <div className="flex flex-col gap-1">
                    <div className="rounded-lg border border-solid border-gray-300 dark:border-gray-700 overflow-hidden">
                        <Editor
                            initialValue={lastFormSnapshot.current}
                            onChange={handleJsonChange}
                            codeOnly
                            showToolbar={false}
                            language="json"
                            validationSchema={schema ?? undefined}
                            dimensions={{width: "100%", height: 280}}
                            disabled={disabled}
                        />
                    </div>
                    {jsonError && (
                        <Typography.Text type="danger" className="text-xs">
                            {jsonError}
                        </Typography.Text>
                    )}
                </div>
            )
        }

        return (
            <Form
                form={form}
                layout="vertical"
                disabled={disabled}
                requiredMark={false}
                // Raw values on purpose: cleanFormValues would recurse into (and destroy) dayjs
                // objects and JSON.parse typed strings — wrong for a draft snapshot.
                onValuesChange={onValuesChange ? (_, all) => onValuesChange(all) : undefined}
                className={
                    flat
                        ? "[&_.ant-form-item]:!mb-3 [&_.ant-form-item-label]:!pb-1 [&_.ant-form-item-label>label]:!h-auto [&_.ant-form-item-label>label]:!text-xs"
                        : "[&_.ant-form-item]:!mb-3"
                }
            >
                {/* No Enter-advance in the stepper: in chat, Enter means "send" (the composer
                    says ↵ Send) — overloading it to page a form is a conflicting affordance. */}
                {stepperOn ? (
                    <div
                        className="flex flex-col gap-2"
                        onKeyDown={(e) => {
                            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
                            // ⌘/Ctrl+←/→ pages deterministically from ANY focus context —
                            // inputs included. Plain arrows page only where nothing owns them
                            // (a caret or dropdown keeps its native arrow behavior).
                            const paging = e.metaKey || e.ctrlKey
                            if (!paging) {
                                const t = e.target as HTMLElement
                                if (
                                    t.tagName === "INPUT" ||
                                    t.tagName === "TEXTAREA" ||
                                    t.closest(".ant-select, .ant-picker")
                                )
                                    return
                            }
                            e.preventDefault()
                            e.stopPropagation()
                            if (e.key === "ArrowLeft" && step > 0) setStep(step - 1)
                            if (e.key === "ArrowRight" && !onReview) setStep(step + 1)
                        }}
                    >
                        {/* Segmented progress: multi-step-ness at a glance. */}
                        <div className="flex gap-1" aria-hidden>
                            {fields.map((f, i) => (
                                <span
                                    key={f.name}
                                    className={`h-0.5 flex-1 rounded-full ${
                                        i < (onReview ? fields.length : step + 1)
                                            ? "bg-[var(--ant-color-primary)]"
                                            : "bg-colorFillSecondary"
                                    }`}
                                />
                            ))}
                        </div>
                        <div className="flex items-start justify-between gap-3">
                            {/* Stepper promotes the active question to a header — field labels
                                are hidden below (hideLabel), this IS the question. */}
                            {onReview ? (
                                <Typography.Text className="!text-[13px] !font-semibold">
                                    Review answers
                                </Typography.Text>
                            ) : (
                                <div className="flex min-w-0 flex-col">
                                    <Typography.Text className="!text-[13px] !font-semibold">
                                        <span className="text-colorPrimary">{`${step + 1}. `}</span>
                                        {fields[step].label}
                                        {fields[step].required && (
                                            <span className="text-red-500 ml-1">*</span>
                                        )}
                                    </Typography.Text>
                                    {fields[step].description && (
                                        <Typography.Text
                                            type="secondary"
                                            className="!text-xs leading-snug"
                                        >
                                            {fields[step].description}
                                        </Typography.Text>
                                    )}
                                </div>
                            )}
                            <div className="flex shrink-0 items-center gap-0.5">
                                {!onReview && !fields[step].required && (
                                    <Button
                                        type="text"
                                        className="!h-6 !px-1.5 !text-[11px] opacity-60"
                                        onClick={() => {
                                            // Skip = no answer: clear the field (incl. a schema
                                            // default the user didn't endorse). setFieldValue
                                            // fires no onValuesChange — sync the draft or a
                                            // reload resurrects the skipped answer.
                                            form.setFieldValue(
                                                fields[step].name.split("."),
                                                undefined,
                                            )
                                            onValuesChange?.(form.getFieldsValue(true))
                                            setStep(step + 1)
                                        }}
                                    >
                                        Skip
                                    </Button>
                                )}
                                <Button
                                    type="text"
                                    aria-label="Previous question"
                                    className="!h-6 !w-6 !p-0 !text-colorPrimary"
                                    disabled={step === 0}
                                    onClick={() => setStep(step - 1)}
                                >
                                    <CaretLeft size={12} />
                                </Button>
                                <Typography.Text
                                    type="secondary"
                                    className="!text-[11px] tabular-nums"
                                >
                                    {`${Math.min(step + 1, fields.length)}/${fields.length}`}
                                </Typography.Text>
                                <Button
                                    type="text"
                                    aria-label={onReview ? "On review" : "Next question"}
                                    className="!h-6 !w-6 !p-0 !text-colorPrimary"
                                    disabled={onReview}
                                    onClick={() => setStep(step + 1)}
                                >
                                    <CaretRight size={12} />
                                </Button>
                            </div>
                        </div>
                        {fields.map((field, i) => (
                            <div
                                key={field.name}
                                ref={(el) => {
                                    stepRefs.current[i] = el
                                }}
                                className={step === i ? undefined : "hidden"}
                            >
                                <SchemaFormField
                                    field={field}
                                    hideLabel
                                    onAnswered={() =>
                                        window.setTimeout(
                                            () => setStep((s) => Math.min(s + 1, fields.length)),
                                            180,
                                        )
                                    }
                                />
                            </div>
                        ))}
                        {onReview && (
                            <div ref={reviewRef} className="flex flex-col gap-1">
                                {fields.map((field, i) => {
                                    const value = form.getFieldValue(field.name.split("."))
                                    const empty =
                                        value === undefined ||
                                        value === null ||
                                        value === "" ||
                                        (Array.isArray(value) && value.length === 0)
                                    return (
                                        <div
                                            key={field.name}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setStep(i)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") setStep(i)
                                            }}
                                            className="flex cursor-pointer items-center justify-between gap-3 rounded-md bg-colorFillQuaternary px-3 py-2 hover:bg-colorFillTertiary"
                                        >
                                            <Typography.Text type="secondary" className="!text-xs">
                                                {field.label}
                                            </Typography.Text>
                                            {empty && field.required ? (
                                                <Typography.Text type="danger" className="!text-xs">
                                                    Required
                                                </Typography.Text>
                                            ) : (
                                                <Typography.Text className="!text-xs max-w-[60%] truncate">
                                                    {formatReviewValue(field, value)}
                                                </Typography.Text>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {requiredFields.map((field) => (
                            <SchemaFormField key={field.name} field={field} />
                        ))}

                        {/* The collapse de-emphasizes optional EXTRAS below required fields; with no
                    required fields there is nothing to de-emphasize, so render inline. */}
                        {flat || requiredFields.length === 0
                            ? optionalFields.map((field) => (
                                  <SchemaFormField key={field.name} field={field} />
                              ))
                            : optionalFields.length > 0 && (
                                  <Collapse
                                      ghost
                                      size="small"
                                      className="!-mx-4 !mt-1"
                                      items={[
                                          {
                                              key: "optional",
                                              // Collapsed Form.Items must still register their
                                              // initialValues (schema defaults) — without forceRender an
                                              // untouched submit silently drops every collapsed default.
                                              forceRender: true,
                                              label: (
                                                  <Typography.Text
                                                      type="secondary"
                                                      className="text-xs"
                                                  >
                                                      Optional ({optionalFields.length})
                                                  </Typography.Text>
                                              ),
                                              children: optionalFields.map((field) => (
                                                  <SchemaFormField key={field.name} field={field} />
                                              )),
                                          },
                                      ]}
                                  />
                              )}
                    </>
                )}
            </Form>
        )
    },
)

SchemaForm.displayName = "SchemaForm"
export default SchemaForm

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively parse stringified JSON in nested form values */
function cleanFormValues(values: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined || value === null || value === "") continue
        if (typeof value === "string") {
            try {
                result[key] = JSON.parse(value)
            } catch {
                result[key] = value
            }
        } else if (Array.isArray(value)) {
            result[key] = value.map((item) => {
                if (typeof item === "object" && item !== null && !Array.isArray(item)) {
                    return cleanFormValues(item as Record<string, unknown>)
                }
                if (typeof item === "string") {
                    try {
                        return JSON.parse(item)
                    } catch {
                        return item
                    }
                }
                return item
            })
        } else if (typeof value === "object") {
            result[key] = cleanFormValues(value as Record<string, unknown>)
        } else {
            result[key] = value
        }
    }
    return result
}

// ---------------------------------------------------------------------------
// Field components
// ---------------------------------------------------------------------------

function FieldLabel({field}: {field: FormFieldDescriptor}) {
    return (
        <div className="flex flex-col leading-tight">
            <span>
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
            </span>
            {field.description && (
                <Typography.Text type="secondary" className="!text-[11px] font-normal leading-snug">
                    {field.description}
                </Typography.Text>
            )}
        </div>
    )
}

/** Enum control with an "Other…" entry that reveals a free-text input (elicitation escape hatch). */
function EnumWithOther({
    value,
    onChange,
    options,
    placeholder,
    allowClear,
    disabled,
}: {
    value?: string
    onChange?: (v: string | undefined) => void
    options: EnumOption[]
    placeholder?: string
    allowClear?: boolean
    disabled?: boolean
}) {
    const offOptions = isOffOptionsValue(value, options)
    const [otherMode, setOtherMode] = useState(offOptions)
    // An off-options value can also arrive AFTER mount (schema `default` via Form initialValue,
    // or a replayed draft) — it must open Other-mode with the text prefilled.
    useEffect(() => {
        if (isOffOptionsValue(value, options)) setOtherMode(true)
    }, [value, options])
    const selectValue = otherMode ? OTHER_ENUM_OPTION : offOptions ? undefined : value

    return (
        <div className="flex flex-col gap-2">
            <Select
                placeholder={placeholder}
                allowClear={allowClear}
                disabled={disabled}
                value={selectValue}
                onChange={(next) => {
                    if (next === OTHER_ENUM_OPTION) {
                        setOtherMode(true)
                        // No no-op change: emitting undefined here would fire the required rule
                        // the instant the user picks Other…, before they can type.
                        if (value !== undefined) onChange?.(undefined)
                    } else {
                        setOtherMode(false)
                        onChange?.(next)
                    }
                }}
                options={selectOptionsWithOther(options)}
            />
            {otherMode && (
                <Input
                    // Focus only when the user picked "Other…" (value just cleared) — a form
                    // mounting with an off-options default must not steal focus.
                    autoFocus={value == null}
                    disabled={disabled}
                    placeholder="Type your answer"
                    value={value ?? ""}
                    onChange={(e) => onChange?.(e.target.value || undefined)}
                />
            )}
        </div>
    )
}

/**
 * Multi-select with the same "Other…" escape hatch as EnumWithOther: picking Other… reveals a
 * text input that appends ONE custom chip (repeatable). Without options (a free string list),
 * it degrades to tags mode — plain typed entries. Off-options values (defaults, replays) render
 * as chips natively.
 */
function MultiEnumWithOther({
    value,
    onChange,
    options,
    placeholder,
    disabled,
}: {
    value?: string[]
    onChange?: (v: string[] | undefined) => void
    options: EnumOption[]
    placeholder?: string
    disabled?: boolean
}) {
    const [otherDraft, setOtherDraft] = useState<string | null>(null)
    const selected = value ?? []

    if (options.length === 0) {
        return (
            <Select
                mode="tags"
                placeholder={placeholder}
                disabled={disabled}
                value={selected}
                onChange={(next: string[]) => onChange?.(next.length ? next : undefined)}
                open={false}
                suffixIcon={null}
            />
        )
    }

    const commitDraft = () => {
        const commit = commitCustomValue(selected, otherDraft, true)
        setOtherDraft(null)
        if (commit.changed) onChange?.(commit.value as string[])
    }

    return (
        <div className="flex flex-col gap-2">
            <Select
                mode="multiple"
                placeholder={placeholder}
                disabled={disabled}
                value={selected}
                onChange={(next: string[]) => {
                    const {values, openOther} = splitOtherFromSelection(next)
                    if (openOther) setOtherDraft("")
                    // Opening the Other… draft is not a value change — a no-op onChange would
                    // fire the required rule before the user can type.
                    const unchanged =
                        (values ?? []).length === selected.length &&
                        (values ?? []).every((v, i) => v === selected[i])
                    if (!unchanged) onChange?.(values)
                }}
                options={selectOptionsWithOther(options)}
            />
            {otherDraft !== null && (
                <Input
                    autoFocus
                    disabled={disabled}
                    placeholder="Type a value and press Enter"
                    value={otherDraft}
                    onChange={(e) => setOtherDraft(e.target.value)}
                    onPressEnter={(e) => {
                        // preventDefault marks the press handled — the stepper's Enter-advance
                        // must not fire on a chip commit.
                        e.preventDefault()
                        commitDraft()
                    }}
                    onBlur={commitDraft}
                />
            )}
        </div>
    )
}

// Elevation over borders (the providers-grid treatment): unselected cards are borderless
// elevated fills — a stack of outlined boxes reads exhausting in the dark theme. The one
// selected card per group carries the single accent border.
// No accent border — the filled indicator + a stronger fill carry selection. Borders were
// the whole dark-mode problem (nested yellow rectangles once an input sits inside a card).
const choiceCardCls = (selected: boolean) =>
    `flex cursor-pointer items-start gap-2 rounded-lg p-3 transition-colors ${
        selected ? "bg-colorFillSecondary" : "bg-colorFillQuaternary hover:bg-colorFillTertiary"
    }`

/** Digit hotkey badge (1..9) — pressing the digit selects the card (see the group onKeyDown). */
const DigitBadge = ({digit}: {digit: number}) => (
    <span
        aria-hidden
        className="ml-auto flex shrink-0 items-center self-stretch pl-3 text-[11px] leading-none text-colorTextTertiary"
    >
        {digit}
    </span>
)

/** Presentational check/dot — the CARD is the single interactive element (no nested input). */
const CardIndicator = ({checked, multiple}: {checked: boolean; multiple?: boolean}) => (
    <span
        aria-hidden
        className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center border border-solid transition-colors ${
            multiple ? "rounded" : "rounded-full"
        } ${
            checked
                ? "border-colorPrimary bg-[var(--ant-color-primary)]"
                : "border-colorBorder bg-colorBgContainer"
        }`}
    >
        {checked &&
            (multiple ? (
                <Check size={9} weight="bold" className="text-white" />
            ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
            ))}
    </span>
)

/**
 * Context-ful options rendered as selectable cards (radio semantics; checkbox when `multiple`) —
 * used when any option carries a description a bare Select would flatten. Includes the same
 * "Other…" escape hatch as the Select controls: the last card reveals a free-text input.
 */
function ChoiceCards({
    value,
    onChange,
    options,
    multiple,
    disabled,
    id,
    onPicked,
}: {
    value?: string | string[]
    onChange?: (v: string | string[] | undefined) => void
    options: EnumOption[]
    multiple?: boolean
    disabled?: boolean
    /** Injected by Form.Item so the field label associates with the group. */
    id?: string
    /** Fires after a single-select pick — the stepper auto-advances on it. */
    onPicked?: () => void
}) {
    const otherInputRef = useRef<InputRef>(null)
    // Multi: pending chip text (commits on Enter/blur). Single: mirror of the committed custom
    // value — the value commits as the user types (typeCustomValue).
    const [otherText, setOtherText] = useState("")
    const selected = multiple
        ? ((value as string[] | undefined) ?? [])
        : value != null
          ? [value as string]
          : []
    const customValues = partitionCustomValues(selected, options)
    const customSingle = customValues[0] ?? ""
    // Single-select custom values also arrive from OUTSIDE the input (schema default, restored
    // draft) and picking a listed card clears them — keep the input mirrored to the value.
    useEffect(() => {
        if (!multiple) setOtherText(customSingle)
    }, [multiple, customSingle])

    const isChecked = (v: string) => selected.includes(v)
    // Roving tabindex: ONE Tab stop per group (the selected card, else the first) — Tab crosses
    // the group in one press; arrows walk the cards inside it.
    const roverIndex = Math.max(
        0,
        options.findIndex((o) => isChecked(o.value)),
    )
    const pick = (v: string) => {
        if (disabled) return
        onChange?.(toggleCardSelection(selected, v, !!multiple))
        if (!multiple) onPicked?.()
    }
    const commitDraft = () => {
        const commit = commitCustomValue(selected, otherText, true)
        setOtherText("")
        if (commit.changed) onChange?.(commit.value)
    }
    const typeOther = (text: string) => {
        setOtherText(text)
        if (multiple) return
        const commit = typeCustomValue(value as string | undefined, text, options)
        if (commit.changed) onChange?.(commit.value)
    }
    const focusOther = () => {
        if (!disabled) otherInputRef.current?.focus()
    }
    const otherActive = customValues.length > 0 || otherText.trim() !== ""

    return (
        <div
            id={id}
            role={multiple ? "group" : "radiogroup"}
            className="flex flex-col gap-2"
            onKeyDown={(e) => {
                // Digit hotkeys 1..9 select the matching card (badge affordance). Never while
                // typing, never with modifiers (browser tab shortcuts).
                if (disabled || e.ctrlKey || e.metaKey || e.altKey) return
                const target = e.target as HTMLElement
                const tag = target.tagName
                // ↑/↓ move focus card-to-card (wrapping); Enter/Space/click select.
                if ((e.key === "ArrowDown" || e.key === "ArrowUp") && tag !== "INPUT") {
                    const cards = Array.from(
                        e.currentTarget.querySelectorAll<HTMLElement>(
                            '[role="radio"], [role="checkbox"]',
                        ),
                    )
                    const current = target.closest<HTMLElement>('[role="radio"], [role="checkbox"]')
                    const at = current ? cards.indexOf(current) : -1
                    if (at < 0) return
                    e.preventDefault()
                    const delta = e.key === "ArrowDown" ? 1 : -1
                    cards[(at + delta + cards.length) % cards.length]?.focus()
                    return
                }
                if (tag === "INPUT" || tag === "TEXTAREA") return
                const hit = resolveDigitSelection(e.key, options)
                if (!hit) return
                e.preventDefault()
                if (hit.kind === "option") pick(hit.value)
                else focusOther()
            }}
        >
            {options.map((o, i) => (
                <div
                    key={o.value}
                    role={multiple ? "checkbox" : "radio"}
                    aria-checked={isChecked(o.value)}
                    tabIndex={disabled ? -1 : i === roverIndex ? 0 : -1}
                    onClick={() => pick(o.value)}
                    onKeyDown={(e) => {
                        // Space selects (checkbox convention). Enter also selects in single mode
                        // but stays unprevented so a stepper host advances on the same press.
                        if (e.key === " ") {
                            e.preventDefault()
                            pick(o.value)
                        } else if (e.key === "Enter" && !multiple) {
                            pick(o.value)
                        }
                    }}
                    className={choiceCardCls(isChecked(o.value))}
                >
                    <CardIndicator checked={isChecked(o.value)} multiple={multiple} />
                    <div className="flex min-w-0 flex-col">
                        <Typography.Text className="!text-xs font-medium">
                            {o.label ?? o.value}
                        </Typography.Text>
                        {o.description && (
                            <Typography.Text type="secondary" className="!text-[11px] leading-snug">
                                {o.description}
                            </Typography.Text>
                        )}
                    </div>
                    {i < 9 && <DigitBadge digit={i + 1} />}
                </div>
            ))}
            <div
                role={multiple ? "checkbox" : "radio"}
                aria-checked={otherActive}
                tabIndex={-1}
                onClick={focusOther}
                className={choiceCardCls(otherActive)}
            >
                <CardIndicator checked={otherActive} multiple={multiple} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Typography.Text className="!text-xs font-medium">Other</Typography.Text>
                    {multiple && customValues.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {customValues.map((v) => (
                                <Tag
                                    key={v}
                                    closable={!disabled}
                                    onClose={(e) => {
                                        e.preventDefault()
                                        const next = selected.filter((x) => x !== v)
                                        onChange?.(next.length ? next : undefined)
                                    }}
                                >
                                    {v}
                                </Tag>
                            ))}
                        </div>
                    )}
                    <Input
                        ref={otherInputRef}
                        disabled={disabled}
                        placeholder={multiple ? "Type and press Enter to add" : "Type your answer"}
                        value={otherText}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => typeOther(e.target.value)}
                        onPressEnter={
                            multiple
                                ? (e) => {
                                      // Handled press — the stepper's Enter-advance must not
                                      // fire on a chip commit.
                                      e.preventDefault()
                                      commitDraft()
                                  }
                                : undefined
                        }
                        onBlur={() => {
                            if (multiple) commitDraft()
                            else if (otherText !== otherText.trim()) typeOther(otherText.trim())
                        }}
                        variant="borderless"
                        spellCheck={false}
                        className="!bg-colorBgContainer !px-2"
                    />
                </div>
                {options.length < 9 && <DigitBadge digit={options.length + 1} />}
            </div>
        </div>
    )
}

/** Compact review-row value: option labels, joined chips, Yes/No, formatted dates. */
function formatReviewValue(field: FormFieldDescriptor, value: unknown): string {
    if (value === undefined || value === null || value === "") return "\u2014"
    if (Array.isArray(value)) return value.map(String).join(", ") || "\u2014"
    if (typeof value === "object" && typeof (value as {format?: unknown}).format === "function")
        return (value as {format: (f: string) => string}).format("YYYY-MM-DD HH:mm")
    if (typeof value === "boolean") return value ? "Yes" : "No"
    const meta = field.enumOptions?.find((o) => o.value === value)
    return meta?.label ?? String(value)
}

function SchemaFormField({
    field,
    depth = 0,
    hideLabel,
    onAnswered,
}: {
    field: FormFieldDescriptor
    depth?: number
    /** Stepper mode renders the question as a header above the control — no field label. */
    hideLabel?: boolean
    /** Stepper mode: a completed single-select answer auto-advances to the next question. */
    onAnswered?: () => void
}) {
    const rules = field.required ? [{required: true, message: `${field.label} is required`}] : []
    const label = hideLabel ? undefined : <FieldLabel field={field} />

    // Object with nested children → render in a collapsible section
    if (field.type === "object" && field.children && field.children.length > 0) {
        return (
            <Collapse
                ghost
                size="small"
                defaultActiveKey={field.required ? ["obj"] : undefined}
                className={depth > 0 ? "!-mx-2 border-l border-gray-200 ml-2" : "!-mx-4 !mb-2"}
                items={[
                    {
                        key: "obj",
                        label: (
                            <div className="flex flex-col leading-tight">
                                <span className="font-medium">
                                    {field.label}
                                    {field.required && <span className="text-red-500 ml-1">*</span>}
                                </span>
                                {field.description && (
                                    <Typography.Text
                                        type="secondary"
                                        className="!text-xs leading-snug"
                                    >
                                        {field.description}
                                    </Typography.Text>
                                )}
                            </div>
                        ),
                        children: field.children.map((child) => (
                            <SchemaFormField key={child.name} field={child} depth={depth + 1} />
                        )),
                        forceRender: true,
                    },
                ]}
            />
        )
    }

    // Free-form object or array → JSON editor
    if ((field.type === "object" || field.type === "array") && field.freeform) {
        return (
            <Form.Item
                name={field.name.split(".")}
                label={label}
                rules={[
                    ...rules,
                    {
                        validator: async (_, value) => {
                            if (!value) return
                            try {
                                JSON.parse(value)
                            } catch {
                                throw new Error("Must be valid JSON")
                            }
                        },
                    },
                ]}
            >
                <JsonFieldEditor
                    placeholder={field.type === "object" ? '{"key": "value"}' : '[{"item": 1}]'}
                />
            </Form.Item>
        )
    }

    // Multi-select (elicitation, openEnums): string-items arrays render as a chip picker,
    // upgraded to checkbox choice cards when the options carry descriptions.
    if (field.type === "array" && field.multiple) {
        return (
            <Form.Item
                name={field.name.split(".")}
                label={label}
                rules={rules}
                initialValue={field.default}
            >
                {wantsChoiceCards(field) ? (
                    <ChoiceCards multiple options={enumOptionsOf(field)} />
                ) : (
                    <MultiEnumWithOther options={enumOptionsOf(field)} placeholder={field.label} />
                )}
            </Form.Item>
        )
    }

    // Array with structured item schema → Form.List with add/remove
    if (field.type === "array") {
        return <ArrayField field={field} rules={rules} depth={depth} hideLabel={hideLabel} />
    }

    switch (field.type) {
        case "boolean":
            return (
                <Form.Item
                    name={field.name.split(".")}
                    label={label}
                    valuePropName="checked"
                    initialValue={field.default ?? false}
                >
                    <Switch size="small" />
                </Form.Item>
            )

        case "number":
            return (
                <Form.Item
                    name={field.name.split(".")}
                    label={label}
                    rules={rules}
                    initialValue={field.default}
                >
                    <InputNumber className="w-full" placeholder={field.label} />
                </Form.Item>
            )

        case "enum":
            return (
                <Form.Item
                    name={field.name.split(".")}
                    label={label}
                    rules={rules}
                    initialValue={field.default}
                >
                    {wantsChoiceCards(field) ? (
                        <ChoiceCards options={enumOptionsOf(field)} onPicked={onAnswered} />
                    ) : field.allowCustomEnum ? (
                        <EnumWithOther
                            options={enumOptionsOf(field)}
                            placeholder={field.label}
                            allowClear={!field.required}
                        />
                    ) : (
                        <Select
                            placeholder={field.label}
                            allowClear={!field.required}
                            options={(field.enumValues ?? []).map((v) => ({value: v, label: v}))}
                        />
                    )}
                </Form.Item>
            )

        default:
            // Format-aware controls appear only when the host opted in via `formats`.
            if (field.format === "date" || field.format === "date-time") {
                // No initialValue: a wire default is an ISO STRING and DatePicker requires dayjs —
                // a string value crashes it. Date fields render empty; other types prefill.
                return (
                    <Form.Item name={field.name.split(".")} label={label} rules={rules}>
                        <DatePicker
                            className="w-full"
                            showTime={field.format === "date-time"}
                            placeholder={field.label}
                        />
                    </Form.Item>
                )
            }
            if (field.format === "multiline") {
                return (
                    <Form.Item
                        name={field.name.split(".")}
                        label={label}
                        rules={rules}
                        initialValue={field.default}
                    >
                        <Input.TextArea rows={3} placeholder={field.label} />
                    </Form.Item>
                )
            }
            return (
                <Form.Item
                    name={field.name.split(".")}
                    label={label}
                    rules={[
                        ...rules,
                        ...(field.format === "email" ? [{type: "email" as const}] : []),
                        ...(field.format === "uri" ? [{type: "url" as const}] : []),
                    ]}
                    initialValue={field.default}
                >
                    <Input placeholder={field.label} />
                </Form.Item>
            )
    }
}

// ---------------------------------------------------------------------------
// Array field with Form.List (add / remove)
// ---------------------------------------------------------------------------

function ArrayField({
    field,
    rules,
    depth,
    hideLabel,
}: {
    field: FormFieldDescriptor
    rules: {required: boolean; message: string}[]
    depth: number
    hideLabel?: boolean
}) {
    const namePath = field.name.split(".")
    const hasObjectItems = !!field.itemChildren && field.itemChildren.length > 0
    const primitiveItemType = field.itemSchema?.type as string | undefined

    return (
        <div className={depth > 0 ? "ml-2 border-l border-gray-200 pl-3 mb-3" : "mb-3"}>
            {!hideLabel && (
                <div className="flex items-center justify-between mb-2">
                    <div className="flex flex-col leading-tight">
                        <span className="font-medium">
                            {field.label}
                            {field.required && <span className="text-red-500 ml-1">*</span>}
                        </span>
                        {field.description && (
                            <Typography.Text
                                type="secondary"
                                className="!text-[11px] font-normal leading-snug"
                            >
                                {field.description}
                            </Typography.Text>
                        )}
                    </div>
                </div>
            )}

            <Form.List
                name={namePath}
                rules={
                    rules.length > 0
                        ? [
                              {
                                  validator: async (_, value) => {
                                      if (field.required && (!value || value.length === 0)) {
                                          throw new Error(`At least one ${field.label} is required`)
                                      }
                                  },
                              },
                          ]
                        : undefined
                }
            >
                {(fields, {add, remove}) => (
                    <div className="flex flex-col gap-2">
                        {fields.length === 0 && (
                            <Typography.Text type="secondary" className="text-xs">
                                No items added
                            </Typography.Text>
                        )}

                        {fields.map(({key, name, ...restField}) =>
                            hasObjectItems ? (
                                <ArrayObjectItem
                                    key={key}
                                    name={name}
                                    restField={restField}
                                    itemChildren={field.itemChildren!}
                                    onRemove={() => remove(name)}
                                    depth={depth}
                                />
                            ) : (
                                <div key={key} className="flex items-start gap-2">
                                    <Form.Item
                                        {...restField}
                                        name={[name]}
                                        className="!mb-0 flex-1"
                                    >
                                        {primitiveItemType === "number" ||
                                        primitiveItemType === "integer" ? (
                                            <InputNumber
                                                className="w-full"
                                                placeholder={`${field.label} item`}
                                            />
                                        ) : (
                                            <Input placeholder={`${field.label} item`} />
                                        )}
                                    </Form.Item>
                                    <Button
                                        type="text"
                                        aria-label="Remove item"
                                        icon={<MinusCircle size={16} />}
                                        onClick={() => remove(name)}
                                        className="mt-0.5 opacity-50 hover:opacity-100"
                                    />
                                </div>
                            ),
                        )}

                        <Button
                            type="dashed"
                            onClick={() => add(hasObjectItems ? {} : undefined)}
                            icon={<Plus size={14} />}
                            size="small"
                            className="self-start"
                        >
                            Add {field.label}
                        </Button>
                    </div>
                )}
            </Form.List>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Array item that is an object with structured fields
// ---------------------------------------------------------------------------

function ArrayObjectItem({
    name,
    restField,
    itemChildren,
    onRemove,
    depth,
}: {
    name: number
    restField: {fieldKey?: number}
    itemChildren: FormFieldDescriptor[]
    onRemove: () => void
    depth: number
}) {
    return (
        <Collapse
            ghost
            size="small"
            defaultActiveKey={["item"]}
            className="!-mx-2 border border-solid border-gray-200 rounded-lg"
            items={[
                {
                    key: "item",
                    label: (
                        <div className="flex items-center justify-between w-full">
                            <Typography.Text className="text-xs">Item {name + 1}</Typography.Text>
                        </div>
                    ),
                    extra: (
                        <Button
                            type="text"
                            size="small"
                            aria-label="Remove object item"
                            icon={<MinusCircle size={14} />}
                            onClick={(e) => {
                                e.stopPropagation()
                                onRemove()
                            }}
                            className="opacity-50 hover:opacity-100"
                        />
                    ),
                    children: itemChildren.map((child) => {
                        const childRules = child.required
                            ? [{required: true, message: `${child.label} is required`}]
                            : []
                        const childLabel = <FieldLabel field={child} />

                        // Nested object within array item
                        if (
                            child.type === "object" &&
                            child.children &&
                            child.children.length > 0
                        ) {
                            return (
                                <Collapse
                                    key={child.name}
                                    ghost
                                    size="small"
                                    className="!-mx-2 ml-2 border-l border-gray-200"
                                    items={[
                                        {
                                            key: "nested",
                                            label: (
                                                <Typography.Text className="font-medium">
                                                    {child.label}
                                                </Typography.Text>
                                            ),
                                            children: child.children.map((gc) => (
                                                <Form.Item
                                                    key={gc.name}
                                                    {...restField}
                                                    name={[name, ...gc.name.split(".")]}
                                                    label={<FieldLabel field={gc} />}
                                                    rules={
                                                        gc.required
                                                            ? [
                                                                  {
                                                                      required: true,
                                                                      message: `${gc.label} is required`,
                                                                  },
                                                              ]
                                                            : []
                                                    }
                                                >
                                                    <Input placeholder={gc.label} />
                                                </Form.Item>
                                            )),
                                            forceRender: true,
                                        },
                                    ]}
                                />
                            )
                        }

                        if (child.type === "boolean") {
                            return (
                                <Form.Item
                                    key={child.name}
                                    {...restField}
                                    name={[name, child.name]}
                                    label={childLabel}
                                    valuePropName="checked"
                                    initialValue={child.default ?? false}
                                >
                                    <Switch size="small" />
                                </Form.Item>
                            )
                        }

                        if (child.type === "number") {
                            return (
                                <Form.Item
                                    key={child.name}
                                    {...restField}
                                    name={[name, child.name]}
                                    label={childLabel}
                                    rules={childRules}
                                    initialValue={child.default}
                                >
                                    <InputNumber className="w-full" placeholder={child.label} />
                                </Form.Item>
                            )
                        }

                        if (child.type === "enum") {
                            return (
                                <Form.Item
                                    key={child.name}
                                    {...restField}
                                    name={[name, child.name]}
                                    label={childLabel}
                                    rules={childRules}
                                    initialValue={child.default}
                                >
                                    <Select
                                        placeholder={child.label}
                                        options={(child.enumValues ?? []).map((v) => ({
                                            value: v,
                                            label: v,
                                        }))}
                                    />
                                </Form.Item>
                            )
                        }

                        // Default: string input
                        return (
                            <Form.Item
                                key={child.name}
                                {...restField}
                                name={[name, child.name]}
                                label={childLabel}
                                rules={childRules}
                                initialValue={child.default}
                            >
                                <Input placeholder={child.label} />
                            </Form.Item>
                        )
                    }),
                    forceRender: true,
                },
            ]}
        />
    )
}

// ---------------------------------------------------------------------------
// JSON editor for free-form object/array fields
// ---------------------------------------------------------------------------

function JsonFieldEditor({
    value,
    onChange,
    placeholder,
    disabled,
}: {
    value?: string
    onChange?: (value: string) => void
    placeholder?: string
    disabled?: boolean
}) {
    const handleChange = useCallback(
        ({textContent}: {textContent: string}) => {
            onChange?.(textContent)
        },
        [onChange],
    )

    return (
        <div className="rounded-lg border border-solid border-gray-300 dark:border-gray-700 overflow-hidden">
            <Editor
                initialValue={value || placeholder || "{}"}
                onChange={handleChange}
                codeOnly
                showToolbar={false}
                language="json"
                dimensions={{width: "100%", height: 120}}
                disabled={disabled}
            />
        </div>
    )
}
