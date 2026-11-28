import {annotationSessionController, categorizeTestcaseFields} from "@agenta/annotation"
import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
import {SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {InputsSection, OutputSection} from "./QueueValueSections"
import {ScenarioMessage} from "./ScenarioMessage"

const asFields = (entries: [string, unknown][]) => entries.map(([name, value]) => ({name, value}))

/**
 * A test case item: its inputs as rows, then its output, compared field by field with the
 * expected value when the test case has one. A test case with no output shows its expected value
 * among the rows.
 */
export const TestcaseScenarioContent = ({testcaseId}: {testcaseId: string}) => {
    const t = useT(queueScreensCatalog)
    const query = useAtomValue(annotationSessionController.selectors.testcaseData(testcaseId))

    if (testcaseId && query.isPending) {
        return (
            <div className="flex flex-col gap-3" role="status" aria-label="Loading the test case">
                <SkeletonBlock className="h-16" />
                <SkeletonBlock className="h-16" />
            </div>
        )
    }
    const testcase = query.data
    if (!testcaseId || query.isError || !testcase) {
        return <ScenarioMessage title={t("annotation.queueScreens.testcaseUnavailable")} />
    }
    const {inputs, expectedOutputs, outputs} = categorizeTestcaseFields(testcase.data)
    if (inputs.length + expectedOutputs.length + outputs.length === 0) {
        return <ScenarioMessage title={t("annotation.queueScreens.testcaseNoData")} />
    }
    if (outputs.length === 0) {
        return <InputsSection fields={asFields([...inputs, ...expectedOutputs])} />
    }
    const output = outputs.length === 1 ? outputs[0][1] : Object.fromEntries(outputs)
    const [expected, ...otherExpected] = expectedOutputs
    return (
        <div className="flex flex-col gap-6">
            <InputsSection fields={asFields([...inputs, ...otherExpected])} />
            <OutputSection
                value={output}
                expected={expected ? {key: expected[0], value: expected[1]} : null}
            />
        </div>
    )
}
