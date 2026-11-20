/**
 * The subscription views (F11 f8 to f10), with the target `project`. The add view opens them with
 * `nav.replace`, the list with `nav.push`.
 *
 * - `subscriptionSignInView`: the device code sign-in (ChatGPT). Opening it starts the sign-in;
 *   closing it cancels the sign-in and stops the poll. It goes back by itself when the sign-in
 *   arrives.
 * - `subscriptionTokenView`: the pasted token (Claude). Save ("Connect") stores the token.
 */
import {subscriptionConnectMethod} from "@agenta/entities/secret"
import {defineView, type ViewDef} from "@agenta/ui/view-stack"

import {lazyView} from "../../DrillInView/SchemaControls/agentTemplate/views/lazyView"

export interface SubscriptionViewParams {
    /** The subscription product (`chatgpt`, `claude`). */
    provider: string
    /** The saved connection. Absent: the project's connection for the product, if it has one. */
    connectionId?: string
    /** Opened from "Add a provider or subscription": Cancel returns there. */
    fromAdd?: boolean
}

export const subscriptionSignInView = defineView<SubscriptionViewParams>({
    id: "project.modelProviders.subscriptionSignIn",
    apply: "immediate",
    Component: lazyView(() => import("./SubscriptionSignInViewBody")),
})

export const subscriptionTokenView = defineView<SubscriptionViewParams>({
    id: "project.modelProviders.subscriptionToken",
    apply: "on_save",
    Component: lazyView(() => import("./SubscriptionTokenViewBody")),
})

/** The view that connects a subscription product. */
export const subscriptionViewFor = (provider: string): ViewDef<SubscriptionViewParams> =>
    subscriptionConnectMethod(provider) === "token" ? subscriptionTokenView : subscriptionSignInView
