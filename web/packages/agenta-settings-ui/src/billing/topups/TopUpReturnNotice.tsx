import {useT} from "@agenta/i18n"
import billingTopupsCatalog from "@agenta/i18n/catalogs/billing.topups"
import {Alert} from "@agenta/ui/ui"

import {TopUpPaymentNotice} from "./TopUpPaymentNotice"
import type {TopUpReturn} from "./topUpRules"

/** What happened at Stripe, on the page the payer came back to. */
export const TopUpReturnNotice = ({
    projectId,
    topUpReturn,
    onClose,
}: {
    projectId: string
    topUpReturn: Exclude<TopUpReturn, null>
    onClose: () => void
}) => {
    const t = useT(billingTopupsCatalog)
    if (topUpReturn.result === "cancelled")
        return (
            <Alert
                type="info"
                showIcon
                closable
                onClose={onClose}
                message={t("billing.topups.checkoutCancelled")}
            />
        )

    // A return without its session cannot be matched to a purchase, so nothing is polled.
    if (!topUpReturn.sessionId)
        return (
            <Alert
                type="info"
                showIcon
                closable
                onClose={onClose}
                message={t("billing.topups.paymentReceived")}
                description={t("billing.topups.creditsSoon")}
            />
        )

    return (
        <TopUpPaymentNotice
            key={topUpReturn.sessionId}
            projectId={projectId}
            checkoutSessionId={topUpReturn.sessionId}
            onClose={onClose}
        />
    )
}

export default TopUpReturnNotice
