import {type FC, useCallback, useEffect, useMemo} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {
    GatewayToolAssistantActions,
    PlaygroundUIProvider,
    type PlaygroundUIProviders,
} from "@agenta/playground-ui"
import {EntitySelectorProvider} from "@agenta/playground-ui/components"
import {useLocalDraftWarning} from "@agenta/playground-ui/hooks"
import {preloadEditorPlugins, SyncStateTag} from "@agenta/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {OSSdrillInUIProvider} from "@/oss/components/DrillInView/OSSdrillInUIProvider"
import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"
import CatalogDrawer from "@/oss/features/gateway-tools/drawers/CatalogDrawer"
import {executeToolCall} from "@/oss/services/tools/api"
import {playgroundSyncAtom} from "@/oss/state/url/playground"

import PlaygroundMainView from "./Components/MainLayout"
import PlaygroundHeader from "./Components/PlaygroundHeader"
import PlaygroundTestcaseEditor from "./Components/PlaygroundTestcaseEditor"
import {OSSPlaygroundEntityProvider} from "./OSSPlaygroundEntityProvider"
import PlaygroundOnboarding from "./PlaygroundOnboarding"

/**
 * Sync state tag slot — renders the sync state badge in each row header.
 * Shown only when connected to an API-backed testset.
 * - "new" (green): row was added locally and is not yet in the connected testset
 * - "modified" (blue): row has local edits not yet synced; shows discard × on hover
 * - "unmodified": no changes — nothing rendered
 */
// TODO: This should not live here, it should be in the separate component
function PlaygroundSyncStateTag({rowId, loadableId}: {rowId: string; loadableId: string}) {
    const mode = useAtomValue(loadableController.selectors.mode(loadableId)) as
        | "local"
        | "connected"
        | null
    const isDirty = useAtomValue(useMemo(() => testcaseMolecule.isDirty(rowId), [rowId])) as boolean
    const discard = useSetAtom(testcaseMolecule.actions.discard)

    const handleDiscard = useCallback(() => discard(rowId), [discard, rowId])

    // Only show sync tags when connected to an API-backed testset
    if (mode !== "connected") return null

    // New IDs are prefixed with "new-" or "local-" (established convention in the codebase)
    const isNew = rowId.startsWith("new-") || rowId.startsWith("local-")
    const syncState = isNew ? "new" : isDirty ? "modified" : "unmodified"

    return (
        <SyncStateTag
            syncState={syncState}
            dismissible={syncState === "modified"}
            onDismiss={syncState === "modified" ? handleDiscard : undefined}
        />
    )
}

const Playground: FC = () => {
    const uri = "playground" // Static value, no need for complex data subscription

    // Show warning when user tries to leave with unsaved local drafts
    useLocalDraftWarning()

    // Mount imperative playground state sync (store.sub subscriptions)
    // This replaces the old usePlaygroundUrlSync hook with React-free subscriptions
    useAtomValue(playgroundSyncAtom)

    // Preload lazy editor plugins ASAP to reduce first-render editor suspense jank.
    useEffect(() => {
        void preloadEditorPlugins()
    }, [])

    const providers = {
        SimpleSharedEditor,
        SharedGenerationResultUtils,
        ChatTurnAssistantActions: (props) => (
            <GatewayToolAssistantActions {...props} onExecuteToolCall={executeToolCall} />
        ),
        renderSyncStateTag: PlaygroundSyncStateTag,
        TestcaseEditor: PlaygroundTestcaseEditor,
    } as unknown as PlaygroundUIProviders

    return (
        <OSSPlaygroundEntityProvider>
            <PlaygroundUIProvider providers={providers}>
                <EntitySelectorProvider>
                    <OSSdrillInUIProvider>
                        <div className="flex flex-col w-full h-[calc(100dvh-75px)] overflow-hidden">
                            <PlaygroundOnboarding />
                            <PlaygroundHeader key={`${uri}-header`} />
                            <PlaygroundMainView key={`${uri}-main`} />
                            <CatalogDrawer />
                        </div>
                    </OSSdrillInUIProvider>
                </EntitySelectorProvider>
            </PlaygroundUIProvider>
        </OSSPlaygroundEntityProvider>
    )
}

export default Playground
