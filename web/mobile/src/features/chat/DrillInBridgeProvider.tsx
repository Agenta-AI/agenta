import {type PropsWithChildren, useMemo} from "react"

import {DrillInUIProvider, useWorkflowReferenceBridge} from "@agenta/entity-ui/drill-in"
import {useSkillsBridge} from "@agenta/skills-ui"

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
    // Registry-backed "Add skill" flow — without this /m keeps the inline-skill editor.
    const skills = useSkillsBridge()
    const components = useMemo(() => ({workflowReference, skills}), [workflowReference, skills])

    return <DrillInUIProvider components={components}>{children}</DrillInUIProvider>
}
