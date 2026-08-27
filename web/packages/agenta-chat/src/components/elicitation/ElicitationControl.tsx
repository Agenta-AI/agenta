/**
 * The control for one question step: text, number, multiline, or a list of pickable rows.
 *
 * Options render one per ROW rather than behind a dropdown — the whole point of the docked card is
 * that the choices are visible without a second click. Rows carry a digit so a keyboard user picks
 * without leaving home row; past the ninth the digit runs out but the row still clicks and arrows.
 */
import {useEffect, useId, useMemo, useRef} from "react"

import {dayjs, type ElicitationStep} from "@agenta/shared/utils"
import {AutosizeTextarea, DatePicker, DateTimePicker, Input, SimpleTooltip} from "@agenta/ui/ui"
import {Check, Question} from "@phosphor-icons/react"

import {ElicitationChips} from "./ElicitationChips"

/** Enough rows to see the shape of the list; past this it scrolls rather than growing the card. */
export const OPTIONS_MAX_H = 220
/** Digits address the first nine rows. */
export const MAX_DIGIT_ROWS = 9

const OTHER_LABEL = "Other — type a value"

export interface OptionRow {
    /** The value picked, or null for the trailing "Other" row. */
    value: string | null
    label: string
    description?: string
}

/** Whether this step's rows toggle (many answers) rather than pick (one answer). */
export const isMultiSelect = (step: ElicitationStep | null): boolean => step?.kind === "multiselect"

/** The rows a step offers, including its trailing "Other". Empty when nothing is pickable. */
export const optionRowsFor = (step: ElicitationStep | null): OptionRow[] => {
    if (!step) return []
    if (step.kind === "boolean")
        return [
            {value: "true", label: "Yes"},
            {value: "false", label: "No"},
        ]
    if (step.kind !== "enum" && step.kind !== "multiselect") return []
    if (!step.options?.length) return []
    const rows: OptionRow[] = step.options.map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.description ? {description: option.description} : {}),
    }))
    return step.allowOther ? [...rows, {value: null, label: OTHER_LABEL}] : rows
}

/** The picked options on a multi-select, as a set of row indexes. */
export const selectedRowsFor = (step: ElicitationStep | null, value: unknown): Set<number> => {
    const chosen = new Set<number>()
    if (!isMultiSelect(step) || !Array.isArray(value)) return chosen
    optionRowsFor(step).forEach((row, index) => {
        if (row.value !== null && (value as string[]).includes(row.value)) chosen.add(index)
    })
    return chosen
}

/** Which row the current value sits on. `-1` when the value came from the Other input. */
export const selectedRowFor = (step: ElicitationStep | null, value: unknown): number => {
    const rows = optionRowsFor(step)
    if (!rows.length) return -1
    if (step?.kind === "boolean") return typeof value === "boolean" ? (value ? 0 : 1) : -1
    if (isMultiSelect(step)) return -1
    const index = rows.findIndex((row) => row.value !== null && row.value === value)
    if (index >= 0) return index
    // A non-empty value matching nothing was typed into the Other row.
    return typeof value === "string" && value.trim() !== "" ? rows.length - 1 : -1
}

/** Date steps hold the WIRE string, never a dayjs object: drafts round-trip through JSON, and
 * `serializeElicitationContent` passes an already-correct string straight through. */
const isDateKind = (step: ElicitationStep): boolean =>
    step.kind === "date" || step.kind === "date-time"

const dateValueOf = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return undefined
    const parsed = dayjs(value)
    return parsed.isValid() ? parsed : undefined
}

export interface ElicitationControlProps {
    step: ElicitationStep
    value: unknown
    cursor: number
    /** Suppress the keyboard affordances on a surface that has no keyboard. */
    touch?: boolean
    onChange: (value: unknown) => void
    /** Pick a row: sets the value AND advances (single-select only). */
    onPick: (row: OptionRow, index: number) => void
    /** Toggle a row without advancing (multi-select only). */
    onToggle: (row: OptionRow, index: number) => void
    onCursor: (index: number) => void
    /** Enter in a single-line field: commit this answer and move on. */
    onSubmit: () => void
}

const inputCls =
    "h-8 w-full rounded-md border border-solid border-colorBorder bg-colorBgContainer px-2.5 text-[13px] text-colorText outline-none focus:border-colorPrimary"

