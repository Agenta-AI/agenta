import {useCallback} from "react"

import {BUY_CREDITS_CODES, planLimitTitle} from "@agenta/chat/components"
import {useTopUpOffer} from "@agenta/settings-ui"
import {isBillingEnabled} from "@agenta/shared/api"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"

/**
 * The run-failure callout's two billing escapes on this app: the plans (Settings -> Usage &
 * Billing) for any plan limit, and the pack picker on the same page for the out-of-credit class
 * where the organization can buy a pack.
 *
 * Both appear only for an organization whose wallet is enforced, read from the API's top-up
 * answer (`paid_plan_required` or `available` are answered only then). Organizations with the
 * wallet off or in shadow see this callout exactly as before. Each is also undefined where it
 * would open nothing: billing off, or no project route. Asks the API only once a turn carries a
 * plan-limit class.
 */
export const useBillingEscapes = (
    code: string | null | undefined,
): {onOpenBilling?: () => void; onBuyCredits?: () => void} => {
    const router = useRouter()
    const {projectURL} = useURL()
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : null
    const available = isBillingEnabled() && Boolean(projectURL) && Boolean(projectId)
    const planLimit = available && Boolean(planLimitTitle(code))
    const offer = useTopUpOffer({projectId, enabled: planLimit})
    const status = offer.data?.status
    const enforced = status === "available" || status === "paid_plan_required"

    const openBilling = useCallback(() => {
        void router.push(`${projectURL}/settings?tab=billing`)
    }, [router, projectURL])

    const openPacks = useCallback(() => {
        void router.push(`${projectURL}/settings?tab=billing&buy_credits=1`)
    }, [router, projectURL])

    return {
        onOpenBilling: planLimit && enforced ? openBilling : undefined,
        onBuyCredits:
            planLimit && status === "available" && !!code && BUY_CREDITS_CODES.has(code)
                ? openPacks
                : undefined,
    }
}
