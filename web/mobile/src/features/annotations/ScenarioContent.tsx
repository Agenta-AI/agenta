import {ScenarioMessage} from "./ScenarioMessage"
import {readScenarioRef} from "./scenarioRefs"
import {TestcaseScenarioContent} from "./TestcaseScenarioContent"
import {TraceScenarioContent} from "./TraceScenarioContent"

/** What the reader annotates: the trace of a trace queue, or the test case of a test case queue. */
export const ScenarioContent = ({
    scenario,
    isTraces,
    traceId,
    testcaseId,
}: {
    scenario: Record<string, unknown> | null
    isTraces: boolean
    traceId?: string
    testcaseId?: string
}) => {
    if (!scenario) return <ScenarioMessage title="No scenario selected" />
    if (isTraces) {
        const id = traceId || readScenarioRef(scenario, "trace_id")
        return id ? (
            <TraceScenarioContent traceId={id} />
        ) : (
            <ScenarioMessage title="Trace reference is not available yet" />
        )
    }
    return (
        <TestcaseScenarioContent
            testcaseId={testcaseId || readScenarioRef(scenario, "testcase_id")}
        />
    )
}
