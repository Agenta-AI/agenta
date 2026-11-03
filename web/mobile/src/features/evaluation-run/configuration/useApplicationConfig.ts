import {useMemo} from "react"

import type {RunReferences} from "@agenta/entities/evaluationRun"
import {
    workflowArtifactQueryAtomFamily,
    workflowMolecule,
    workflowQueryAtomFamily,
} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

export interface ApplicationConfig {
    /** The app's name; null while it loads or when it cannot be read. */
    appName: string | null
    appFailed: boolean
    variantName: string | null
    version: number | null
    revisionId: string
    /** The stored revision data, shown as JSON; null while it loads or when it cannot be read. */
    snapshot: unknown
    configFailed: boolean
    /** A custom workflow that has no parameters schema: it has no form, only its stored JSON. */
    customWithoutSchema: boolean
}

/**
 * What the Application section shows: the app, its variant and its stored revision. Null when the
 * run has no application step. The atom is rebuilt only when an id changes.
 */
export function useApplicationConfig(references: RunReferences | null): ApplicationConfig | null {
    const applicationId = references?.applicationId ?? null
    const revisionId = references?.revisionId ?? null
    const version = references?.revisionVersion ?? null

    const configAtom = useMemo(
        () =>
            atom<ApplicationConfig | null>((get) => {
                if (!applicationId || !revisionId) return null
                const artifact = get(workflowArtifactQueryAtomFamily(applicationId))
                const revision = get(workflowQueryAtomFamily(revisionId))
                const stored = revision.data
                return {
                    appName: artifact.data?.name ?? null,
                    appFailed: artifact.isError || (!artifact.isPending && !artifact.data),
                    variantName: get(workflowMolecule.selectors.variantLabel(revisionId)),
                    version,
                    revisionId,
                    snapshot: stored?.data ?? null,
                    configFailed: revision.isError || (!revision.isPending && !stored),
                    customWithoutSchema:
                        stored?.flags?.is_custom === true && !stored.data?.schemas?.parameters,
                }
            }),
        [applicationId, revisionId, version],
    )
    return useAtomValue(configAtom)
}
