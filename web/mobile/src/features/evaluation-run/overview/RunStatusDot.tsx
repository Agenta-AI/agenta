import {humanizeRunStatus, runStatusTone, type RunStatusTone} from "@agenta/entities/evaluationRun"

const DOT: Record<RunStatusTone, string> = {
    success: "bg-success",
    processing: "bg-primary",
    error: "bg-destructive",
    warning: "bg-primary",
    default: "bg-muted-foreground",
}

/** A run status as the old app's summary shows it: a colored dot and the status in words. */
export const RunStatusDot = ({status}: {status: string | null}) => {
    if (!status) return <span className="text-muted-foreground">—</span>
    return (
        <span className="inline-flex items-center gap-2">
            <span
                aria-hidden
                className={`size-2.5 shrink-0 rounded-full ${DOT[runStatusTone(status)]}`}
            />
            {humanizeRunStatus(status)}
        </span>
    )
}
