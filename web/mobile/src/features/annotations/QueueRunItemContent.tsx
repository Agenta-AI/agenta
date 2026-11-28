import {useMemo} from "react"

import {annotationSessionController, categorizeTestcaseFields} from "@agenta/annotation"
import {
    evaluationRunMolecule,
    evaluationRunQueryAtomFamily,
    type EvaluationResult,
} from "@agenta/entities/evaluationRun"
import {traceEntityAtomFamily, traceRootSpanAtomFamily} from "@agenta/entities/trace"
import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {getSpanDisplayOutputs, type TraceSpanNode} from "@agenta/observability"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {LoadError} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {useExpectedColumn} from "@/features/evaluation-run/focus/useExpectedColumn"

import {InputsSection, OutputSection} from "./QueueValueSections"
import {ScenarioMessage} from "./ScenarioMessage"
import {traceTurnActivity} from "./TraceScenarioContent"
import {
    isFailedInvocationStatus,
    useScenarioInvocation,
    type ScenarioInvocationState,
} from "./useScenarioInvocation"

const errorText = (result: EvaluationResult | undefined): string | null => {
    if (!result || !isFailedInvocationStatus(result.status)) return null
    const text = result.error?.message
    return typeof text === "string" && text ? text : (result.status ?? null)
}

export interface QueueRunItem {
    runId: string
    /** The scenario's step results have loaded; until then nothing can tell output from none. */
    ready: boolean
    /** The step results failed to load. */
    loadFailed: boolean
    retry: () => void
    /** The result of the scenario's app call (the run's invocation step). */
    invocationResult: EvaluationResult | undefined
    invocation: ScenarioInvocationState
}

/**
 * The item of a run's queue whose run calls an app on a test set: its app call result and the
 * Run action for an item with no output yet. Null for any other item (a trace, a test case).
 */
export const useQueueRunItem = (scenarioId: string): QueueRunItem | null => {
    const runId = useAtomValue(annotationSessionController.selectors.activeRunId()) ?? ""
    const runQuery = useAtomValue(evaluationRunQueryAtomFamily(runId))
    const steps = runQuery.data?.data?.steps ?? []
    // Until the run loads nothing tells a run's item from a plain one: wait, as for the results.
    const runUnknown = Boolean(runId) && runQuery.isPending
    const invocationStep = steps.find((step) => step.type === "invocation")
    const isRunItem =
        Boolean(invocationStep) &&
        steps.some(
            (step) =>
                step.type === "input" &&
                Object.keys(step.references ?? {}).some((key) => key.startsWith("testset")),
        )
    const resultsQuery = useAtomValue(
        evaluationRunMolecule.selectors.scenarioSteps({
            runId: isRunItem ? runId : "",
            scenarioId,
        }),
    )
    const ready = resultsQuery.isSuccess && !runUnknown
    const invocationResult = resultsQuery.data?.find(
        (result) => result.step_key === invocationStep?.key,
    )
    // An unknown result is not a missing output: Run waits for the results, or it could call
    // the app again over an output that exists.
    const invocation = useScenarioInvocation(
        runId,
        isRunItem && scenarioId && ready
            ? {id: scenarioId, invocationStatus: invocationResult?.status}
            : null,
    )
    return isRunItem || runUnknown
        ? {
              runId,
              ready,
              loadFailed: resultsQuery.isError,
              retry: () => void resultsQuery.refetch(),
              invocationResult,
              invocation,
          }
        : null
}

/**
 * An item of a run's queue: the test case inputs, the app output read from the scenario's app
 * call trace, compared with the run's expected column. A failed app call reads its error.
 */
export const QueueRunItemContent = ({
    scenarioId,
    runItem,
}: {
    scenarioId: string
    runItem: QueueRunItem
}) => {
    const t = useT(queueScreensCatalog)
    const tCommon = useT(commonCatalog)
    const {testcaseId} = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(scenarioId),
    )
    const testcaseQuery = useAtomValue(
        annotationSessionController.selectors.testcaseData(testcaseId),
    )
    const traceId = runItem.invocationResult?.trace_id ?? ""
    const traceQuery = useAtomValue(traceEntityAtomFamily(traceId || null))
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(traceId || null))
    const turns = useMemo(() => traceTurnActivity(traceQuery.data), [traceQuery.data])
    const expectedKey = useExpectedColumn(runItem.runId)
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)

    if (testcaseId && testcaseQuery.isPending) {
        return (
            <div className="flex flex-col gap-3" role="status" aria-label="Loading the test case">
                <SkeletonBlock className="h-16" />
                <SkeletonBlock className="h-16" />
            </div>
        )
    }
    const data = (testcaseQuery.data?.data ?? {}) as Record<string, unknown>
    const {inputs, expectedOutputs} = categorizeTestcaseFields(data)
    const error = errorText(runItem.invocationResult)
    // The expected value goes beside the output; with no output yet it stays among the rows.
    const shownExpected =
        expectedKey && expectedKey in data && (rootSpan || error) ? expectedKey : null
    const fields = [...inputs, ...expectedOutputs]
        .filter(([name]) => name !== shownExpected)
        .map(([name, value]) => ({name, value}))
    const openTrace = traceId
        ? () => openTraceDrawer({traceId, activeSpanId: rootSpan?.span_id ?? null})
        : null

    return (
        <div className="flex flex-col gap-6">
            {fields.length > 0 ? (
                <InputsSection fields={fields} />
            ) : (
                <ScenarioMessage title={t("annotation.queueScreens.testcaseUnavailable")} />
            )}
            {runItem.loadFailed ? (
                <LoadError
                    title={t("annotation.queueScreens.itemLoadFailed")}
                    description={null}
                    retryLabel={tCommon("common.retry")}
                    onRetry={runItem.retry}
                />
            ) : !runItem.ready ? (
                <SkeletonBlock className="h-24" />
            ) : error ? (
                <OutputSection value={null} error={error} onOpenTrace={openTrace} />
            ) : rootSpan ? (
                <OutputSection
                    value={getSpanDisplayOutputs(rootSpan as TraceSpanNode)}
                    turnActivity={turns}
                    expected={
                        shownExpected ? {key: shownExpected, value: data[shownExpected]} : null
                    }
                />
            ) : traceId && traceQuery.isPending ? (
                <SkeletonBlock className="h-24" />
            ) : traceId && traceQuery.isError ? (
                <LoadError
                    title="Failed to load trace data"
                    description={null}
                    retryLabel={tCommon("common.retry")}
                    onRetry={() => void traceQuery.refetch()}
                />
            ) : traceId ? (
                <ScenarioMessage title="Trace data not available" />
            ) : null}
        </div>
    )
}
