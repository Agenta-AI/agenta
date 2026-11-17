import {useT} from "@agenta/i18n"
import billingTopupsCatalog from "@agenta/i18n/catalogs/billing.topups"
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
    const t = useT(billingTopupsCatalog)
    const landing = useTopUpLanding({projectId, checkoutSessionId})

    if (landing.state === "landed")
        return (
            <Alert
                type="success"
                showIcon
                closable
                onClose={onClose}
                message={t("billing.topups.creditsAdded")}
                description={
                    landing.credits !== null
                        ? t("billing.topups.creditsAvailableCount", {
                              credits: formatCreditCount(landing.credits),
                          })
                        : t("billing.topups.creditsAvailable")
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
                message={t("billing.topups.paymentReceived")}
                description={t("billing.topups.creditsDelayed")}
                action={
                    <Button size="sm" variant="outline" onClick={landing.retry}>
                        {t("billing.topups.checkAgain")}
                    </Button>
                }
            />
        )

    return (
        <Alert
            type="info"
            showIcon
            message={t("billing.topups.paymentReceived")}
            description={t("billing.topups.creditsSoon")}
        />
    )
}

export default TopUpPaymentNotice
