import {Alert, Button} from "@agenta/ui/ui"

import {formatCreditCount} from "./topUpRules"
import {useTopUpLanding} from "./useTopUpLanding"

/**
 * The result of one paid checkout: waiting for the payment event, credited, or still waiting
 * after the timeout (with a way to check again). Keyed by Checkout session by its parent.
 */
export const TopUpPaymentNotice = ({
    projectId,
    checkoutSessionId,
    onClose,
}: {
    projectId: string
    checkoutSessionId: string
    onClose: () => void
}) => {
    const landing = useTopUpLanding({projectId, checkoutSessionId})

    if (landing.state === "landed")
        return (
            <Alert
                type="success"
                showIcon
                closable
                onClose={onClose}
                message="Credits added"
                description={
                    landing.credits !== null
                        ? `${formatCreditCount(landing.credits)} purchased credits are now available.`
                        : "Your purchased credits are now available."
                }
            />
        )

    if (landing.state === "timed_out")
        return (
            <Alert
                type="warning"
                showIcon
                closable
                onClose={onClose}
                message="Payment received"
                description="The credits have not appeared yet. Check again in a few minutes. If they do not appear, contact support."
                action={
                    <Button size="sm" variant="outline" onClick={landing.retry}>
                        Check again
                    </Button>
                }
            />
        )

    return (
        <Alert
            type="info"
            showIcon
            message="Payment received"
            description="Your credits will appear here shortly."
        />
    )
}

export default TopUpPaymentNotice
