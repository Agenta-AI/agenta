/**
 * Controlled leaf controls for SchemaForm, composed on `@agenta/ui` primitives. They cover
 * the antd features the primitives deliberately dropped: `Select allowClear`, `Select
 * mode="multiple"`, `Select mode="tags"` (chip input), `DatePicker`, and a Switch whose
 * change handler matches the antd Form `value`/`onChange` injection contract.
 *
 * Every control takes plain `value`/`onChange`/`disabled` so it works both under antd
 * `Form.Item` cloning and as an explicitly controlled leaf.
 */
import {useEffect, useId, useMemo, useRef, useState} from "react"

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
    Popover,
    PopoverAnchor,
    PopoverContent,
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
 * Free chip input (antd `Select mode="tags"`): type + Enter adds a chip, Backspace on an empty
 * input removes the last one.
 *
 * `options` are SUGGESTIONS, not a closed set — the field still takes any typed value. They used
 * to ride on a native `<datalist>`, which renders an unstyled OS popup, opens only on some
 * gestures and can't be keyboard-driven from our own markup. So the suggestion list is built here
 * on the same Popover + `role=listbox` + `aria-activedescendant` pattern as `Combobox`, and looks
 * like every other dropdown in the form.
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
    /** Suggested values, offered in a dropdown. Typing a value not in the list still works. */
    options?: string[]
}) {
    const [draft, setDraft] = useState("")
    const [open, setOpen] = useState(false)
    const [activeIndex, setActiveIndex] = useState(0)
    const boxRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const listRef = useRef<HTMLDivElement>(null)
    const selected = value ?? []

    // Stable ids so the input's aria-controls/aria-activedescendant can point at the listbox and
    // the active row (WAI-ARIA combobox), the way `Combobox` does.
    const rid = useId()
    const listId = `${rid}-listbox`
    const optionId = (index: number) => `${rid}-opt-${index}`

    // What's left to suggest: never a value already chipped, narrowed by what's typed so far.
    const matches = useMemo(() => {
        const taken = value ?? []
        const q = draft.trim().toLowerCase()
        return (options ?? []).filter(
            (o) => !taken.includes(o) && (!q || o.toLowerCase().includes(q)),
        )
    }, [options, value, draft])

    const hasSuggestions = Boolean(options?.length)
    const showList = open && !disabled && matches.length > 0

    /** Did this dismiss attempt come from the field itself (the anchor), rather than off it? */
    const fromBox = (e: {detail: {originalEvent: Event}}) => {
        const target = e.detail.originalEvent.target
        return target instanceof Node && Boolean(boxRef.current?.contains(target))
    }

    // A fresh query re-aims at the first row; the old index could point past the new list.
    useEffect(() => setActiveIndex(0), [draft, open])
    useEffect(() => {
        if (showList)
            listRef.current?.querySelector("[data-active=true]")?.scrollIntoView({block: "nearest"})
    }, [activeIndex, showList])

    const add = (raw: string) => {
        const trimmed = raw.trim()
        setDraft("")
        if (!trimmed || selected.includes(trimmed)) return
        onChange?.([...selected, trimmed])
    }
    const removeAt = (v: string) => {
        const next = selected.filter((s) => s !== v)
        onChange?.(next.length ? next : undefined)
    }

    const box = (
        <div
            ref={boxRef}
            data-slot="chips-input"
            onMouseDown={(e) => {
                if (disabled) return
                // Focus by hand off the box chrome (Combobox does the same): letting the browser
                // do it mid-gesture opens the list on a `focus` the rest of the click then
                // reads as an interaction outside, and the list shuts again on mouseup.
                if (e.target !== inputRef.current) {
                    e.preventDefault()
                    inputRef.current?.focus()
                }
                if (hasSuggestions) setOpen(true)
            }}
            className={cn(
                selectTriggerVariants({variant: "default", size: "default"}),
                MULTI_BOX_CLS,
                // The right inset only exists to clear the caret; without suggestions there is none.
                !hasSuggestions && "pr-1",
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
                role={hasSuggestions ? "combobox" : undefined}
                aria-expanded={hasSuggestions ? showList : undefined}
                aria-controls={hasSuggestions ? listId : undefined}
                aria-autocomplete={hasSuggestions ? "list" : undefined}
                aria-activedescendant={showList ? optionId(activeIndex) : undefined}
                placeholder={selected.length === 0 ? placeholder : undefined}
                value={draft}
                onChange={(e) => {
                    setDraft(e.target.value)
                    if (hasSuggestions) setOpen(true)
                }}
                onFocus={() => hasSuggestions && setOpen(true)}
                onKeyDown={(e) => {
                    if (hasSuggestions && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                        e.preventDefault()
                        if (!showList) return setOpen(true)
                        const dir = e.key === "ArrowDown" ? 1 : -1
                        setActiveIndex((i) => (i + dir + matches.length) % matches.length)
                    } else if (e.key === "Enter") {
                        e.preventDefault()
                        add(showList ? (matches[activeIndex] ?? draft) : draft)
                        setOpen(false)
                    } else if (e.key === "Escape" && showList) {
                        // Swallowed, or the drawer hosting the field would close along with the list.
                        e.preventDefault()
                        e.stopPropagation()
                        setOpen(false)
                    } else if (e.key === "Backspace" && draft === "" && selected.length > 0) {
                        removeAt(selected[selected.length - 1])
                    }
                }}
                onBlur={() => {
                    add(draft)
                    setOpen(false)
                }}
                // antd's tags-mode search input is width-auto; an 80px floor pushed the caret
                // onto a second line as soon as the chips filled the row.
                className="h-6 min-w-[4px] flex-1 px-1"
            />
            {hasSuggestions && (
                <CaretDown
                    size={12}
                    className="absolute right-[11px] top-1/2 -translate-y-1/2 text-placeholder"
                />
            )}
        </div>
    )

    if (!hasSuggestions) return box

    return (
        <Popover open={showList} onOpenChange={setOpen}>
            <PopoverAnchor asChild>{box}</PopoverAnchor>
            <PopoverContent
                align="start"
                aria-label="Suggestions"
                // Focus stays in the input — the list is driven by aria-activedescendant.
                onOpenAutoFocus={(e) => e.preventDefault()}
                onCloseAutoFocus={(e) => e.preventDefault()}
                // The input lives in the ANCHOR, so every click and focus inside the field reads
                // as "outside the layer" to Radix and would dismiss the list the moment it opened.
                onPointerDownOutside={(e) => fromBox(e) && e.preventDefault()}
                onFocusOutside={(e) => fromBox(e) && e.preventDefault()}
                className="w-[var(--radix-popover-trigger-width)] p-1 font-portal"
            >
                <div
                    id={listId}
                    ref={listRef}
                    role="listbox"
                    aria-label="Suggestions"
                    className="max-h-[300px] overflow-y-auto"
                >
                    {matches.map((o, index) => (
                        <div
                            key={o}
                            id={optionId(index)}
                            role="option"
                            aria-selected={index === activeIndex}
                            data-active={index === activeIndex}
                            onMouseEnter={() => setActiveIndex(index)}
                            // Keeps the input focused, so `onBlur` doesn't chip the draft first.
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                                add(o)
                                setOpen(false)
                                inputRef.current?.focus()
                            }}
                            className="box-border flex min-h-control w-full cursor-pointer select-none items-center rounded-control-sm px-3 py-1 text-field-md data-[active=true]:bg-muted"
                        >
                            {o}
                        </div>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
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
