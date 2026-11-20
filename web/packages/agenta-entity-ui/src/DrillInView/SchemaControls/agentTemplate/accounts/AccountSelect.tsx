import type {ReactNode} from "react"

import {useIsPhone} from "@agenta/ui/phone"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {CaretUpDown, Plus} from "@phosphor-icons/react"

/** The select value of the last row, which opens the connect view instead of picking. */
export const CONNECT_ANOTHER = "__connect_another__"

export interface AccountSelectOption {
    value: string
    label: string
    /** Right-aligned detail, for example the default account beside "Use my default". */
    meta?: string
}

/** One account select of an integration: its accounts, then a row that connects another one. */
export function AccountSelect({
    value,
    options,
    onChange,
    connectLabel,
    placeholder,
    disabled,
    icon,
    "aria-label": ariaLabel,
}: {
    /** Glyph before the value in the trigger (canvas F02 f6: an app glyph, M09: a person). */
    icon?: ReactNode
    value: string
    options: AccountSelectOption[]
    onChange: (value: string) => void
    connectLabel: string
    placeholder?: string
    disabled?: boolean
    "aria-label": string
}) {
    // A 44 px target on a phone (M09).
    const phone = useIsPhone()
    const selected = options.find((option) => option.value === value)
    return (
        <Select value={selected ? value : ""} onValueChange={onChange} disabled={disabled}>
            {/* Canvas F02 f6: 36 px, radius 6, 13 px, an up-down icon in place of the shared
                chevron (hidden here); 44 px, radius 8 on a phone (M09). */}
            <SelectTrigger
                className={`w-full gap-2 [&>svg:last-child]:hidden ${
                    phone ? "!h-11 !rounded-[8px]" : "!h-9 !rounded-[6px] !px-[11px] !text-[13px]"
                }`}
                aria-label={ariaLabel}
            >
                {icon ? (
                    <span className="flex shrink-0 text-colorTextSecondary">{icon}</span>
                ) : null}
                <SelectValue placeholder={placeholder}>
                    {selected ? <OptionText option={selected} /> : null}
                </SelectValue>
                <CaretUpDown aria-hidden size={14} className="shrink-0 text-colorTextTertiary" />
            </SelectTrigger>
            <SelectContent>
                {options.map((option) => (
                    // Regular weight on the picked row too; the check marks it (canvas F10 f5).
                    <SelectItem
                        key={option.value}
                        value={option.value}
                        className="data-[state=checked]:font-normal"
                    >
                        <OptionText option={option} />
                    </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value={CONNECT_ANOTHER}>
                    <span className="flex items-center gap-2">
                        <Plus size={14} />
                        {connectLabel}
                    </span>
                </SelectItem>
            </SelectContent>
        </Select>
    )
}

function OptionText({option}: {option: AccountSelectOption}) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{option.label}</span>
            {option.meta ? (
                <span className="shrink-0 text-xs text-colorTextTertiary">{option.meta}</span>
            ) : null}
        </span>
    )
}
