import {humanizeRunStatus, runStatusTone} from "@agenta/entities/evaluationRun"
import {Badge, statusBadgeVariant} from "@agenta/ui/ui"

const DOT = <span aria-hidden className="size-1.5 rounded-round bg-current" />

/** A run status as a badge: "evaluation_finished" reads "Evaluation Finished". */
export const RunStatusTag = ({status}: {status: string | null}) => {
    if (!status) return <span className="text-muted-foreground">—</span>
    const tone = runStatusTone(status)
    return (
        <Badge variant={statusBadgeVariant(tone)} icon={tone === "processing" ? DOT : undefined}>
            {humanizeRunStatus(status)}
        </Badge>
    )
}
