import {toolCatalogDrawerOpenAtom} from "@agenta/entities/gatewayTool"
import {
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import {useHasOpened} from "@agenta/ui/hooks"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

const CatalogDrawer = dynamic(
    () => import("@agenta/entity-ui/gatewayTool").then((m) => m.CatalogDrawer),
    {ssr: false},
)
const AutomationDrawer = dynamic(
    () => import("@agenta/automation-ui").then((m) => m.AutomationDrawer),
    {ssr: false},
)

/**
 * The drawers an atom opens from anywhere in the workspace. They sit here, not in the config pane,
 * because the agent's connect widget and a linked automation open them while that pane is
 * collapsed or absent. A dynamic component starts its download when it first renders, so each one
 * renders from its first open: the atom is the only way in, and both show nothing when closed.
 */
export const SessionWorkspaceDrawers = () => {
    const schedule = useAtomValue(triggerScheduleDrawerAtom)
    const subscription = useAtomValue(triggerSubscriptionDrawerAtom)
    const catalogOpened = useHasOpened(useAtomValue(toolCatalogDrawerOpenAtom))
    const automationOpened = useHasOpened(Boolean(schedule ?? subscription))

    return (
        <>
            {catalogOpened ? <CatalogDrawer /> : null}
            {automationOpened ? <AutomationDrawer /> : null}
        </>
    )
}
