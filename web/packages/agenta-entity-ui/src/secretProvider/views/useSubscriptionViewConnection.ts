import {useContext} from "react"

import {providerConnectionsAtom, subscriptionConnectionFor} from "@agenta/entities/secret"
import {useAtomValue} from "jotai"

import {SubscriptionOwnerContext, type SubscriptionViewParams} from "./subscriptionViews"

/** The connection a subscription view signs in, and the organization when it is the owner. */
export const useSubscriptionViewConnection = ({provider, connectionId}: SubscriptionViewParams) => {
    const owner = useContext(SubscriptionOwnerContext)
    const project = useAtomValue(providerConnectionsAtom)
    const connections = owner?.connections ?? project
    const connection =
        (connectionId
            ? connections.find((candidate) => candidate.id === connectionId)
            : subscriptionConnectionFor(connections, provider)) ?? null
    return {connection, organization: owner?.organization ?? null}
}
