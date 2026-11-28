import {QueueRunItemContent, useQueueRunItem} from "./QueueRunItemContent"
import {ScenarioMessage} from "./ScenarioMessage"
import {TestcaseScenarioContent} from "./TestcaseScenarioContent"
import {TraceScenarioContent} from "./TraceScenarioContent"

/** A test case item, or a run's item with its app output. */
const TestcaseOrRunItem = ({scenarioId, testcaseId}: {scenarioId: string; testcaseId: string}) => {
    const runItem = useQueueRunItem(scenarioId)
    if (runItem) return <QueueRunItemContent scenarioId={scenarioId} runItem={runItem} />
    return <TestcaseScenarioContent testcaseId={testcaseId} />
}

/**
 * What the reader annotates: the trace of a trace queue, the test case and app output of a run's
 * item, or the test case of a test case queue. The ids come from the session controller's
 * `scenarioTraceRef` and `scenarioTestcaseRef`.
 */
export const ScenarioContent = ({
    scenarioId,
    hasScenario,
    isTraces,
    traceId,
    testcaseId,
}: {
    scenarioId: string
    hasScenario: boolean
    isTraces: boolean
    traceId: string
    testcaseId: string
}) => {
    if (!hasScenario) return <ScenarioMessage title="No scenario selected" />
    if (isTraces) {
        return traceId ? (
            <TraceScenarioContent traceId={traceId} />
        ) : (
            <ScenarioMessage title="Trace reference is not available yet" />
        )
    }
    return <TestcaseOrRunItem scenarioId={scenarioId} testcaseId={testcaseId} />
}
