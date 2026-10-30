import {type PropsWithChildren, useCallback, useMemo} from "react"

import {canViewSpansAtom} from "@agenta/entities/access"
import {
    DrillInUIProvider,
    GatewayToolsBridgeProvider,
    useWorkflowReferenceBridge,
    type DrillInUIComponents,
} from "@agenta/entity-ui/drill-in"
import {useLLMProviderConfig} from "@agenta/entity-ui/secretProvider"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {isEE} from "@agenta/shared/api"
import {useSkillsBridge} from "@agenta/skills-ui"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {getDefaultStore, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {agentEntryHref} from "../agents/agentEntry"
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
    const projectBase =
        typeof workspaceId === "string"
            ? `${router.basePath}/w/${workspaceId}/p/${projectId}`
            : null

    // Registry-backed "Add skill" flow — without this /m keeps the inline-skill editor.
    const skills = useSkillsBridge()

    const workflowReference = useMemo(
        () => ({
            ...baseWorkflowReference,
            agentHref: (workflowId: string) =>
                projectBase ? agentEntryHref(projectBase, workflowId) : null,
        }),
        [baseWorkflowReference, projectBase],
    )

    const canEditSecrets = useProjectPermission(projectId, "edit_secret")
    // No trace access, no trace openers: the config pane and the delivery rows hide theirs.
    const canViewSpans = useAtomValue(canViewSpansAtom)
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
                skills,
                openTrace: canViewSpans ? openTrace : undefined,
                deployment,
                permissions,
                onWorkflowRevisionCommitted,
            }) as DrillInUIComponents,
        [
            canViewSpans,
            llmProviderConfig,
            workflowReference,
            skills,
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
        </>
    )
}
