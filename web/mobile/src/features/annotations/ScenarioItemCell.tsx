import {annotationSessionController, formatScenarioValue} from "@agenta/annotation"
import {traceRootSpanAtomFamily} from "@agenta/entities/trace"
import {useAtomValue} from "jotai"

import {firstTestcaseInput} from "./useScenarioRows"

const Text = ({value}: {value: string}) => (
    <span className="block truncate text-[13px] text-foreground" title={value}>
        {value}
    </span>
)

const TraceItem = ({traceId}: {traceId: string}) => {
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(traceId))
    return <Text value={rootSpan?.span_name || "—"} />
}

const TestcaseItem = ({testcaseId}: {testcaseId: string}) => {
    const query = useAtomValue(annotationSessionController.selectors.testcaseData(testcaseId))
    const input = firstTestcaseInput(query.data?.data)
    return (
        <Text value={input === undefined ? "—" : formatScenarioValue(input).replace(/\s+/g, " ")} />
    )
}

/** What the item is: the trace's root span name, or the test case's first input. */
export const ScenarioItemCell = ({scenarioId}: {scenarioId: string}) => {
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const testcaseRef = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(scenarioId),
    )
    if (traceRef.traceId) return <TraceItem traceId={traceRef.traceId} />
    if (testcaseRef.testcaseId) return <TestcaseItem testcaseId={testcaseRef.testcaseId} />
    return <Text value="—" />
}
