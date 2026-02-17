import {type FC, useEffect} from "react"

import {PlaygroundUIProvider, type PlaygroundUIProviders} from "@agenta/playground-ui"
import {EntitySelectorProvider} from "@agenta/playground-ui/components"
import {useLocalDraftWarning} from "@agenta/playground-ui/hooks"
import {preloadEditorPlugins} from "@agenta/ui"
import {useAtomValue} from "jotai"

import {OSSdrillInUIProvider} from "@/oss/components/DrillInView/OSSdrillInUIProvider"
import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"
import {playgroundSyncAtom} from "@/oss/state/url/playground"

import PlaygroundMainView from "./Components/MainLayout"
import PlaygroundHeader from "./Components/PlaygroundHeader"
import {OSSPlaygroundEntityProvider} from "./OSSPlaygroundEntityProvider"
import PlaygroundOnboarding from "./PlaygroundOnboarding"

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

    const providers: PlaygroundUIProviders = {
        SimpleSharedEditor,
        SharedGenerationResultUtils,
    } as PlaygroundUIProviders

    return (
        <OSSPlaygroundEntityProvider>
            <PlaygroundUIProvider providers={providers}>
                <EntitySelectorProvider>
                    <OSSdrillInUIProvider>
                        <div className="flex flex-col w-full h-[calc(100dvh-75px)] overflow-hidden">
                            <PlaygroundOnboarding />
                            <PlaygroundHeader key={`${uri}-header`} />
                            <PlaygroundMainView key={`${uri}-main`} />
                        </div>
                    </OSSdrillInUIProvider>
                </EntitySelectorProvider>
            </PlaygroundUIProvider>
        </OSSPlaygroundEntityProvider>
    )
}

export default Playground
