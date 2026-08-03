/**
 * Controlled leaf controls for SchemaForm, composed on `@agenta/ui` primitives. They cover
 * the antd features the primitives deliberately dropped: `Select allowClear`, `Select
 * mode="multiple"`, `Select mode="tags"` (chip input), `DatePicker`, and a Switch whose
 * change handler matches the antd Form `value`/`onChange` injection contract.
 *
 * Every control takes plain `value`/`onChange`/`disabled` so it works both under antd
 * `Form.Item` cloning and as an explicitly controlled leaf.
 */
import {useId, useRef, useState} from "react"

import {dayjs} from "@agenta/shared/utils"
import {
    Badge,
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Input,
    Switch,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    cn,
    selectTriggerVariants,
    type SwitchProps,
} from "@agenta/ui/ui"
import {CaretDown, X, XCircle} from "@phosphor-icons/react"

type Dayjs = ReturnType<typeof dayjs>

export interface SelectOptionItem {
    value: string
    label?: React.ReactNode
}

/**
 * Single-select with antd's `allowClear` affordance (hover swaps the caret for a clear
 * button). Radix has no clear; `""` is the internal "no selection" sentinel.
 */
export function SelectControl({
    value,
    onChange,
    options,
    placeholder,
    allowClear,
    disabled,
    id,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
}: {
    value?: string
    onChange?: (v: string | undefined) => void
    options: SelectOptionItem[]
    placeholder?: string
    allowClear?: boolean
    disabled?: boolean
    id?: string
    "aria-label"?: string
    "aria-labelledby"?: string
}) {
    const showClear = !!allowClear && value != null && value !== "" && !disabled
    return (
        <span className="group/select relative block w-full">
            <Select
                value={value ?? ""}
                onValueChange={(next) => onChange?.(next === "" ? undefined : next)}
                disabled={disabled}
            >
                {/* role=combobox is NOT named from its contents, and a Form.Item `<label for>`
                    does not apply to a button — fall back to the placeholder (the field label
                    every call site passes) so the trigger is never anonymous. */}
                <SelectTrigger
                    id={id}
                    aria-label={ariaLabelledby ? undefined : (ariaLabel ?? placeholder)}
                    aria-labelledby={ariaLabelledby}
                >
                    <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                    {options.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                            {o.label ?? o.value}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {showClear && (
                <button
                    type="button"
                    aria-label="Clear selection"
                    onClick={(e) => {
                        e.stopPropagation()
                        onChange?.(undefined)
                    }}
                    className="absolute right-2 top-1/2 hidden -translate-y-1/2 cursor-pointer border-0 bg-colorBgContainer p-0 text-colorTextTertiary hover:text-colorTextSecondary group-hover/select:block"
                >
                    <XCircle size={12} weight="fill" />
                </button>
            )}
        </span>
    )
}

// antd `.ant-select-selection-item` chip skin, measured (getComputedStyle): h 24,
// `colorFillSecondary` fill, radius 6 (= control-sm), pad 0 4px 0 8px, block margin 2px.
const SELECT_CHIP_CLS =
    "h-6 my-0.5 rounded-control-sm pl-2 pr-1 bg-colorFillSecondary text-xs leading-none"

// antd `.ant-select-multiple` box, measured: h 30 (24 chip + 2×2 margin + border),
// padding 0 11px 0 1px; the arrow is absolutely positioned (it must not wrap).
const MULTI_BOX_CLS = "relative h-auto min-h-[30px] flex-wrap justify-start gap-x-1 py-0 pl-px pr-6"

/** Removable chip (antd closable `Tag` / select selection-item). */
export function Chip({
    label,
    onRemove,
    disabled,
    className,
}: {
    label: string
    onRemove?: () => void
    disabled?: boolean
    className?: string
}) {
    return (
        <Badge variant="default" className={cn("max-w-full", className)}>
            <span className="truncate">{label}</span>
            {onRemove && !disabled && (
                // Non-focusable span, not a <button>: chips render inside the MultiSelect trigger
                // button and a tabbable control there is an axe nested-interactive violation.
                <span
                    role="button"
                    aria-label={`Remove ${label}`}
                    onClick={(e) => {
                        e.stopPropagation()
                        onRemove()
                    }}
                    className="inline-flex cursor-pointer border-0 bg-transparent p-0 text-colorIcon hover:text-colorText"
                >
                    <X size={10} />
                </span>
            )}
        </Badge>
    )
}

/**
 * Multi-select dropdown with chips in the trigger (antd `Select mode="multiple"`),
 * composed on DropdownMenu (checkbox items keep the panel open on toggle).
 */
export function MultiSelect({
    value,
    onChange,
    options,
    placeholder,
    disabled,
    id,
    /** Extra trailing entry (the "Other…" escape hatch); closes the menu on pick. */
    extraItem,
}: {
    value?: string[]
    onChange?: (v: string[]) => void
    options: SelectOptionItem[]
    placeholder?: string
    disabled?: boolean
    id?: string
    extraItem?: {label: React.ReactNode; onSelect: () => void}
}) {
    const selected = value ?? []
    const toggle = (v: string, checked: boolean) => {
        onChange?.(checked ? [...selected, v] : selected.filter((s) => s !== v))
    }
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled}>
                <button
                    type="button"
                    id={id}
                    data-slot="multi-select-trigger"
                    className={cn(
                        selectTriggerVariants({variant: "default", size: "default"}),
                        MULTI_BOX_CLS,
                    )}
                >
                    {selected.length === 0 ? (
                        <span className="pl-2.5 text-placeholder">{placeholder}</span>
                    ) : (
                        selected.map((v) => (
                            <Chip
                                key={v}
                                label={(options.find((o) => o.value === v)?.label as string) ?? v}
                                onRemove={() => toggle(v, false)}
                                disabled={disabled}
                                className={SELECT_CHIP_CLS}
                            />
                        ))
                    )}
                    <CaretDown
                        size={12}
                        className="absolute right-[11px] top-1/2 -translate-y-1/2 text-placeholder"
                    />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="start"
                className="box-border w-[var(--radix-dropdown-menu-trigger-width)]"
            >
                {options.map((o) => (
                    <DropdownMenuCheckboxItem
                        key={o.value}
                        checked={selected.includes(o.value)}
                        onCheckedChange={(checked) => toggle(o.value, checked === true)}
                        onSelect={(e) => e.preventDefault()}
                    >
                        {o.label ?? o.value}
                    </DropdownMenuCheckboxItem>
                ))}
                {extraItem && (
                    <>
                        {options.length > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuItem onSelect={extraItem.onSelect}>
                            {extraItem.label}
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

/**
 * Free chip input (antd `Select mode="tags"` with `open={false}`): type + Enter adds a
 * chip, Backspace on an empty input removes the last one.
 */
export function ChipsInput({
    value,
    onChange,
    placeholder,
    disabled,
    id,
    options,
}: {
    value?: string[]
    onChange?: (v: string[] | undefined) => void
    placeholder?: string
    disabled?: boolean
    id?: string
    /** Suggested values, offered as native datalist completions (antd tags-mode `options`). */
    options?: string[]
}) {
    const [draft, setDraft] = useState("")
    const listId = useId()
    const inputRef = useRef<HTMLInputElement>(null)
    const selected = value ?? []

    const commit = () => {
        const trimmed = draft.trim()
        setDraft("")
        if (!trimmed || selected.includes(trimmed)) return
        onChange?.([...selected, trimmed])
    }
    const removeAt = (v: string) => {
        const next = selected.filter((s) => s !== v)
        onChange?.(next.length ? next : undefined)
    }

    return (
        <div
            data-slot="chips-input"
            onClick={() => inputRef.current?.focus()}
            className={cn(
                selectTriggerVariants({variant: "default", size: "default"}),
                MULTI_BOX_CLS,
                "cursor-text",
                disabled &&
                    "cursor-not-allowed bg-disabled-bg text-disabled border-disabled-border",
            )}
        >
            {selected.map((v) => (
                <Chip
                    key={v}
                    label={v}
                    onRemove={() => removeAt(v)}
                    disabled={disabled}
                    className={SELECT_CHIP_CLS}
                />
            ))}
            <Input
                ref={inputRef}
                id={id}
                variant="ghost"
                disabled={disabled}
                aria-label={placeholder}
                placeholder={selected.length === 0 ? placeholder : undefined}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault()
                        commit()
                    } else if (e.key === "Backspace" && draft === "" && selected.length > 0) {
                        removeAt(selected[selected.length - 1])
                    }
                }}
                onBlur={commit}
                list={options?.length ? listId : undefined}
                // antd's tags-mode search input is width-auto; an 80px floor pushed the caret
                // onto a second line as soon as the chips filled the row.
                className="h-6 min-w-[4px] flex-1 px-1"
            />
            {options?.length ? (
                <datalist id={listId}>
                    {options
                        .filter((o) => !selected.includes(o))
                        .map((o) => (
                            <option key={o} value={o} />
                        ))}
                </datalist>
            ) : null}
        </div>
    )
}

/**
 * Date / date-time input on a native picker (antd `DatePicker` replacement — no calendar
 * primitive exists in @agenta/ui). Values stay dayjs so review formatting, draft
 * partitioning and ISO serialization keep working unchanged.
 */
export function DateTimeInput({
    value,
    onChange,
    showTime,
    disabled,
    id,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
}: {
    value?: Dayjs
    onChange?: (v: Dayjs | undefined) => void
    showTime?: boolean
    disabled?: boolean
    id?: string
    "aria-label"?: string
    "aria-labelledby"?: string
}) {
    const format = showTime ? "YYYY-MM-DDTHH:mm" : "YYYY-MM-DD"
    const text = value && dayjs(value).isValid() ? dayjs(value).format(format) : ""
    return (
        <Input
            id={id}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            type={showTime ? "datetime-local" : "date"}
            disabled={disabled}
            value={text}
            onChange={(e) => {
                const next = e.target.value
                onChange?.(next ? dayjs(next) : undefined)
            }}
            // Native date controls add intrinsic height; clamp to the measured antd
            // picker box (30px) so the row lines up with the other fields.
            className="h-[30px] w-full"
        />
    )
}

/** Switch under antd Form.Item cloning: `checked` in, plain `onChange(next)` out. */
export function FormSwitch({
    checked,
    onChange,
    disabled,
    size,
}: {
    checked?: boolean
    onChange?: (checked: boolean) => void
    disabled?: boolean
    size?: SwitchProps["size"]
}) {
    return (
        <Switch
            checked={!!checked}
            onCheckedChange={(next) => onChange?.(next === true)}
            disabled={disabled}
            size={size}
        />
    )
}
