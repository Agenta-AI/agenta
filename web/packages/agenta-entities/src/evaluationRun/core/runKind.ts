/**
 * Evaluation run kind and status rules.
 *
 * One home for the questions every runs screen asks: what kind of run is this,
 * has it finished, and how do we word and colour its status.
 *
 * The kind comes from `run.data.steps`, never from `run.meta.evaluation_kind`
 * (some runs carry it, some do not).
 *
 * @packageDocumentation
 */

export type EvaluationRunKind = "auto" | "human" | "online" | "custom"

// "online" runs are shown as "Live". "custom" runs come from the SDK.
export const EVALUATION_KIND_LABELS: Record<EvaluationRunKind, string> = {
    auto: "Auto",
    human: "Human",
    online: "Live",
    custom: "SDK",
}

/**
 * Step fields read by the kind check. Both the raw API names and the camel-case
 * names are accepted, so a run from the API or from a table row both work.
 */
interface RunKindStep {
    type?: string | null
    stepType?: string | null
    kind?: string | null
    origin?: string | null
    step_role?: string | null
    stepRole?: string | null
    metadata?: {origin?: string | null} | null
}

export interface RunKindInput {
    status?: string | null
    data?: {steps?: readonly RunKindStep[] | null} | null
    flags?: Record<string, unknown> | null
    meta?: Record<string, unknown> | null
}

const stepType = (step: RunKindStep) => step.type ?? step.stepType ?? step.kind
const stepOrigin = (step: RunKindStep) => step.origin ?? step.step_role ?? step.stepRole

const isOnlineRun = (run: RunKindInput): boolean => {
    if (run.flags?.isLive === true || run.flags?.is_live === true) return true
    const source = run.meta?.source
    return typeof source === "string" && source.toLowerCase() === "online_evaluation_drawer"
}

/**
 * Derive the kind of a run. Order: online (live flag or the online drawer
 * source), human (an annotation step with origin human), custom (a step with
 * origin or type custom), otherwise auto.
 */
export function deriveEvaluationKind(run: RunKindInput | null | undefined): EvaluationRunKind {
    if (!run) return "auto"
    if (isOnlineRun(run)) return "online"

    const steps = Array.isArray(run.data?.steps) ? run.data.steps : []
    if (steps.some((step) => stepType(step) === "annotation" && stepOrigin(step) === "human")) {
        return "human"
    }
    if (
        steps.some(
            (step) =>
                stepOrigin(step) === "custom" ||
                stepType(step) === "custom" ||
                step.metadata?.origin === "custom",
        )
    ) {
        return "custom"
    }
    return "auto"
}

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
    "success",
    "failure",
    "failed",
    "errors",
    "cancelled",
    "completed",
    "finished",
    "ok",
    "evaluation_finished",
    "evaluation_finished_with_errors",
    "evaluation_failed",
    "evaluation_aggregation_failed",
])

/** True when the run has finished. The check ignores case. */
export function isTerminalRunStatus(status: string | null | undefined): boolean {
    return typeof status === "string" && TERMINAL_RUN_STATUSES.has(status.toLowerCase())
}

/**
 * True when a list should keep refreshing for this run: it has a status that is
 * not terminal, and it is an auto or SDK run. Live runs are expected to stay
 * `running` while active and human runs to stay open until annotated, so they
 * never count.
 */
export function isRunInProgress(run: RunKindInput | null | undefined): boolean {
    if (!run?.status || isTerminalRunStatus(run.status)) return false
    const kind = deriveEvaluationKind(run)
    return kind === "auto" || kind === "custom"
}

/**
 * The status a screen shows for a run. A stopped live run keeps `running` on the server and only
 * sets its `is_active` flag to false, so it reads `stopped` here. A run with no such flag, a
 * closed run and every other run show their own status.
 */
export function runDisplayStatus(run: RunKindInput): string | null {
    const status = run.status ?? null
    if (!status || isTerminalRunStatus(status) || !isOnlineRun(run)) return status
    const inactive = run.flags?.is_active === false || run.flags?.isActive === false
    const closed = run.flags?.is_closed === true || run.flags?.isClosed === true
    return inactive && !closed ? "stopped" : status
}

export type RunStatusTone = "success" | "processing" | "error" | "warning" | "default"

export function runStatusTone(status: string): RunStatusTone {
    const s = status.toLowerCase()
    if (s.includes("success") || s.includes("completed") || s === "finished" || s === "ok") {
        return "success"
    }
    if (s.includes("fail") || s.includes("error")) return "error"
    if (
        s.includes("run") ||
        s.includes("progress") ||
        s.includes("queued") ||
        s.includes("active")
    ) {
        return "processing"
    }
    if (s.includes("warn") || s.includes("partial") || s.includes("degraded")) return "warning"
    return "default"
}

/** "evaluation_finished" -> "Evaluation Finished", "running" -> "Running". */
export function humanizeRunStatus(status: string): string {
    return status.replaceAll("_", " ").replace(/(^|\s)([a-z])/g, (match) => match.toUpperCase())
}
