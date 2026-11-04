import {useState} from "react"

import type {RunHeader} from "@agenta/entities/evaluationRun"
import {projectIdAtom} from "@agenta/shared/state"
import {LoadError} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

import {RunStatusTag} from "../overview/RunStatusTag"
import {ScenariosLoadMoreError} from "../scenarios/states/ScenariosLoadMoreError"
import {ScenariosRefreshError} from "../scenarios/states/ScenariosRefreshError"
import {useRunScenarios} from "../scenarios/useRunScenarios"
import {useScenarioGroupLabels} from "../scenarios/useScenarioGroupLabels"

import {RunAnnotateBody} from "./RunAnnotateBody"
import {ScenarioNavigator} from "./ScenarioNavigator"
import {RunAnnotateEmpty} from "./states/RunAnnotateEmpty"
import {RunAnnotateSkeleton} from "./states/RunAnnotateSkeleton"
import {useRunAnnotationSession} from "./useRunAnnotationSession"
import {useScenarioStepper} from "./useScenarioStepper"

import {useAnnotationKeyboardShortcuts} from "@/features/annotations/useAnnotationKeyboardShortcuts"
import {useSubmitAnnotations} from "@/features/annotations/useSubmitAnnotations"
import {useProjectPermission} from "@/features/context/useProjectPermission"

/**
 * The Annotate tab of a human run: one scenario at a time, its inputs and output beside the
 * annotation form. The arrows move between scenarios; Cmd or Ctrl+Enter saves. A page must load
 * this file with `next/dynamic`: it brings the annotation controllers.
 */
export const RunAnnotateTab = ({runId, header}: {runId: string; header: RunHeader}) => {
    const {isOpen, onSaved} = useRunAnnotationSession(runId)
    const scenarios = useRunScenarios(runId)
    const labels = useScenarioGroupLabels(scenarios.columnGroups)
    const {rows, hasMore, loadMore, isFetchingMore, loadMoreError} = scenarios
    const [picked, setPicked] = useState<string | null>(null)
    const {current, onNext} = useScenarioStepper({
        rows,
        // Until the reader picks one, the first scenario is shown.
        scenarioId: picked ?? rows[0]?.scenario.id ?? null,
        setScenarioId: setPicked,
        hasMore,
        loadMore,
        loadMoreError,
    })

    const scenarioId = current?.scenario.id ?? ""
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const canAnnotate = useProjectPermission(projectId, "edit_annotations")
    const submission = useSubmitAnnotations(scenarioId, {runId}, onSaved)
    const position = current ? rows.indexOf(current) : -1
    useAnnotationKeyboardShortcuts({
        onPrev: () => setPicked(rows[position - 1].scenario.id),
        onNext,
        onSubmit: () => void submission.submit(),
        hasPrev: position > 0,
        hasNext: position >= 0 && (position < rows.length - 1 || hasMore) && !isFetchingMore,
        canSubmit: submission.canSubmit && canAnnotate && Boolean(current?.invocation?.traceId),
        enabled: Boolean(current) && isOpen,
    })

    if (scenarios.isError) {
        return <LoadError framed title="Could not load scenarios" onRetry={scenarios.refetch} />
    }
    if (scenarios.isPending || (!isOpen && rows.length > 0)) return <RunAnnotateSkeleton />
    if (!current) return <RunAnnotateEmpty />

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1 md:max-w-[420px]">
                    <ScenarioNavigator
                        kind={header.kind}
                        rows={rows}
                        current={current}
                        nextLoading={isFetchingMore}
                        hasNext={hasMore}
                        onSelect={setPicked}
                        onNext={onNext}
                    />
                </div>
                <RunStatusTag status={current.scenario.status ?? null} />
            </div>
            {loadMoreError ? <ScenariosLoadMoreError onRetry={loadMore} /> : null}
            {scenarios.refreshFailed ? (
                <ScenariosRefreshError onRetry={scenarios.retryRefresh} />
            ) : null}
            <RunAnnotateBody
                runId={runId}
                row={current}
                groups={scenarios.columnGroups}
                labels={labels}
                onRetry={scenarios.retryValues}
                onSaved={onSaved}
            />
        </div>
    )
}
