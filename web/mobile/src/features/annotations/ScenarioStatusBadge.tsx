import {scenarioStatusLabel, scenarioStatusTone} from "@agenta/annotation"
import {Badge, statusBadgeVariant} from "@agenta/ui/ui"

/** An item's status. The status values are the API enum, so a failed item reads "Failed". */
export const ScenarioStatusBadge = ({status}: {status: string | null | undefined}) => (
    <Badge variant={statusBadgeVariant(scenarioStatusTone(status))}>
        {scenarioStatusLabel(status)}
    </Badge>
)
