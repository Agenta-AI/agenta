import type {EvaluationRun} from "@agenta/entities/evaluationRun"

export interface RunReferences {
    applicationId: string | null
    applicationRevisionId: string | null
    testsetId: string | null
    testsetRevisionId: string | null
}

/** The first id found under `name` in any step of the run. */
const firstReferenceId = (run: EvaluationRun, name: string): string | null => {
    for (const step of run.data?.steps ?? []) {
        const id = step.references?.[name]?.id
        if (id) return id
    }
    return null
}

/** The app, revision and test set a run points at, read from its step references. */
export const readRunReferences = (run: EvaluationRun): RunReferences => ({
    applicationId: firstReferenceId(run, "application"),
    applicationRevisionId: firstReferenceId(run, "application_revision"),
    testsetId: firstReferenceId(run, "testset"),
    testsetRevisionId: firstReferenceId(run, "testset_revision"),
})

/** The label a row shows for a run: its name, else its id. */
export const runDisplayName = (run: EvaluationRun): string =>
    run.name?.trim() || run.id || "Untitled run"

/** A live run that is running now: active and not closed. */
export const isRunActive = (run: EvaluationRun): boolean =>
    run.flags?.is_active === true && run.flags?.is_closed !== true

export const isRunClosed = (run: EvaluationRun): boolean => run.flags?.is_closed === true
