import {memo} from "react"

import {Input} from "@agenta/primitive-ui/components/input"
import {Label} from "@agenta/primitive-ui/components/label"
import {RadioGroup, RadioGroupItem} from "@agenta/primitive-ui/components/radio-group"

import {CANCEL_REASONS} from "../constants"
import {AutoRenewalCancelModalContentProps} from "../types"

const AutoRenewalCancelModalContent = ({
    value,
    onChange,
    inputValue,
    onChangeInput,
}: AutoRenewalCancelModalContentProps) => {
    return (
        <section className="flex flex-col gap-2 mt-5">
            <span className="font-medium">Please select one of the reasons</span>
            <RadioGroup
                value={value}
                onValueChange={(next) => onChange(String(next))}
                className="flex flex-col gap-2"
            >
                {CANCEL_REASONS.map((option) => (
                    <Label
                        key={option.value}
                        className="flex items-center gap-2 font-normal cursor-pointer"
                    >
                        <RadioGroupItem value={option.value} />
                        {option.label}
                    </Label>
                ))}
            </RadioGroup>
            {value === "something-else" && (
                <Input placeholder="Type here" value={inputValue} onChange={onChangeInput} />
            )}
        </section>
    )
}

export default memo(AutoRenewalCancelModalContent)
