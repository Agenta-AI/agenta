import {type PropsWithChildren, useMemo} from "react"

import {DrillInUIProvider, useWorkflowReferenceBridge} from "@agenta/entity-ui/drill-in"

/**
 * The host facts the shared config panel reads off DrillInUIContext.
 *
 * Today that is the workflow-as-tool reference bridge, which is what makes the Tools picker offer
 * "Reference a workflow" and lets an existing reference render its bound version — the same bridge
 * the desktop provider builds, imported rather than reproduced.
 *
 * The editor slots stay unset on purpose: this app has no Lexical, and the drill-in controls fall
 * back to plain inputs when they are absent.
 */
export const DrillInBridgeProvider = ({children}: PropsWithChildren) => {
    const workflowReference = useWorkflowReferenceBridge()
    const components = useMemo(() => ({workflowReference}), [workflowReference])

    return <DrillInUIProvider components={components}>{children}</DrillInUIProvider>
}
