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
export const ScenarioItemCell = ({
    scenarioId,
    traceId,
    testcaseId,
}: {
    scenarioId: string
    traceId: string
    testcaseId: string
}) => {
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const testcaseRef = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(scenarioId),
    )
    const trace = traceId || traceRef.traceId
    if (trace) return <TraceItem traceId={trace} />
    const testcase = testcaseId || testcaseRef.testcaseId
    if (testcase) return <TestcaseItem testcaseId={testcase} />
    return <Text value="—" />
}
