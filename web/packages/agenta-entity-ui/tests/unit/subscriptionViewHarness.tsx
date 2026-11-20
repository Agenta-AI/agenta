/** Mounts one subscription view in a view stack, the way a drawer host opens it. */
import {useEffect, type ReactNode} from "react"

import type {ProviderConnection} from "@agenta/entities/secret"
import {
    ViewFormActions,
    ViewStackHost,
    useViewStack,
    type ViewChromeProps,
} from "@agenta/ui/view-stack"

import type {OrganizationConnectionScope} from "../../src/secretProvider/OrganizationProjectsSection"
import {
    SubscriptionOwnerContext,
    subscriptionViewFor,
} from "../../src/secretProvider/views/subscriptionViews"

const Chrome = ({crumbs, children, ...actions}: ViewChromeProps) => (
    <div>
        <nav>
            {crumbs.map((crumb, i) => (
                <span key={i}>{`here:${crumb.title}`}</span>
            ))}
        </nav>
        {children}
        <ViewFormActions {...actions} />
    </div>
)

const Open = ({provider, connectionId}: {provider: string; connectionId?: string}) => {
    const stack = useViewStack()
    useEffect(() => {
        void stack.open(subscriptionViewFor(provider), {provider, connectionId}, {kind: "project"})
    }, [])
    return <span>{`depth:${stack.depth}`}</span>
}

export const SubscriptionViewStage = ({
    provider,
    connection,
    organization,
    wrap = (node) => node,
}: {
    provider: string
    connection: ProviderConnection | null
    organization?: OrganizationConnectionScope
    wrap?: (node: ReactNode) => ReactNode
}) => (
    <SubscriptionOwnerContext.Provider
        value={{connections: connection ? [connection] : [], organization}}
    >
        {wrap(
            <ViewStackHost chrome={Chrome}>
                <Open provider={provider} connectionId={connection?.id} />
            </ViewStackHost>,
        )}
    </SubscriptionOwnerContext.Provider>
)

/** The view bodies load on first open; load them once so no test waits on the import. */
export const loadSubscriptionViews = () =>
    Promise.all([
        import("../../src/secretProvider/views/SubscriptionSignInViewBody"),
        import("../../src/secretProvider/views/SubscriptionTokenViewBody"),
    ])
