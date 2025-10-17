import {memo} from "react"

import {useRouter} from "next/router"

import EvalRunOverviewViewerSkeleton from "../../components/EvalRunOverviewViewer/assets/EvalRunOverviewViewerSkeleton"
import EvalRunHeaderSkeleton from "../components/EvalRunHeader/assets/EvalRunHeaderSkeleton"
import EvalRunPromptConfigViewerSkeleton from "../components/EvalRunPromptConfigViewer/assets/EvalRunPromptConfigViewerSkeleton"
import EvalRunTestCaseViewerSkeleton from "../components/EvalRunTestCaseViewer/assets/EvalRunTestCaseViewerSkeleton"

const AutoEvalRunSkeleton = () => {
    const router = useRouter()
    const viewType = router.query.view as string

    return (
        <section className="flex flex-col w-full h-[calc(100vh-84px)] gap-2 overflow-auto">
            <EvalRunHeaderSkeleton />
            {viewType === "test-cases" ? (
                <EvalRunTestCaseViewerSkeleton />
            ) : viewType === "prompt" ? (
                <EvalRunPromptConfigViewerSkeleton />
            ) : (
                <EvalRunOverviewViewerSkeleton className="px-6" />
            )}
        </section>
    )
}

export default memo(AutoEvalRunSkeleton)
