import {annotationSessionController, categorizeTestcaseFields} from "@agenta/annotation"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {ScenarioFieldCard} from "./ScenarioFieldCard"
import {ScenarioMessage} from "./ScenarioMessage"

/** A test case item: inputs, then expected outputs, then outputs, one card per field. */
export const TestcaseScenarioContent = ({testcaseId}: {testcaseId: string}) => {
    const query = useAtomValue(annotationSessionController.selectors.testcaseData(testcaseId))

    if (testcaseId && query.isPending) {
        return (
            <div
                className="flex flex-col gap-3 p-4"
                role="status"
                aria-label="Loading the test case"
            >
                <SkeletonBlock className="h-16" />
                <SkeletonBlock className="h-16" />
            </div>
        )
    }
    const testcase = query.data
    if (!testcaseId || query.isError || !testcase) {
        return <ScenarioMessage title="Testcase data not available" />
    }
    const {inputs, expectedOutputs, outputs} = categorizeTestcaseFields(testcase.data)
    const groups = [
        {key: "inputs", fields: inputs},
        {key: "expected", fields: expectedOutputs},
        {key: "outputs", fields: outputs},
    ].filter((group) => group.fields.length > 0)
    if (groups.length === 0) return <ScenarioMessage title="No data available for this testcase" />

    return (
        <div className="flex flex-col gap-2 p-3">
            {groups.map((group) => (
                <div key={group.key} data-group={group.key} className="flex flex-col gap-2">
                    {group.fields.map(([name, value]) => (
                        <ScenarioFieldCard key={name} name={name} value={value} />
                    ))}
                </div>
            ))}
        </div>
    )
}
