/**
 * OSSPlaygroundShell
 *
 * Composes the common provider stack needed by all playground consumers
 * (Playground page, EvaluatorDrawer, ConfigureEvaluator, WorkflowRevisionDrawer).
 *
 * Replaces the repeated 4-level nesting:
 *   <PlaygroundUIProvider> → <EntitySelectorProvider> → <OSSdrillInUIProvider>
 *
 * Global concerns (side-effect bridge, auth headers) are registered once
 * in AppGlobalWrappers — this component only handles per-consumer UI providers.
 */

import type {ReactNode} from "react"

import {PlaygroundUIProvider, type PlaygroundUIProviders} from "@agenta/playground-ui"
import {EntitySelectorProvider} from "@agenta/playground-ui/components"

import {OSSdrillInUIProvider} from "@/oss/components/DrillInView/OSSdrillInUIProvider"

interface OSSPlaygroundShellProps {
    providers: PlaygroundUIProviders
    children: ReactNode
}

export function OSSPlaygroundShell({providers, children}: OSSPlaygroundShellProps) {
    return (
        <PlaygroundUIProvider providers={providers}>
            <EntitySelectorProvider>
                <OSSdrillInUIProvider>{children}</OSSdrillInUIProvider>
            </EntitySelectorProvider>
        </PlaygroundUIProvider>
    )
}
