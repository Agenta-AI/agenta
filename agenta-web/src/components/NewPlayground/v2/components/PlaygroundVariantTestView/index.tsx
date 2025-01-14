import {useCallback, memo} from "react"

import dynamic from "next/dynamic"
import clsx from "clsx"

import {Typography} from "antd"

import type {PlaygroundVariantTestViewProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {EnhancedVariant} from "@/components/NewPlayground/assets/utilities/transformer/types"
import useDelayChildren from "@/components/NewPlayground/hooks/useDelayChildren"

const ChatTestView = dynamic(() => import("./Components/ChatTestView"), {ssr: false})
const GenerationTestView = dynamic(() => import("./Components/GenerationTestView"), {ssr: false})

const PlaygroundVariantTestView = ({variantId, className, ...props}: any) => {
    const {isChat} = usePlayground({
        variantId,
        variantSelector: useCallback((variant: EnhancedVariant) => {
            return {
                isChat: variant.isChat,
            }
        }, []),
    })

    const showChildren = useDelayChildren(10)

    return (
        <div className={clsx("px-2 w-full", className)} {...props}>
            <div
                className={clsx([
                    "h-[48px] flex items-center gap-4",
                    "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                    "sticky top-0 z-[1]",
                    "bg-white",
                ])}
            >
                <Typography className="text-[14px] leading-[22px] font-[500]">
                    Generation
                </Typography>
            </div>
            {showChildren && isChat ? (
                <ChatTestView variantId={variantId} />
            ) : showChildren && !isChat ? (
                <GenerationTestView variantId={variantId} />
            ) : null}
        </div>
    )
}

export default memo(PlaygroundVariantTestView)
