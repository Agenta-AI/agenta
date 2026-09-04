/**
 * OSSdrillInUIProvider
 *
 * Provides OSS-specific UI components to the DrillInView package components
 * via the DrillInUIProvider context.
 *
 * Most of what used to be assembled here now lives in the packages — the gateway-tools bridge
 * (GatewayToolsBridgeProvider) and the model-provider bridge (useLLMProviderConfig) — so `/m`
 * mounts the identical wiring. What is left is genuinely app-specific: this app's routes.
 *
 * @example
 * ```tsx
 * // Wrap your app or feature root with this provider
 * function App() {
 *   return (
 *     <OSSdrillInUIProvider>
 *       <YourContent />
 *     </OSSdrillInUIProvider>
 *   )
 * }
 * ```
 */

import {useMemo, type ReactNode} from "react"

import {
    DrillInUIProvider,
    GatewayToolsBridgeProvider,
    useWorkflowReferenceBridge,
    type DrillInUIComponents,
} from "@agenta/entity-ui/drill-in"
import {useLLMProviderConfig} from "@agenta/entity-ui/secretProvider"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {getDefaultStore} from "jotai"

import useURL from "@/oss/hooks/useURL"
import {isDemo} from "@/oss/lib/helpers/utils"

interface OSSdrillInUIProviderProps {
    children: ReactNode
}

const openTrace = ({traceId, spanId}: {traceId: string; spanId?: string | null}) => {
    if (!traceId) return
    getDefaultStore().set(openTraceDrawerAtom, {traceId, activeSpanId: spanId})
}

/**
 * OSS-specific UI provider for DrillInView components.
 *
 * Injects:
 * - llmProviderConfig: vault secrets as extra option groups + "Add provider" footer
 * - EditorProvider / SharedEditor: rich text editor components
 * - gatewayTools: gateway tools data + actions bridge for the tool selector
 * - workflowReference: workflow-as-tool reference bridge for the tool selector
 *
 * All other UI components (ChatMessage, FieldHeader, etc.) are imported
 * directly from @agenta/ui in the entities package.
 */
export function OSSdrillInUIProvider({children}: OSSdrillInUIProviderProps) {
    const {llmProviderConfig, overlay: llmProviderOverlay} = useLLMProviderConfig()
    const baseWorkflowReference = useWorkflowReferenceBridge()
    const {baseAppURL} = useURL()
    // Only the app knows its routes, so the "Open agent" link is supplied here.
    const workflowReference = useMemo(
        () => ({
            ...baseWorkflowReference,
            agentHref: (workflowId: string) =>
                baseAppURL ? `${baseAppURL}/${workflowId}/playground` : null,
        }),
        [baseWorkflowReference, baseAppURL],
    )
    // Deployment policy never changes at runtime; a stable identity keeps the context value stable.
    const deployment = useMemo(() => ({isCloud: isDemo()}), [])

    // Stable context value: every DrillInUIContext consumer re-renders when this identity changes.
    const components = useMemo(
        () =>
            ({
                llmProviderConfig,
                EditorProvider,
                SharedEditor,
                workflowReference,
                openTrace,
                deployment,
                // Rich concrete components vs the context's index-signature slots (pre-existing gap)
            }) as DrillInUIComponents,
        // openTrace is a module-level const (stable) — no dep needed.
        [llmProviderConfig, workflowReference, deployment],
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

export default OSSdrillInUIProvider
