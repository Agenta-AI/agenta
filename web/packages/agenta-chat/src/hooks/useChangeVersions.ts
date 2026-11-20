import {
    workflowArtifactQueryAtomFamily,
    workflowLatestRevisionQueryAtomFamily,
    workflowQueryAtomFamily,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

const numberOrUndefined = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === "") return undefined
    const version = Number(value)
    return Number.isFinite(version) ? version : undefined
}

/**
 * The version a change card saves on, and the agent's latest version, for "Saves as v{base + 1}"
 * and the conflict state before a click. The base comes from the server preview when it has one;
 * otherwise from the base revision. The latest version is the agent's latest-revision query, the
 * same one the latest-version check refreshes. `agentName` is the name of the agent the base
 * revision belongs to: the call names its agent by the slug or id the model passed. All three stay
 * undefined until they load.
 */
export const useChangeVersions = (
    base: {revisionId?: string; version?: number} | undefined,
): {baseVersion?: number; latestVersion?: number; agentName?: string} => {
    const revision = useAtomValue(workflowQueryAtomFamily(base?.revisionId ?? "")).data
    const workflowId = (revision as {workflow_id?: string | null} | null | undefined)?.workflow_id
    const latest = useAtomValue(workflowLatestRevisionQueryAtomFamily(workflowId ?? "")).data
    const agent = useAtomValue(workflowArtifactQueryAtomFamily(workflowId ?? "")).data
    return {
        baseVersion: base?.version ?? numberOrUndefined(revision?.version),
        latestVersion: workflowId ? numberOrUndefined(latest?.version) : undefined,
        agentName: (workflowId && agent?.name?.trim()) || undefined,
    }
}
