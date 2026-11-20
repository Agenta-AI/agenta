import {defineView} from "@agenta/ui/view-stack"

import {CatalogRowSkeleton} from "../CatalogRowSkeleton"

import {lazyView} from "./lazyView"

export type IntegrationAddViewParams = Record<string, never>

/**
 * "Add integration" (F02 f4): a picker. A click on a connected app adds it to the agent at once;
 * "Connect" opens the connect view at depth 2 with the target project, and the new connection is
 * added here when it shows up. Done goes back.
 */
export const integrationAddView = defineView<IntegrationAddViewParams>({
    id: "agent.integration.add",
    apply: "immediate",
    Component: lazyView(
        () => import("./IntegrationAddViewBody"),
        <div className="px-4 py-3">
            <CatalogRowSkeleton />
        </div>,
    ),
})
