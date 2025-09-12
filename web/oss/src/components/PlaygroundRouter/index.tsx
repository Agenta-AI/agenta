import {memo} from "react"

import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import CustomWorkflowBanner from "@/oss/components/CustomWorkflowBanner"
import {shouldRenderPlaygroundAtom} from "@/oss/state/app/selectors/app"

const Playground = dynamic(() => import("../Playground/Playground"), {ssr: false})

const PlaygroundRouter = () => {
    const shouldRender = useAtomValue(shouldRenderPlaygroundAtom)
    if (!shouldRender)
        return (
            <div className="w-full h-[calc(100dvh-70px)] flex items-center justify-center grow">
                <CustomWorkflowBanner showInPlayground layout="card" />
            </div>
        )
    return <Playground />
}

export default memo(PlaygroundRouter)
