import {ValueCompareRows} from "@agenta/chat/value-view"
import type {ExpectedComparison} from "@agenta/shared/utils"

/** The output's compare rows under the output title, next to the test case's expected column. */
export const ScenarioFocusExpectedRows = ({
    comparison,
    expectedKey,
}: {
    comparison: ExpectedComparison
    expectedKey: string
}) => (
    <div className="min-w-0">
        <ValueCompareRows comparison={comparison} expectedKey={expectedKey} />
    </div>
)
