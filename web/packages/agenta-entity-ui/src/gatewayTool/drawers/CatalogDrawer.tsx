import {toolCatalogDrawerOpenAtom} from "@agenta/entities/gatewayTool"
import {ViewDrawerHost, type ViewRequest} from "@agenta/ui/view-stack"
import {useAtom} from "jotai"

import {integrationAddView} from "../../DrillInView/SchemaControls/agentTemplate/views/integrationAddView"

// The one integration catalog with the target project: it browses and connects, adds to no agent.
const REQUEST: ViewRequest<Record<string, never>> = {
    view: integrationAddView,
    params: {},
    target: {kind: "project"},
}

/** The integration catalog in a drawer, for the hosts that keep one (chat, playground, prompts). */
export default function CatalogDrawer() {
    const [open, setOpen] = useAtom(toolCatalogDrawerOpenAtom)
    return open ? <ViewDrawerHost request={REQUEST} onClosed={() => setOpen(false)} /> : null
}
