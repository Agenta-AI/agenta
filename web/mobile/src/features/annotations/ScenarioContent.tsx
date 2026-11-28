import {QueueRunItemContent, useQueueRunItem, type QueueRunItem} from "./QueueRunItemContent"
import {ScenarioMessage} from "./ScenarioMessage"
import {TestcaseScenarioContent} from "./TestcaseScenarioContent"
import {TraceScenarioContent} from "./TraceScenarioContent"

/** A test case item, or a run's item with its app output (for a host that did not read it). */
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
    runItem,
}: {
    scenarioId: string
    hasScenario: boolean
    isTraces: boolean
    traceId: string
    testcaseId: string
    /** The run item the host already read (`useQueueRunItem`); null for none, absent to read it. */
    runItem?: QueueRunItem | null
}) => {
    if (!hasScenario) return <ScenarioMessage title="No scenario selected" />
    if (isTraces) {
        return traceId ? (
            <TraceScenarioContent traceId={traceId} />
        ) : (
            <ScenarioMessage title="Trace reference is not available yet" />
        )
    }
    if (runItem) return <QueueRunItemContent scenarioId={scenarioId} runItem={runItem} />
    if (runItem === null) return <TestcaseScenarioContent testcaseId={testcaseId} />
    return <TestcaseOrRunItem scenarioId={scenarioId} testcaseId={testcaseId} />
}
