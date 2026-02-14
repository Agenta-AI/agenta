/**
 * OSSdrillInUIProvider
 *
 * Provides OSS-specific UI components to the DrillInView package components
 * via the DrillInUIProvider context.
 *
 * Most UI components (Editor, ChatMessage, FieldHeader, etc.) are now imported
 * directly from @agenta/ui in the entities package. This provider only needs
 * to inject truly app-specific components that have OSS-level integrations.
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

import type {ReactNode} from "react"

import {DrillInUIProvider} from "@agenta/entity-ui/drill-in"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"

import {useLLMProviderConfig} from "@/oss/hooks/useLLMProviderConfig"

interface OSSdrillInUIProviderProps {
    children: ReactNode
}

/**
 * OSS-specific UI provider for DrillInView components.
 *
 * Injects:
 * - llmProviderConfig: vault secrets as extra option groups + "Add provider" footer
 * - EditorProvider / SharedEditor: rich text editor components
 *
 * All other UI components (ChatMessage, FieldHeader, etc.) are imported
 * directly from @agenta/ui in the entities package.
 */
export function OSSdrillInUIProvider({children}: OSSdrillInUIProviderProps) {
    const llmProviderConfig = useLLMProviderConfig()

    return (
        <DrillInUIProvider
            components={{
                llmProviderConfig,
                EditorProvider,
                SharedEditor,
            }}
        >
            {children}
        </DrillInUIProvider>
    )
}

export default OSSdrillInUIProvider
