import {Checkbox, RadioGroupItem} from "@agenta/ui/ui"

/**
 * The pick control in the first column of a step table: a radio inside the table's `RadioGroup`
 * for a single pick, a checkbox for several. A click on it is not the row's click, so a pick does
 * not toggle twice.
 */
export const PickCell = ({
    mode,
    value,
    checked,
    label,
    disabled,
    onToggle,
}: {
    mode: "single" | "multiple"
    value: string
    checked: boolean
    /** Names the row for a screen reader: "Select Capital finder". */
    label: string
    disabled?: boolean
    onToggle: () => void
}) => (
    <span
        className="flex"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
    >
        {mode === "single" ? (
            <RadioGroupItem value={value} aria-label={label} disabled={disabled} />
        ) : (
            <Checkbox
                checked={checked}
                aria-label={label}
                disabled={disabled}
                onCheckedChange={onToggle}
            />
        )}
    </span>
)
