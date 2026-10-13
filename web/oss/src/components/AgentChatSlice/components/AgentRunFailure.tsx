import {RunFailureCallout, type RunFailureCalloutProps} from "@agenta/chat/components"

import {useBillingEscapes} from "../hooks/useBillingEscapes"

/**
 * The shared run-failure callout with this app's billing escapes: the plans for a plan limit, and
 * the pack picker for running out of credits. Its own component so only a failed turn reads the
 * router and asks the API.
 */
const AgentRunFailure = (props: Omit<RunFailureCalloutProps, "onOpenBilling" | "onBuyCredits">) => {
    const {onOpenBilling, onBuyCredits} = useBillingEscapes(props.code)
    return (
        <RunFailureCallout {...props} onOpenBilling={onOpenBilling} onBuyCredits={onBuyCredits} />
    )
}

export default AgentRunFailure
