import {memo} from "react"

import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import CustomWorkflowBanner from "@/oss/components/CustomWorkflow/CustomWorkflowBanner"
import {shouldRenderPlaygroundAtom} from "@/oss/components/Playground/state/atoms/playgroundAppAtoms"

const Playground = dynamic(() => import("../Playground/Playground"), {ssr: false})

const PlaygroundRouter = () => {
    const shouldRender = useAtomValue(shouldRenderPlaygroundAtom)
    if (!shouldRender)
        return (
            <div className="w-full h-[calc(100dvh-75px)] flex items-center justify-center grow">
                <CustomWorkflowBanner showInPlayground layout="card" />
            </div>
        )
    return <Playground />
}

export default memo(PlaygroundRouter)
