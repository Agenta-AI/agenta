/**
 * Overview Variants Atoms
 *
 * Local atoms for the variants overview page.
 * These read directly from entity APIs, not from playground state.
 */

import {
    appRevisionsWithDraftsAtomFamily,
    variantsQueryAtomFamily,
    revisionsQueryAtomFamily,
} from "@agenta/entities/legacyAppRevision"
import isEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"

const isPromiseLike = (value: unknown): value is Promise<unknown> =>
    Boolean(value && typeof (value as {then?: unknown}).then === "function")

/**
 * Whether all variant/revision queries for the current app have completed.
 * Standalone readiness check (no playground dependency).
 */
export const revisionsReadyAtom = atom((get) => {
    const appId = get(selectedAppIdAtom)
    if (!appId || isPromiseLike(appId)) return false

    const variantsQuery = get(variantsQueryAtomFamily(appId))
    if (variantsQuery.isPending) return false

    const variantsData = (variantsQuery.data ?? []) as {id: string}[]
    if (variantsData.length === 0) return true

    for (const variant of variantsData) {
        if (!variant?.id) continue
        const revisionsQuery = get(revisionsQueryAtomFamily(variant.id))
        if (revisionsQuery.isPending) return false
    }
    return true
})

/**
 * Recent revisions for the overview table.
 * Returns the 5 most recently updated server revisions (raw, no enrichment).
 */
export const recentRevisionsOverviewAtom = selectAtom(
    atom((get) => {
        const appId = get(selectedAppIdAtom)
        if (!appId || isPromiseLike(appId)) return []
        return get(appRevisionsWithDraftsAtomFamily(appId))
    }),
    (revisions) => revisions.filter((r: any) => !r.isLocalDraft).slice(0, 5),
    isEqual,
)
