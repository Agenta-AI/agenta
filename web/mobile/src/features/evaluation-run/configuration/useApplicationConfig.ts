import {runReferencesAtomFamily} from "@agenta/entities/evaluationRun"
import {
    workflowArtifactQueryAtomFamily,
    workflowMolecule,
    workflowQueryAtomFamily,
} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"

export interface ApplicationConfig {
    applicationId: string
    /** The app's name; null while it loads or when it cannot be read. */
    appName: string | null
    appFailed: boolean
    variantName: string | null
    /** The version the run names, else the stored revision's own. */
    version: number | null
    revisionId: string
    /** The stored revision data, shown as JSON; null while it loads or when it cannot be read. */
    snapshot: unknown
    configFailed: boolean
    /** A custom workflow that has no parameters schema: it has no form, only its stored JSON. */
    customWithoutSchema: boolean
}

/** What the Application section shows for one run. Null when the run has no application step. */
const applicationConfigAtomFamily = atomFamily((runId: string) =>
    atom<ApplicationConfig | null>((get) => {
        const references = get(runReferencesAtomFamily(runId))
        const applicationId = references?.applicationId
        const revisionId = references?.revisionId
        if (!applicationId || !revisionId) return null

        const artifact = get(workflowArtifactQueryAtomFamily(applicationId))
        const revision = get(workflowQueryAtomFamily(revisionId))
        const stored = revision.data
        return {
            applicationId,
            appName: artifact.data?.name ?? null,
            appFailed: artifact.isError || (!artifact.isPending && !artifact.data),
            variantName: get(workflowMolecule.selectors.variantLabel(revisionId)),
            version: references.revisionVersion ?? stored?.version ?? null,
            revisionId,
            snapshot: stored?.data ?? null,
            configFailed: revision.isError || (!revision.isPending && !stored),
            customWithoutSchema:
                stored?.flags?.is_custom === true && !stored.data?.schemas?.parameters,
        }
    }),
)

export const useApplicationConfig = (runId: string) =>
    useAtomValue(applicationConfigAtomFamily(runId))
