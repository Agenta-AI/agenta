import {type PropsWithChildren, useCallback, useMemo} from "react"

import {DrillInUIProvider, useWorkflowReferenceBridge} from "@agenta/entity-ui/drill-in"
import {useSetAtom} from "jotai"

import {useProjectPermission} from "../context/useProjectPermission"

import {selectedRevisionAtomFamily} from "./selectedRevision"

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
export const DrillInBridgeProvider = ({
    children,
    sessionId,
    projectId,
}: PropsWithChildren<{sessionId: string; projectId: string}>) => {
    const workflowReference = useWorkflowReferenceBridge()
    const canEditSecrets = useProjectPermission(projectId, "edit_secret")
    const pinRevision = useSetAtom(selectedRevisionAtomFamily(sessionId))
    const onWorkflowRevisionCommitted = useCallback(
        (revisionId: string) => pinRevision(revisionId),
        [pinRevision],
    )
    const components = useMemo(
        () => ({
            workflowReference,
            permissions: {canEditSecrets},
            onWorkflowRevisionCommitted,
        }),
        [workflowReference, canEditSecrets, onWorkflowRevisionCommitted],
    )

    return <DrillInUIProvider components={components}>{children}</DrillInUIProvider>
}