export const ElicitationControl = ({
    step,
    value,
    cursor,
    touch,
    onChange,
    onPick,
    onToggle,
    onCursor,
    onSubmit,
}: ElicitationControlProps) => {
    const rows = useMemo(() => optionRowsFor(step), [step])
    const multi = isMultiSelect(step)
    const selected = selectedRowFor(step, value)
    const checked = selectedRowsFor(step, value)
    // Enter commits and moves on — including in the textarea, matching the chat composer's rule.
    // Shift+Enter is the newline there, as it is in the composer.
    const submitOnEnter = (event: React.KeyboardEvent) => {
        if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.shiftKey) return
        event.preventDefault()
        onSubmit()
    }
    // One ref for whichever single-line-or-textarea control this step renders, so the focus effect
    // below does not have to know which branch ran.
    const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
    const otherRef = useRef<HTMLInputElement>(null)
    const dateBoxRef = useRef<HTMLDivElement>(null)
    const describedBy = useId()

    // Focus follows the step — on first render and on every move, forward or back — so a typed
    // answer never needs a click first. `preventScroll` is non-negotiable: a bare .focus() inside
    // the transcript's scroller fights the same frame's scroll write, which was a named jitter cause.
    useEffect(() => {
        if (rows.length) return
        const frame = requestAnimationFrame(() => {
            // A picker exposes no ref, so reach for its trigger. Without this a date step leaves
            // focus on the body and every card-level shortcut goes dead until the user clicks.
            if (step.kind === "date" || step.kind === "date-time") {
                dateBoxRef.current?.querySelector("button")?.focus({preventScroll: true})
                return
            }
            const el = fieldRef.current
            if (!el) return
            el.focus({preventScroll: true})
            // Caret to the end, not the start: stepping BACK to a filled answer should continue it.
            const end = el.value.length
            try {
                el.setSelectionRange(end, end)
            } catch {
                // number inputs reject setSelectionRange; focus alone is enough there
            }
        })
        return () => cancelAnimationFrame(frame)
    }, [step.name, step.kind, rows.length])

    if (rows.length) {
        // The Other row holds whatever was typed rather than a listed value.
        const otherActive =
            !multi && selected === rows.length - 1 && rows[rows.length - 1].value === null
        return (
            <div
                className="flex flex-col gap-1.5 overflow-y-auto"
                style={{maxHeight: OPTIONS_MAX_H}}
                role={multi ? "group" : "radiogroup"}
                aria-label={step.label}
            >
                {rows.map((row, index) => {
                    const isOther = row.value === null
                    const isSelected = multi ? checked.has(index) : index === selected
                    const isCursor = index === cursor
                    return (
                        <div
                            key={row.label}
                            role={multi ? "checkbox" : "radio"}
                            aria-checked={isSelected}
                            tabIndex={-1}
                            aria-describedby={
                                row.description ? `${describedBy}-${index}` : undefined
                            }
                            onMouseEnter={() => onCursor(index)}
                            onClick={() => {
                                // The Other row is a text field, not an answer: focus it instead of
                                // committing an empty pick and moving on.
                                if (isOther) {
                                    onCursor(index)
                                    otherRef.current?.focus({preventScroll: true})
                                    return
                                }
                                if (multi) onToggle(row, index)
                                else onPick(row, index)
                            }}
                            className={`flex h-[30px] cursor-pointer items-center gap-2 rounded-md px-2 text-xs ${
                                isSelected
                                    ? "bg-colorFillSecondary font-medium"
                                    : isCursor
                                      ? "bg-colorFillQuaternary"
                                      : ""
                            }`}
                        >
                            <span className="shrink-0 text-[11px] tabular-nums text-colorText">
                                {index < MAX_DIGIT_ROWS ? `${index + 1}.` : "·"}
                            </span>
                            {isOther ? (
                                <input
                                    ref={otherRef}
                                    data-elicitation-other
                                    value={otherActive ? String(value ?? "") : ""}
                                    placeholder={OTHER_LABEL}
                                    onKeyDown={submitOnEnter}
                                    onChange={(event) => onChange(event.target.value)}
                                    className="min-w-0 flex-1 border-none bg-transparent text-xs text-colorText outline-none placeholder:text-colorTextTertiary"
                                />
                            ) : (
                                <>
                                    <span className="truncate">{row.label}</span>
                                    {row.description ? (
                                        <SimpleTooltip title={row.description}>
                                            <span
                                                // Not focusable on purpose: a tab stop in every row
                                                // would fight the arrow-key navigation. The row's
                                                // aria-describedby carries the same words.
                                                tabIndex={-1}
                                                onClick={(event) => event.stopPropagation()}
                                                className="flex shrink-0 items-center text-colorTextTertiary hover:text-colorText"
                                            >
                                                <Question size={11} weight="bold" />
                                            </span>
                                        </SimpleTooltip>
                                    ) : null}
                                    {row.description ? (
                                        <span id={`${describedBy}-${index}`} className="sr-only">
                                            {row.description}
                                        </span>
                                    ) : null}
                                </>
                            )}
                            {/* One trailing slot: a picked row shows its check and drops the
                                shortcut hints, which have nothing left to teach on it. */}
                            {multi && isSelected && !isOther ? (
                                <Check
                                    size={12}
                                    weight="bold"
                                    aria-hidden
                                    className="ml-auto shrink-0 text-colorText"
                                />
                            ) : isCursor && !touch ? (
                                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[9px] text-colorTextQuaternary">
                                    <kbd className="font-sans">↑</kbd>
                                    <kbd className="font-sans">↓</kbd>
                                    <kbd className="font-sans">↵</kbd>
                                </span>
                            ) : null}
                        </div>
                    )
                })}
            </div>
        )
    }

    if (isDateKind(step)) {
        const current = dateValueOf(value)
        // The wire is pinned to ISO by the golden fixtures: YYYY-MM-DD for a date, full ISO for a
        // date-time. Emitting that here keeps drafts, validation and serialization on plain strings.
        const emit = (next: ReturnType<typeof dayjs> | undefined) => {
            if (!next) return onChange(undefined)
            onChange(step.kind === "date" ? next.format("YYYY-MM-DD") : next.toISOString())
        }
        // The trigger is a Button, whose 4px focus ring reads as broken beside the 1px border every
        // other field in this card focuses with. Overridden here rather than in @agenta/ui: this is
        // the card's own focus language, not a change every DatePicker should inherit. DateTimePicker
        // holds two triggers and forwards className to their wrapper, hence the descendant reach.
        return (
            <div ref={dateBoxRef}>
                {step.kind === "date" ? (
                    <DatePicker
                        value={current}
                        onChange={emit}
                        aria-label={step.label}
                        placeholder={step.hint ?? "Pick a date"}
                        className="focus-visible:outline-none focus-visible:border-primary"
                    />
                ) : (
                    <DateTimePicker
                        value={current}
                        onChange={emit}
                        aria-label={step.label}
                        placeholder={step.hint ?? "Pick a date and time"}
                        className="[&_button]:focus-visible:outline-none [&_button]:focus-visible:border-primary"
                    />
                )}
            </div>
        )
    }

    if (step.kind === "list") {
        return (
            <ElicitationChips
                value={value}
                label={step.label}
                touch={touch}
                inputRef={fieldRef as React.Ref<HTMLInputElement>}
                onChange={onChange}
                onSubmit={onSubmit}
            />
        )
    }

    if (step.kind === "multiline") {
        return (
            <AutosizeTextarea
                ref={fieldRef as React.Ref<HTMLTextAreaElement>}
                aria-label={step.label}
                value={String(value ?? "")}
                // Enter now commits here, so say where the newline went — unless a real hint or a
                // touch surface (no keyboard) owns the line instead.
                placeholder={step.hint ?? (touch ? undefined : "Shift ↵ for a new line")}
                onKeyDown={submitOnEnter}
                // Capped: past this the card scrolls the textarea rather than growing the dock.
                autoSize={{minRows: 3, maxRows: 8}}
                onChange={(event) => onChange(event.target.value)}
                className="text-[13px]"
            />
        )
    }

    if (step.kind === "number") {
        return (
            <Input
                ref={fieldRef as React.Ref<HTMLInputElement>}
                type="number"
                aria-label={step.label}
                onKeyDown={submitOnEnter}
                value={value === undefined || value === null ? "" : String(value)}
                onChange={(event) =>
                    onChange(event.target.value === "" ? undefined : Number(event.target.value))
                }
                className={inputCls}
            />
        )
    }

    return (
        <Input
            ref={fieldRef as React.Ref<HTMLInputElement>}
            aria-label={step.label}
            value={String(value ?? "")}
            placeholder={step.hint}
            onKeyDown={submitOnEnter}
            onChange={(event) => onChange(event.target.value)}
            className={inputCls}
        />
    )
}
