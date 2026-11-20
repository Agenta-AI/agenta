import type {MutableRefObject} from "react"

import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {DrawerViewChrome, ViewStackHost} from "@agenta/ui/view-stack"

import {PageViewStackGuard, type PageViewStackGuardApi} from "../agent-pages/PageViewStackGuard"

import {AutomationTabRoot} from "./AutomationTabRoot"

/** An automation tab: the automation view in its own view stack. */
export const AutomationTabContent = ({
    automationId,
    name,
    guardRef,
    workspaceId,
    projectId,
}: {
    automationId: string
    name: string
    guardRef: MutableRefObject<PageViewStackGuardApi | null>
    workspaceId: string
    projectId: string
}) => {
    const t = useT(builderPageCatalog)
    return (
        <ViewStackHost
            chrome={DrawerViewChrome}
            rootTitle={name || t("builder.page.kindAutomation")}
        >
            <PageViewStackGuard guardRef={guardRef} />
            <AutomationTabRoot
                automationId={automationId}
                workspaceId={workspaceId}
                projectId={projectId}
            />
        </ViewStackHost>
    )
}
