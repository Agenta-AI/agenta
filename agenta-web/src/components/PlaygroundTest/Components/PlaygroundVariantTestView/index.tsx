import clsx from "clsx"

import {PlaygroundVariantTestViewProps} from "./types"
import usePlayground from "../../hooks/usePlayground"
import ChatTestView from "./Components/ChatTestView"
import GenerationTestView from "./Components/GenerationTestView"
import {Typography} from "antd"

const PlaygroundVariantTestView = ({
    variantId,
    className,
    ...props
}: PlaygroundVariantTestViewProps) => {
    const {isChat} = usePlayground({
        variantId,
        variantSelector: (variant) => {
            return {
                isChat: variant.isChat,
            }
        },
    })
    return (
        <div className={clsx("px-2", className)} {...props}>
            <div
                className={clsx([
                    "h-[48px] flex items-center gap-4",
                    "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                ])}
            >
                <Typography className="text-[14px] leading-[22px] font-[500]">
                    Generation
                </Typography>
            </div>
            {isChat ? (
                <ChatTestView variantId={variantId} />
            ) : (
                <GenerationTestView variantId={variantId} />
            )}
        </div>
    )
}

export default PlaygroundVariantTestView
