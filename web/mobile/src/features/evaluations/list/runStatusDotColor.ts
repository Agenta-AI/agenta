import type {RunStatusTone} from "@agenta/entities/evaluationRun"

/** The dot color of each run status tone; every evaluation screen uses these. */
export const RUN_STATUS_DOT_COLOR: Record<RunStatusTone, string> = {
    success: "bg-[var(--ag-run-status-success)]",
    processing: "bg-[var(--ag-run-status-processing)]",
    default: "bg-[var(--ag-run-status-default)]",
    error: "bg-[var(--ag-run-status-error)]",
    warning: "bg-[var(--ag-run-status-warning)]",
}
