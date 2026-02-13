import {type FC} from "react"

import {useAtomValue} from "jotai"

import {playgroundSyncAtom} from "@/oss/state/url/playground"

import PlaygroundMainView from "./Components/MainLayout"
import PlaygroundHeader from "./Components/PlaygroundHeader"
import {useLocalDraftWarning} from "./hooks/useLocalDraftWarning"
import PlaygroundOnboarding from "./PlaygroundOnboarding"

const Playground: FC = () => {
    const uri = "playground" // Static value, no need for complex data subscription

    // Show warning when user tries to leave with unsaved local drafts
    useLocalDraftWarning()

    // Mount imperative playground state sync (store.sub subscriptions)
    // This replaces the old usePlaygroundUrlSync hook with React-free subscriptions
    useAtomValue(playgroundSyncAtom)

    return (
        <div className="flex flex-col w-full h-[calc(100dvh-75px)] overflow-hidden">
            <PlaygroundOnboarding />
            <PlaygroundHeader key={`${uri}-header`} />
            <PlaygroundMainView key={`${uri}-main`} />
        </div>
    )
}

export default Playground
