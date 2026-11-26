import {humanizeRunStatus, runStatusTone} from "@agenta/entities/evaluationRun"

import {RUN_STATUS_DOT_COLOR} from "../../evaluations/list/runStatusDotColor"

/** A run status as the old app's summary shows it: a colored dot and the status in words. */
export const RunStatusDot = ({status}: {status: string | null}) => {
    if (!status) return <span className="text-muted-foreground">—</span>
    return (
        <span className="inline-flex items-center gap-2">
            <span
                aria-hidden
                className={`size-2.5 shrink-0 rounded-full ${RUN_STATUS_DOT_COLOR[runStatusTone(status)]}`}
            />
            {humanizeRunStatus(status)}
        </span>
    )
}
