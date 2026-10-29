/** Version-drift tag shared by schedule + subscription rows. */
import {useMemo} from "react"

import type {TriggerReferences} from "../../../gatewayTrigger/drawers/shared/RunVersionField"
import {
    parseStoredBinding,
    useBoundRevision,
} from "../../../gatewayTrigger/drawers/shared/useTriggerBinding"

/**
 * The drift tag, shown only when a trigger targets a revision other than the open one:
 * a "latest" binding viewed from a past revision reads "Runs on latest version"; a pinned
 * binding viewed from any other revision reads "Runs on v{N}". Same-target rows show nothing.
 */
export function useDriftTag(references: TriggerReferences, entityId: string | null): string | null {
    const binding = useMemo(() => parseStoredBinding(references), [references])
    // The same resolution the drawer's version label uses — read separately, these two
    // disagreed about pinned revisions and could name different versions for one trigger.
    const bound = useBoundRevision(binding)

    return useMemo(() => {
        // No open revision to compare against — can't tell whether it drifted.
        if (!entityId) return null

        if (binding.mode === "pinned") {
            if (!binding.revisionId || binding.revisionId === entityId) return null
            return bound?.version != null ? `Runs on v${bound.version}` : "Runs on pinned version"
        }

        if (!bound?.id || bound.id === entityId) return null
        return "Runs on latest version"
    }, [binding, entityId, bound])
}
