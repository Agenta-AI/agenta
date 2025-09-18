import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {displayedVariantsAtom} from "@/oss/components/Playground/state/atoms"
import {logicalTurnIndexAtom, runStatusByRowRevisionAtom} from "@/oss/state/generation/entities"
import {pendingWebWorkerRequestsAtom} from "@/oss/state/newPlayground/mutations/webWorkerIntegration"

/**
 * Derived chat view atoms: single source of truth for mapping and run status.
 */

// Resolve session turn id for a given logical turn and revision
export const sessionTurnIdForVariantAtomFamily = atomFamily(
    (p: {logicalId: string; revisionId: string}) =>
        atom((get) => {
            const displayed = (get(displayedVariantsAtom) || []) as string[]
            // If revision is not currently displayed, do not resolve a session turn id
            if (
                Array.isArray(displayed) &&
                displayed.length > 0 &&
                !displayed.includes(p.revisionId)
            )
                return ""
            const map = (get(logicalTurnIndexAtom)?.[p.logicalId] || {}) as Record<string, string>
            return (map[p.revisionId] || "") as string
        }),
)

// Is the cell (logicalId, revisionId) running (either status map or pending worker)?
export const isCellRunningAtomFamily = atomFamily((p: {logicalId: string; revisionId: string}) =>
    atom((get) => {
        const sessionTurnId = get(sessionTurnIdForVariantAtomFamily(p)) || p.logicalId
        const key = `${sessionTurnId}:${p.revisionId}`
        const statusMap = get(runStatusByRowRevisionAtom) as any
        const statusRunning = Boolean(statusMap?.[key]?.isRunning)
        const pending = (get(pendingWebWorkerRequestsAtom) || {}) as Record<
            string,
            {rowId: string; variantId: string}
        >
        const pendingRunning = Object.values(pending).some(
            (r) => r?.variantId === p.revisionId && String(r?.rowId || "") === sessionTurnId,
        )
        return statusRunning || pendingRunning
    }),
)

// Is any cell for this logical row running across displayed revisions?
export const isAnyRunningForLogicalAtomFamily = atomFamily((logicalId: string) =>
    atom((get) => {
        const displayed = (get(displayedVariantsAtom) || []) as string[]
        return (displayed || []).some((rev) =>
            get(isCellRunningAtomFamily({logicalId, revisionId: rev})),
        )
    }),
)
