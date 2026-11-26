import type {EvaluationRun} from "@agenta/entities/evaluationRun"

type StepKind = "auto" | "human" | "custom"

/** A run as the API returns it. `kind` shapes the steps the way the kind check reads them. */
export const makeRun = (
    id: string,
    options: {
        kind?: StepKind
        live?: boolean
        status?: string
        name?: string | null
        flags?: Record<string, unknown>
        references?: Record<string, {id: string}>
    } = {},
): EvaluationRun => {
    const {kind = "auto", live = false, status = "success", name = `Run ${id}`} = options
    const origin = kind === "human" ? "human" : kind === "custom" ? "custom" : "auto"
    return {
        id,
        name,
        status,
        flags: {is_live: live, ...options.flags},
        created_at: "2026-03-04T10:15:00Z",
        created_by_id: "user-1",
        data: {
            steps: [
                {key: "input", type: "input", origin: "auto", references: options.references ?? {}},
                {key: "annotation", type: "annotation", origin},
            ],
        },
    } as EvaluationRun
}

export const page = (runs: EvaluationRun[], next: string | null = null) => ({
    data: {count: runs.length, runs, windowing: {next}},
})
