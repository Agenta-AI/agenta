import type {RunStatusTone} from "@agenta/entities/evaluationRun"
import {STATUS_TONE_TEXT_COLOR} from "@agenta/ui/components/presentational"

/** The dot color of each run status tone; every evaluation screen uses these. */
export const RUN_STATUS_DOT_COLOR: Record<RunStatusTone, string> = {
    success: "bg-success",
    processing: "bg-info",
    default: "bg-muted-foreground",
    error: "bg-destructive",
    warning: "bg-warning",
}

/**
 * The text color of each run status tone (a status word next to its dot): the shared status
 * colors of `@agenta/ui`, so `processing` reads `text-info` in every view.
 */
export const RUN_STATUS_TEXT_COLOR: Readonly<Record<RunStatusTone, string>> = STATUS_TONE_TEXT_COLOR
