import {memo, useEffect} from "react"

import {Button, Space, Typography} from "antd"
import clsx from "clsx"
import {useAtom, useAtomValue} from "jotai"
import {loadable} from "jotai/utils"
import {useRouter} from "next/router"

import {useRunId} from "@/oss/contexts/RunIdContext"
import {
    displayedScenarioIdsFamily,
    scenariosFamily,
    scenarioStepProgressFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import EvalRunScenarioNavigator from "../../../components/EvalRunScenarioNavigator"
import {urlStateAtom} from "../../../state/urlState"
import EvalRunScenarioCard from "../EvalRunScenarioCard"
import ScenarioAnnotationPanel from "../ScenarioAnnotationPanel"
import ScenarioLoadingIndicator from "../ScenarioLoadingIndicator/ScenarioLoadingIndicator"

import {SingleScenarioViewerProps} from "./types"

const SingleScenarioViewer = ({runId}: SingleScenarioViewerProps) => {
    // Use run-scoped atoms with the provided runId
    const effectiveRunId = useRunId() || runId

    // Read from the same global store that writes are going to
    const scenariosLoadable = useAtomValue(loadable(scenariosFamily(effectiveRunId)))
    const scenarioIdsFromFamily = useAtomValue(displayedScenarioIdsFamily(effectiveRunId))

    // Fallback: if displayedScenarioIdsFamily is empty but scenariosLoadable has data, use that
    const scenarioIds =
        scenarioIdsFromFamily?.length > 0
            ? scenarioIdsFromFamily
            : scenariosLoadable.state === "hasData"
              ? scenariosLoadable.data?.map((s) => s.id) || []
              : []
    const scenarioStepProgress = useAtomValue(scenarioStepProgressFamily(effectiveRunId))

    // Access URL state atom
    const router = useRouter()
    const [urlState, setUrlState] = useAtom(urlStateAtom)

    // Prefer URL query first, then atom, then fallback
    const activeId =
        (router.query.scenarioId as string | undefined) ?? urlState.scenarioId ?? scenarioIds[0]

    // Ensure URL/atom always reference a scenario visible in current list
    // Ensure URL/atom correctness
    useEffect(() => {
        if (scenarioIds.length === 0) return

        const currentScenarioId =
            (router.query.scenarioId as string | undefined) ?? urlState.scenarioId

        if (!currentScenarioId || !scenarioIds.includes(currentScenarioId)) {
            // Default to the first scenario for this run when no valid selection/deep-link.
            setUrlState((draft) => {
                draft.scenarioId = scenarioIds[0]
            })
            return
        }
    }, [scenarioIds, router.query.scenarioId, urlState.scenarioId, setUrlState])

    if (scenariosLoadable.state !== "hasData") {
        const step = scenarioStepProgress.loadingStep as string | undefined
        if (step === "eval-run" || step === "scenarios") {
            return (
                <Space align="center" className="justify-center w-full py-8">
                    <Button type="text" loading />
                    <Typography.Text type="secondary">
                        {step === "eval-run"
                            ? "Loading evaluation run details..."
                            : "Loading scenarios..."}
                    </Typography.Text>
                </Space>
            )
        }
        if (step === "scenario-steps" || step === "metrics") {
            return <ScenarioLoadingIndicator runId={effectiveRunId} />
        }
    }

    if (scenarioIds?.length === 0) {
        return <Typography.Text type="secondary">No scenarios to display.</Typography.Text>
    }

    if (!activeId) {
        return <Typography.Text type="secondary">Loading scenario...</Typography.Text>
    }
    if (!activeId || scenariosLoadable.state !== "hasData") {
        return <Typography.Text type="secondary">Loading scenario...</Typography.Text>
    }

    return (
        <section className="relative flex min-h-0 w-full h-full overflow-y-auto">
            <div className="absolute top-0 left-0 w-full grow min-h-full flex gap-4">
                <div className="min-h-full h-full flex flex-col gap-4 grow sticky top-0 z-10">
                    <EvalRunScenarioNavigator
                        activeId={activeId}
                        className="sticky top-0 z-10 bg-white pb-1"
                    />
                    <EvalRunScenarioCard viewType="focus" scenarioId={activeId} runId={runId} />
                </div>

                <div className="flex flex-row gap-8 items-start self-stretch min-h-full h-full sticky top-0 z-10">
                    <div
                        className={clsx([
                            "scenario-annotate-panel",
                            "w-[400px] shrink-0 rounded-lg overflow-hidden min-h-full h-full",
                        ])}
                    >
                        <ScenarioAnnotationPanel
                            runId={runId}
                            scenarioId={activeId}
                            classNames={{
                                body: "!p-0 [&_.ant-btn]:mx-3 [&_.ant-btn]:mb-3 [&_.ant-btn]:mt-1",
                            }}
                        />
                    </div>
                </div>
            </div>
        </section>
    )
}

export default memo(SingleScenarioViewer)
