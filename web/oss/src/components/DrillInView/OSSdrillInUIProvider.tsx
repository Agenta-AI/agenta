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

import {DrillInUIProvider} from "@agenta/entities/ui"

import SelectLLMProvider from "@/oss/components/SelectLLMProvider"

interface OSSdrillInUIProviderProps {
    children: ReactNode
}

/**
 * OSS-specific UI provider for DrillInView components.
 *
 * Injects only the truly app-specific components:
 * - SelectLLMProvider: Model selection dropdown with vault/secrets integration
 *
 * All other UI components (Editor, ChatMessage, FieldHeader, etc.) are imported
 * directly from @agenta/ui in the entities package.
 */
export function OSSdrillInUIProvider({children}: OSSdrillInUIProviderProps) {
    return (
        <DrillInUIProvider
            components={{
                SelectLLMProvider,
            }}
        >
            {children}
        </DrillInUIProvider>
    )
}

export default OSSdrillInUIProvider
