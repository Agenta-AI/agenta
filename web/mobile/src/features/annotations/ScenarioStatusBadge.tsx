import {scenarioStatusLabel, scenarioStatusTone} from "@agenta/annotation"
import {Badge} from "@agenta/ui/ui"

/** An item's status. The status values are the API enum, so a failed item reads "Failed". */
export const ScenarioStatusBadge = ({status}: {status: string | null | undefined}) => (
    <Badge variant={scenarioStatusTone(status)}>{scenarioStatusLabel(status)}</Badge>
)
