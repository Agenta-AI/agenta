import {RadioGroup, RadioGroupItem} from "@agenta/ui/ui"

export interface OwnerOption<Owner extends string> {
    value: Owner
    label: string
    /** The line under the label: what choosing it means. */
    note: string
}

export interface OwnerRadioGroupProps<Owner extends string> {
    value: Owner
    options: OwnerOption<Owner>[]
    onChange: (next: Owner) => void
    /** Names the group for assistive tech; the host draws the visible label. */
    "aria-label"?: string
}

/**
 * The "Who can use it" choice of an add dialog: one radio per owner, each with a note. The host
 * draws the field label in its own form's style.
 */
export function OwnerRadioGroup<Owner extends string>({
    value,
    options,
    onChange,
    "aria-label": ariaLabel = "Who can use it",
}: OwnerRadioGroupProps<Owner>) {
    return (
        <RadioGroup
            aria-label={ariaLabel}
            value={value}
            onValueChange={(next) => onChange(next as Owner)}
            className="flex flex-col gap-2"
        >
            {options.map((option) => (
                <label key={option.value} className="flex cursor-pointer items-start gap-2.5">
                    <RadioGroupItem value={option.value} className="mt-0.5" />
                    <span className="flex flex-col gap-0.5">
                        <span className="text-colorText">{option.label}</span>
                        <span className="text-[11px] text-colorTextTertiary">{option.note}</span>
                    </span>
                </label>
            ))}
        </RadioGroup>
    )
}
