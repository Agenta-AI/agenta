import type {ReactNode} from "react"

import {useBillingRoute, useCanBuyCredits, useProviderRecovery} from "./providerRecovery"
import {
    describeRunFailure,
    RunErrorMessage,
    type RunErrorInput,
    type RunFailureView,
} from "./RunErrorMessage"
import {RunErrorRecovery} from "./RunErrorRecovery"

/**
 * A failed turn's message, ways out and footer. Its own component so only a failed turn subscribes
 * to the router and the credit offer, not every row of a long transcript.
 */
export const TurnRunFailure = ({
    failure,
    renderFooter,
}: {
    failure: Omit<RunErrorInput, "can" | "onSignIn">
    renderFooter: (view: RunFailureView) => ReactNode
}) => {
    const openProviders = useProviderRecovery()
    const openBilling = useBillingRoute()
    const canBuyCredits = useCanBuyCredits(failure.code)
    const view = describeRunFailure({
        ...failure,
        can: {providers: !!openProviders, buyCredits: canBuyCredits, plans: !!openBilling},
        onSignIn: openProviders,
    })
    return (
        <>
            <RunErrorMessage paragraphs={view.paragraphs} quote={view.quote} />
            <RunErrorRecovery actions={view.recoveries} />
            {renderFooter(view)}
        </>
    )
}
