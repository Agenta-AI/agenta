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
    if (topUpReturn.result === "cancelled")
        return (
            <Alert
                type="info"
                showIcon
                closable
                onClose={onClose}
                message="Checkout cancelled. You were not charged."
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
                message="Payment received"
                description="Your credits will appear here shortly."
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
