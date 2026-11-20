import type {ConfigItemRef} from "@agenta/ui/view-stack"
import {defineView} from "@agenta/ui/view-stack"

import {ToolPermissionsSkeleton} from "../../DrawerSkeletons"

import {lazyView} from "./lazyView"

export interface IntegrationViewParams {
    /** The integration, by its key in the agent's tools. */
    item: ConfigItemRef
    readOnly?: boolean
}

/**
 * One integration of the agent (F02 f6): the account, the default permission and the per-tool
 * permissions, as today. Every change writes the agent configuration at once; Done goes back.
 */
export const integrationView = defineView<IntegrationViewParams>({
    id: "agent.integration",
    apply: "immediate",
    Component: lazyView(() => import("./IntegrationViewBody"), <ToolPermissionsSkeleton />),
})
