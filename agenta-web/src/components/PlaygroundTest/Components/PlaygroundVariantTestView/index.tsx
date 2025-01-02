import clsx from 'clsx'

import {PlaygroundVariantTestViewProps} from "./types"
import usePlayground from "../../hooks/usePlayground"
import ChatTestView from "./Components/ChatTestView"
import GenerationTestView from "./Components/GenerationTestView"

const PlaygroundVariantTestView = ({variantId, className, ...props}: PlaygroundVariantTestViewProps) => {
    const {isChat} = usePlayground({
        variantId,
        variantSelector: (variant) => {
            return {
                isChat: variant.isChat,
            }
        }
    })
    return (
        <div className={clsx("px-2", className)} {...props}>
            {
                isChat ? (
                    <ChatTestView variantId={variantId} />
                ) : (
                    <GenerationTestView variantId={variantId} />
                )
            }
        </div>
    )
}

export default PlaygroundVariantTestView
