/**
 * Usage & Billing — the cancellation questionnaire.
 *
 * The body of the host's cancel-auto-renewal dialog. It collects the reason; confirming the
 * cancellation is the host's call.
 */

import {Input, Label, RadioGroup, RadioGroupItem} from "@agenta/ui/ui"

/** The free-text reason. The host gates confirmation on the note being filled in. */
export const CANCEL_REASON_OTHER = "something-else"

export const CANCEL_REASONS = [
    {value: "dont-want-auto-renewal", label: "I don't want to continue with auto-renewal"},
    {value: "done-with-project", label: "I am done with my project"},
    {value: "switching-to-another-service", label: "I'm switching to another service"},
    {value: "technical-issues", label: "The product has technical issues"},
    {value: "missing-features", label: "The product doesn't have features I wanted"},
    {value: "too-expensive", label: "It's too expensive"},
    {value: "not-used-enough", label: "I don't use it enough"},
    {value: CANCEL_REASON_OTHER, label: "Something else"},
]

export interface CancelSubscriptionReasonsProps {
    value: string
    onChange: (value: string) => void
    otherReason: string
    onOtherReasonChange: (value: string) => void
}

export const CancelSubscriptionReasons = ({
    value,
    onChange,
    otherReason,
    onOtherReasonChange,
}: CancelSubscriptionReasonsProps) => (
    <section className="mt-5 flex flex-col gap-2">
        <span className="font-medium text-colorText">Please select one of the reasons</span>

        <RadioGroup value={value} onValueChange={onChange} className="flex flex-col gap-2">
            {CANCEL_REASONS.map((reason) => (
                <Label key={reason.value} className="flex cursor-pointer items-center gap-2">
                    <RadioGroupItem value={reason.value} />
                    <span className="text-colorText">{reason.label}</span>
                </Label>
            ))}
        </RadioGroup>

        {value === CANCEL_REASON_OTHER ? (
            <Input
                placeholder="Type here"
                value={otherReason}
                onChange={(event) => onOtherReasonChange(event.target.value)}
            />
        ) : null}
    </section>
)

export default CancelSubscriptionReasons
