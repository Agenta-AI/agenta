/** Version-drift tag shared by schedule + subscription rows. */
import {useMemo} from "react"

import {
    workflowMolecule,
    workflowRevisionsListQueryStateAtomFamily,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import type {TriggerReferences} from "../../../gatewayTrigger/drawers/shared/RunVersionField"
import {parseStoredBinding} from "../../../gatewayTrigger/drawers/shared/useTriggerBinding"

/**
 * The drift tag, shown only when a trigger targets a revision other than the open one:
 * a "latest" binding viewed from a past revision reads "Runs on latest version"; a pinned
 * binding viewed from any other revision reads "Runs on v{N}". Same-target rows show nothing.
 */
export function useDriftTag(references: TriggerReferences, entityId: string | null): string | null {
    const binding = useMemo(() => parseStoredBinding(references), [references])

    // Pinned: the bound revision names its own version.
    const pinnedRevision = useAtomValue(
        workflowMolecule.selectors.data(binding.revisionId ?? ""),
    ) as {version?: number | null} | null

    // Latest: the bound variant's newest revision is what actually runs.
    const revisions = useAtomValue(
        workflowRevisionsListQueryStateAtomFamily(binding.variantId ?? ""),
    )

    return useMemo(() => {
        // No open revision to compare against — can't tell whether it drifted.
        if (!entityId) return null

        if (binding.mode === "pinned") {
            if (!binding.revisionId || binding.revisionId === entityId) return null
            const version = pinnedRevision?.version
            return version != null ? `Runs on v${version}` : "Runs on pinned version"
        }

        const rows = (revisions.data as {id?: string; version?: number | null}[]).filter(
            (r) => r.version !== 0,
        )
        const latest = [...rows].sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0]
        if (!latest?.id || latest.id === entityId) return null
        return "Runs on latest version"
    }, [binding, entityId, pinnedRevision, revisions.data])
}
