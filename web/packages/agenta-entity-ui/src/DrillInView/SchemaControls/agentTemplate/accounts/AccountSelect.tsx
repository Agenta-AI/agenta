import {useIsPhone} from "@agenta/ui/phone"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

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
    "aria-label": ariaLabel,
}: {
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
            <SelectTrigger className={phone ? "!h-11 w-full" : "w-full"} aria-label={ariaLabel}>
                <SelectValue placeholder={placeholder}>
                    {selected ? <OptionText option={selected} /> : null}
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
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
