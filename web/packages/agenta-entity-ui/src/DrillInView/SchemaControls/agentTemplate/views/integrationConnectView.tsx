import {defineView} from "@agenta/ui/view-stack"

import type {ConnectionOwner} from "../../../../gatewayTool/components/ConnectForm"

import {lazyView} from "./lazyView"

export interface IntegrationConnectViewParams {
    /** The app to connect. */
    integrationKey: string
    /**
     * Who may own the new connection; the first is the default. Two ask "Who can use it".
     * Absent, the connection is the project's.
     */
    owners?: ConnectionOwner[]
}

/**
 * Connect an app (F02 f5). Its target is always the project: Connect stores the connection there
 * at once. Adding it to an agent is a separate write by the view that opened this one.
 */
export const integrationConnectView = defineView<IntegrationConnectViewParams>({
    id: "integration.connect",
    apply: "on_save",
    Component: lazyView(() => import("./IntegrationConnectViewBody")),
})
