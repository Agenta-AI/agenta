import {defineView} from "@agenta/ui/view-stack"

import {CatalogListSkeleton} from "../CatalogRowSkeleton"

import {lazyView} from "./lazyView"

export type IntegrationAddViewParams = Record<string, never>

/** "Add integration" (F02 f4); with the target project it only browses and connects (chat, playground). */
export const integrationAddView = defineView<IntegrationAddViewParams>({
    id: "agent.integration.add",
    apply: "immediate",
    Component: lazyView(
        () => import("./IntegrationAddViewBody"),
        // Connected, then All apps, beside the 144 px category select.
        <CatalogListSkeleton action="w-36" groups={[3, 6]} />,
    ),
})
