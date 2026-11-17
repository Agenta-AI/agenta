import type {EvaluationRun, EvaluationRunStepReference} from "@agenta/entities/evaluationRun"

export interface RunReferences {
    applicationId: string | null
    applicationVariantId: string | null
    applicationRevisionId: string | null
    /** The app revision's version, "5" for "v5". */
    applicationRevisionVersion: string | null
    testsetId: string | null
    testsetRevisionId: string | null
    /** The test set revision's version, "3" for "v3". */
    testsetRevisionVersion: string | null
    queryRevisionId: string | null
}

/** The first reference under `name` in any step of the run that has an id. */
const firstReference = (run: EvaluationRun, name: string): EvaluationRunStepReference | null => {
    for (const step of run.data?.steps ?? []) {
        const reference = step.references?.[name]
        if (reference?.id) return reference
    }
    return null
}

const versionOf = (reference: EvaluationRunStepReference | null): string | null =>
    reference?.version === undefined || reference.version === null
        ? null
        : String(reference.version)

/** The app, variant, revision, test set and query a run points at, read from its step references. */
export const readRunReferences = (run: EvaluationRun): RunReferences => {
    const applicationRevision = firstReference(run, "application_revision")
    const testsetRevision = firstReference(run, "testset_revision")
    return {
        applicationId: firstReference(run, "application")?.id ?? null,
        applicationVariantId: firstReference(run, "application_variant")?.id ?? null,
        applicationRevisionId: applicationRevision?.id ?? null,
        applicationRevisionVersion: versionOf(applicationRevision),
        testsetId: firstReference(run, "testset")?.id ?? null,
        testsetRevisionId: testsetRevision?.id ?? null,
        testsetRevisionVersion: versionOf(testsetRevision),
        queryRevisionId: firstReference(run, "query_revision")?.id ?? null,
    }
}

/** The label a row shows for a run: its name, else its id. */
export const runDisplayName = (run: EvaluationRun): string =>
    run.name?.trim() || run.id || "Untitled run"

/** A live run that is running now: active and not closed. */
export const isRunActive = (run: EvaluationRun): boolean =>
    run.flags?.is_active === true && run.flags?.is_closed !== true

export const isRunClosed = (run: EvaluationRun): boolean => run.flags?.is_closed === true
