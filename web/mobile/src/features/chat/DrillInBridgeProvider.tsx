import {type PropsWithChildren, useCallback, useMemo} from "react"

import {
    DrillInUIProvider,
    GatewayToolsBridgeProvider,
    useWorkflowReferenceBridge,
    type DrillInUIComponents,
} from "@agenta/entity-ui/drill-in"
import {CatalogDrawer} from "@agenta/entity-ui/gatewayTool"
import {useLLMProviderConfig} from "@agenta/entity-ui/secretProvider"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {isEE} from "@agenta/shared/api"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {getDefaultStore, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useProjectPermission} from "../context/useProjectPermission"

import {selectedRevisionAtomFamily} from "./selectedRevision"

const openTrace = ({traceId, spanId}: {traceId: string; spanId?: string | null}) => {
    if (!traceId) return
    getDefaultStore().set(openTraceDrawerAtom, {traceId, activeSpanId: spanId})
}

/**
 * The host facts the shared config panel reads off DrillInUIContext — the same set the desktop
 * provider supplies, from the same packages, so the two surfaces cannot drift.
 *
 * Only the "Open agent" link differs: it lands on this app's agent overview, not the desktop
 * playground, because routes are the one thing a host genuinely owns.
 */
export const DrillInBridgeProvider = ({
    children,
    sessionId,
    projectId,
}: PropsWithChildren<{sessionId: string; projectId: string}>) => {
    const {llmProviderConfig, overlay: llmProviderOverlay} = useLLMProviderConfig()
    const baseWorkflowReference = useWorkflowReferenceBridge()
    const router = useRouter()
    const {workspace_id: workspaceId} = router.query
    // A bare <a target="_blank">, so the `/m` basePath has to be spelled out here.
    const agentBase =
        typeof workspaceId === "string"
            ? `${router.basePath}/w/${workspaceId}/p/${projectId}/agents`
            : null

    const workflowReference = useMemo(
        () => ({
            ...baseWorkflowReference,
            agentHref: (workflowId: string) => (agentBase ? `${agentBase}/${workflowId}` : null),
        }),
        [baseWorkflowReference, agentBase],
    )

    const canEditSecrets = useProjectPermission(projectId, "edit_secret")
    const permissions = useMemo(() => ({canEditSecrets}), [canEditSecrets])
    const pinRevision = useSetAtom(selectedRevisionAtomFamily(sessionId))
    const onWorkflowRevisionCommitted = useCallback(
        (revisionId: string) => pinRevision(revisionId),
        [pinRevision],
    )

    // Deployment policy never changes at runtime; a stable identity keeps the context value stable.
    const deployment = useMemo(() => ({isCloud: isEE()}), [])

    const components = useMemo(
        () =>
            ({
                llmProviderConfig,
                EditorProvider,
                SharedEditor,
                workflowReference,
                openTrace,
                deployment,
                permissions,
                onWorkflowRevisionCommitted,
            }) as DrillInUIComponents,
        [
            llmProviderConfig,
            workflowReference,
            deployment,
            permissions,
            onWorkflowRevisionCommitted,
        ],
    )

    return (
        <>
            <DrillInUIProvider components={components}>
                <GatewayToolsBridgeProvider>{children}</GatewayToolsBridgeProvider>
            </DrillInUIProvider>
            {llmProviderOverlay}
            {/* The catalog hand-off only sets an atom — unmounted, that action does nothing. */}
            <CatalogDrawer />
        </>
    )
}
