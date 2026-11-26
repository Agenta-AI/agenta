import {humanizeRunStatus, runStatusTone, type RunStatusTone} from "@agenta/entities/evaluationRun"

import {StatusTag, type StatusTone} from "@/components/StatusTag"

const TAG_TONE: Record<RunStatusTone, StatusTone> = {
    success: "live",
    processing: "running",
    error: "failed",
    warning: "attention",
    default: "muted",
}

/** A run status as a tag: "evaluation_finished" reads "Evaluation Finished". */
export const RunStatusTag = ({status}: {status: string | null}) => {
    if (!status) return <span className="text-muted-foreground">—</span>
    const tone = TAG_TONE[runStatusTone(status)]
    return (
        <StatusTag tone={tone} dot={tone === "running"}>
            {humanizeRunStatus(status)}
        </StatusTag>
    )
}
