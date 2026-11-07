/**
 * Usage & Billing — the cancellation questionnaire.
 *
 * The body of the host's cancel-auto-renewal dialog. It collects the reason; confirming the
 * cancellation is the host's call.
 */

import {useT, type CatalogKey} from "@agenta/i18n"
import billingPageCatalog from "@agenta/i18n/catalogs/billing.page"
import {Input, Label, RadioGroup, RadioGroupItem} from "@agenta/ui/ui"

/** The free-text reason. The host gates confirmation on the note being filled in. */
export const CANCEL_REASON_OTHER = "something-else"

export const CANCEL_REASONS: {value: string; label: CatalogKey<typeof billingPageCatalog>}[] = [
    {value: "dont-want-auto-renewal", label: "billing.page.reasonNoAutoRenewal"},
    {value: "done-with-project", label: "billing.page.reasonDoneWithProject"},
    {value: "switching-to-another-service", label: "billing.page.reasonSwitching"},
    {value: "technical-issues", label: "billing.page.reasonTechnicalIssues"},
    {value: "missing-features", label: "billing.page.reasonMissingFeatures"},
    {value: "too-expensive", label: "billing.page.reasonTooExpensive"},
    {value: "not-used-enough", label: "billing.page.reasonNotUsedEnough"},
    {value: CANCEL_REASON_OTHER, label: "billing.page.reasonSomethingElse"},
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
}: CancelSubscriptionReasonsProps) => {
    const t = useT(billingPageCatalog)
    return (
        <section className="mt-5 flex flex-col gap-2">
            <span className="font-medium text-colorText">{t("billing.page.selectReason")}</span>

            <RadioGroup value={value} onValueChange={onChange} className="flex flex-col gap-2">
                {CANCEL_REASONS.map((reason) => (
                    <Label key={reason.value} className="flex cursor-pointer items-center gap-2">
                        <RadioGroupItem value={reason.value} />
                        <span className="text-colorText">{t(reason.label)}</span>
                    </Label>
                ))}
            </RadioGroup>

            {value === CANCEL_REASON_OTHER ? (
                <Input
                    placeholder={t("billing.page.typeHere")}
                    value={otherReason}
                    onChange={(event) => onOtherReasonChange(event.target.value)}
                />
            ) : null}
        </section>
    )
}

export default CancelSubscriptionReasons
