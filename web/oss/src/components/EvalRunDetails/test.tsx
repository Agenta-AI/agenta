import {useMemo} from "react"

import {useRouter} from "next/router"

import EvalRunPreviewPage from "./components/Page"
import EvalResultsOnboarding from "./EvalResultsOnboarding"

type EvalRunKind = "auto" | "human" | "online" | "custom"

const EvalRunTestPage = ({type = "auto"}: {type?: EvalRunKind}) => {
    // Normalize "custom" to "auto", but keep "online" as-is
    const evaluationType = type === "custom" ? "auto" : type
    const router = useRouter()
    const evaluationIdParam = router.query?.evaluation_id
    const projectIdParam = router.query?.project_id
    const runId = useMemo(() => {
        const value = Array.isArray(evaluationIdParam) ? evaluationIdParam[0] : evaluationIdParam
        return value ?? null
    }, [evaluationIdParam])
    const projectId = useMemo(() => {
        const value = Array.isArray(projectIdParam) ? projectIdParam[0] : projectIdParam
        return value ?? null
    }, [projectIdParam])

    if (!router.isReady) {
        return <div>Waiting for router…</div>
    }

    if (!runId) {
        return <div>Provide an evaluation_id query parameter to inspect an evaluation run.</div>
    }

    return (
        <div className="w-full h-full overflow-hidden flex flex-col" data-tour="eval-results">
            <EvalResultsOnboarding isReady={!!runId} />
            <EvalRunPreviewPage
                evaluationType={evaluationType}
                runId={runId}
                projectId={projectId}
            />
        </div>
    )
}

export default EvalRunTestPage
