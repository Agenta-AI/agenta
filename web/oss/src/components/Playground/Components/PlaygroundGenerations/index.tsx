import {useAtomValue} from "jotai"

import {appChatModeAtom} from "../../state/atoms"

import GenerationChat from "./assets/GenerationChat"
import GenerationCompletion from "./assets/GenerationCompletion"
import GenerationHeader from "./assets/GenerationHeader"
import {PlaygroundGenerationsProps} from "./types"

const PlaygroundGenerations: React.FC<PlaygroundGenerationsProps> = ({variantId}) => {
    // Use app-level chat mode detection (first revision) for rendering mode
    const isChat = useAtomValue(appChatModeAtom)

    return (
        <div className="w-full">
            <GenerationHeader variantId={variantId} />
            {isChat ? (
                <GenerationChat variantId={variantId} />
            ) : (
                <GenerationCompletion variantId={variantId} withControls />
            )}
        </div>
    )
}

export default PlaygroundGenerations
