/**
 * MockupDrillInUIProvider — slim version of OSSdrillInUIProvider
 *
 * Mirrors `web/oss/src/components/DrillInView/OSSdrillInUIProvider.tsx`
 * but omits the LLM-vault and gateway-tools wiring (those depend on real
 * APIs we don't want to hit from a static design surface).
 *
 * Provides only what the drill-in needs to render fields and edit text:
 * - DrillInUIProvider from @agenta/entity-ui/drill-in
 * - EditorProvider + SharedEditor from @agenta/ui (rich text editing)
 */

import type {ReactNode} from "react"

import {DrillInUIProvider} from "@agenta/entity-ui/drill-in"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"

interface MockupDrillInUIProviderProps {
    children: ReactNode
}

export function MockupDrillInUIProvider({children}: MockupDrillInUIProviderProps) {
    return (
        <DrillInUIProvider
            components={{
                EditorProvider,
                SharedEditor,
            }}
        >
            {children}
        </DrillInUIProvider>
    )
}

export default MockupDrillInUIProvider
