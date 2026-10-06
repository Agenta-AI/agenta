import {useCallback} from "react"

import {BUY_CREDITS_CODES, planLimitTitle} from "@agenta/chat/components"
import {useTopUpOffer} from "@agenta/settings-ui"
import {isBillingEnabled} from "@agenta/shared/api"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"

/**
 * The run-failure callout's two billing escapes on this app: the plans (Settings -> Usage &
 * Billing) for any plan limit, and the pack picker on the same page for the out-of-credit class
 * where the organization can buy a pack. Each is undefined where it would open nothing: billing
 * off, no project route, or (for packs) a plan the checkout refuses. Asks the API about packs
 * only once a turn carries the out-of-credit class.
 */
export const useBillingEscapes = (
    code: string | null | undefined,
): {onOpenBilling?: () => void; onBuyCredits?: () => void} => {
    const router = useRouter()
    const {projectURL} = useURL()
    const projectId = typeof router.query.project_id === "string" ? router.query.project_id : null
    const available = isBillingEnabled() && Boolean(projectURL) && Boolean(projectId)
    const wantsPacks = available && !!code && BUY_CREDITS_CODES.has(code)
    const offer = useTopUpOffer({projectId, enabled: wantsPacks})

    const openBilling = useCallback(() => {
        void router.push(`${projectURL}/settings?tab=billing`)
    }, [router, projectURL])

    const openPacks = useCallback(() => {
        void router.push(`${projectURL}/settings?tab=billing&buy_credits=1`)
    }, [router, projectURL])

    return {
        onOpenBilling: available && planLimitTitle(code) ? openBilling : undefined,
        onBuyCredits: wantsPacks && offer.data?.status === "available" ? openPacks : undefined,
    }
}
