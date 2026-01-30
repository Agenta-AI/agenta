import {type FC} from "react"

import PlaygroundMainView from "./Components/MainLayout"
import PlaygroundHeader from "./Components/PlaygroundHeader"
import PlaygroundOnboarding from "./PlaygroundOnboarding"
import {useLocalDraftWarning} from "./hooks/useLocalDraftWarning"

const Playground: FC = () => {
    const uri = "playground" // Static value, no need for complex data subscription

    // Show warning when user tries to leave with unsaved local drafts
    useLocalDraftWarning()

    return (
        <div className="flex flex-col w-full h-[calc(100dvh-75px)] overflow-hidden">
            <PlaygroundOnboarding />
            <PlaygroundHeader key={`${uri}-header`} />
            <PlaygroundMainView key={`${uri}-main`} />
        </div>
    )
}

export default Playground
