/**
 * The subscription views (F11 f8 to f10), with the target `project`. The add view opens them with
 * `nav.replace`, the list with `nav.push`, a host without a stack in its own drawer.
 *
 * - `subscriptionSignInView`: the device sign-in (ChatGPT). Opening it starts the sign-in;
 *   closing it cancels the sign-in and stops the poll. It goes back by itself when the sign-in
 *   arrives.
 * - `subscriptionTokenView`: the pasted token (Claude). Save ("Connect") stores the token.
 *
 * The views read the project's connections. A host that shows another owner's subscriptions
 * (the organization's) wraps its container in `SubscriptionOwnerContext`.
 */
import {createContext} from "react"

import {subscriptionConnectMethod, type ProviderConnection} from "@agenta/entities/secret"
import {defineView, type ViewDef} from "@agenta/ui/view-stack"

import {lazyView} from "../../DrillInView/SchemaControls/agentTemplate/views/lazyView"
import type {OrganizationConnectionScope} from "../OrganizationProjectsSection"

export interface SubscriptionViewParams {
    /** The subscription product (`chatgpt`, `claude`). */
    provider: string
    /** The saved connection. Absent: the owner's connection for the product, if it has one. */
    connectionId?: string
}

/** Whose subscriptions the views sign in, when they are not the project's own. */
export interface SubscriptionOwner {
    /** The owner's connections, where a view finds the one it signs in. */
    connections: readonly ProviderConnection[]
    /** The organization: the views sign in on its routes and offer "Projects that can use it". */
    organization?: OrganizationConnectionScope
}

export const SubscriptionOwnerContext = createContext<SubscriptionOwner | null>(null)

export const subscriptionSignInView = defineView<SubscriptionViewParams>({
    id: "project.modelProviders.subscriptionSignIn",
    apply: "immediate",
    Component: lazyView(() => import("./SubscriptionSignInViewBody")),
})

export const subscriptionTokenView = defineView<SubscriptionViewParams>({
    id: "project.modelProviders.subscriptionToken",
    apply: "on_save",
    // Connect and Cancel are in the view's card (F11 f10), not in an action row.
    actionRow: false,
    Component: lazyView(() => import("./SubscriptionTokenViewBody")),
})

/** The view that connects a subscription product. */
export const subscriptionViewFor = (provider: string): ViewDef<SubscriptionViewParams> =>
    subscriptionConnectMethod(provider) === "token" ? subscriptionTokenView : subscriptionSignInView

/** The view and params that open one subscription connection. */
export const subscriptionViewOf = (
    connection: ProviderConnection,
): {view: ViewDef<SubscriptionViewParams>; params: SubscriptionViewParams} => {
    const provider = connection.subscription?.provider ?? ""
    return {view: subscriptionViewFor(provider), params: {provider, connectionId: connection.id}}
}
