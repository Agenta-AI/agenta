import {ScenarioMessage} from "./ScenarioMessage"
import {TestcaseScenarioContent} from "./TestcaseScenarioContent"
import {TraceScenarioContent} from "./TraceScenarioContent"

/**
 * What the reader annotates: the trace of a trace queue, or the test case of a test case queue.
 * The ids come from the session controller's `scenarioTraceRef` and `scenarioTestcaseRef`.
 */
export const ScenarioContent = ({
    hasScenario,
    isTraces,
    traceId,
    testcaseId,
}: {
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
    return <TestcaseScenarioContent testcaseId={testcaseId} />
}
