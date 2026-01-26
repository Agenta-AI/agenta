/**
 * Playground Test Component
 *
 * Two-column layout playground with:
 * - Left: Configuration panel (prompt, model, parameters)
 * - Right: Testcases panel (inputs, run, outputs)
 *
 * A proper playground flow:
 * 1. Empty state prompts user to add a runnable (App Revision or Evaluator)
 * 2. Once runnable is added, show its input requirements
 * 3. User connects inputs from loadables (via connection layer)
 * 4. Execute and see results
 *
 * This file provides the OSS-specific implementation wrapper around
 * the @agenta/playground-ui components, injecting OSS-specific
 * components via the PlaygroundUIProvider context.
 */

import {
    PlaygroundUIProvider,
    PlaygroundContent,
    EntitySelectorProvider,
    type PlaygroundUIProviders,
    type SaveModeConfig,
} from "@agenta/playground-ui"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {EntityDrillInView} from "@/oss/components/DrillInView"
import {OSSdrillInUIProvider} from "@/oss/components/DrillInView/OSSdrillInUIProvider"
import {initializeSaveModeAtom} from "@/oss/components/Playground/Components/Modals/LoadTestsetModal/atoms/modalState"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"

// NOTE: appRevision entity now uses direct API query via @agenta/shared axios.
// No initialization or injection needed - the query works out of the box.

// Dynamic imports for modals (loaded on demand)
const LoadTestsetModal = dynamic(
    () =>
        import("@/oss/components/Playground/Components/Modals/LoadTestsetModal").then(
            (m) => m.default,
        ),
    {ssr: false},
)

const CommitVariantChangesButton = dynamic(
    () =>
        import("@/oss/components/Playground/Components/Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton").then(
            (m) => m.default,
        ),
    {ssr: false},
)

/**
 * OSS Playground wrapper that provides OSS-specific components
 * to the @agenta/playground-ui components via context injection.
 */
function PlaygroundTestInner() {
    const initializeSaveMode = useSetAtom(initializeSaveModeAtom)

    // Create the initializeSaveMode callback that matches the expected signature
    const handleInitializeSaveMode = (config: SaveModeConfig) => {
        initializeSaveMode({
            loadableId: config.loadableId,
            testcases: config.testcases,
            defaultName: config.defaultName,
        })
    }

    const providers: PlaygroundUIProviders = {
        EntityDrillInView,
        SharedGenerationResultUtils,
        LoadTestsetModal,
        CommitVariantChangesButton,
        initializeSaveMode: handleInitializeSaveMode,
    }

    return (
        <OSSdrillInUIProvider>
            <PlaygroundUIProvider providers={providers}>
                <PlaygroundContent />
            </PlaygroundUIProvider>
        </OSSdrillInUIProvider>
    )
}

// Main export
export default function PlaygroundTest() {
    return (
        <EntitySelectorProvider>
            <PlaygroundTestInner />
        </EntitySelectorProvider>
    )
}
