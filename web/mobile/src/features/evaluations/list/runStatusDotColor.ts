import type {RunStatusTone} from "@agenta/entities/evaluationRun"

/** The dot color of each run status tone; every evaluation screen uses these. */
export const RUN_STATUS_DOT_COLOR: Record<RunStatusTone, string> = {
    success: "bg-success",
    processing: "bg-info",
    default: "bg-muted-foreground",
    error: "bg-destructive",
    warning: "bg-warning",
}
