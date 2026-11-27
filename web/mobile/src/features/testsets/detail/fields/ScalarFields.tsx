import {useCallback} from "react"

import {NumberField} from "@agenta/ui/drill-in"
import {Segmented} from "@agenta/ui/ui"

const BOOLEAN_OPTIONS = [
    // The JSON values themselves, not words: they read the same in every language.
    {value: "true", label: "true"},
    {value: "false", label: "false"},
]

/** A true or false value as the true / false switch. It stores a boolean. */
export const TrueFalseSwitch = ({
    name,
    value,
    onChange,
}: {
    name: string
    value: boolean
    onChange: (next: boolean) => void
}) => (
    <Segmented
        size="compact"
        aria-label={name}
        options={BOOLEAN_OPTIONS}
        value={value ? "true" : "false"}
        onChange={(next) => onChange(next === "true")}
    />
)

/** A number as the drill-in number input, without a border until hover. It stores a number. */
export const NumberInput = ({
    name,
    value,
    onChange,
}: {
    name: string
    value: number
    onChange: (next: number) => void
}) => {
    const setValue = useCallback(
        (_path: string[], next: unknown) => onChange(next as number),
        [onChange],
    )
    return (
        <div className="[&_[data-slot=input-number]]:border-transparent [&_[data-slot=input-number]]:bg-transparent [&_[data-slot=input-number]:hover]:border-border [&_input]:text-right">
            <NumberField
                item={{key: name, name, value}}
                stringValue={String(value)}
                fullPath={[name]}
                setValue={setValue}
                valueMode="native"
            />
        </div>
    )
}
