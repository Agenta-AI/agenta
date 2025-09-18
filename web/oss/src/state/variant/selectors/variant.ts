import deepEqual from "fast-deep-equal"
import {atom, getDefaultStore} from "jotai"
import {selectAtom, atomFamily} from "jotai/utils"

import {formatDate24} from "@/oss/lib/helpers/dateTimeHelper"

import {
    revisionsByVariantIdAtomFamily,
    variantsAtom,
    appUriInfoAtom,
    userProfilesMapAtom,
    getEnhancedRevisionById,
    allRevisionsAtom,
} from "../atoms/fetcher"

export const revisionListAtom = selectAtom(
    allRevisionsAtom,
    (revisions) => revisions.slice().sort((a, b) => b.createdAtTimestamp - a.createdAtTimestamp),
    deepEqual,
)

// Lightweight stable selector: direct display name by variantId from variants
export const variantDisplayNameByIdAtomFamily = atomFamily((variantId: string) =>
    selectAtom(
        variantsAtom,
        (variants) => {
            const v: any = (variants as any[]).find((x: any) => x.variantId === variantId)
            return ((v?.variantName ?? v?.name) as string) || "-"
        },
        (a, b) => a === b,
    ),
)

// Optimized selector for the 5 most recently updated revisions
export const recentRevisionsAtom = selectAtom(
    revisionListAtom,
    (revisions) => revisions.slice(0, 5),
    deepEqual,
)

// Lean version: only expose minimal shape to reduce subscriptions in lightweight UIs
export const recentRevisionsTableRowsAtom = selectAtom(
    revisionListAtom,
    (revisions) =>
        revisions.slice(0, 5).map((r) => {
            const modelName = getDefaultStore().get(modelNameByRevisionIdAtomFamily(r.id))
            const ts = r.updatedAtTimestamp ?? r.createdAtTimestamp
            return {
                id: r.id,
                commitMessage: r.commitMessage,
                createdAt: formatDate24(ts),
                modifiedBy: r.modifiedBy,
                modelName,
            }
        }),
    deepEqual,
)

// Latest revision id per variant
export const latestRevisionIdByVariantIdAtomFamily = atomFamily((variantId: string) =>
    selectAtom(
        revisionsByVariantIdAtomFamily(variantId),
        (revs: any[]) => {
            if (!Array.isArray(revs) || revs.length === 0) return null
            // Prefer createdAtTimestamp when available, fallback to numeric revision
            const latest = revs.reduce((acc: any, r: any) => {
                if (!acc) return r
                const aTs = acc.createdAtTimestamp ?? acc.revision ?? 0
                const rTs = r.createdAtTimestamp ?? r.revision ?? 0
                return aTs >= rTs ? acc : r
            }, null as any)
            return latest?.id ?? null
        },
        (a, b) => a === b,
    ),
)

// Latest revision object per variant (returns the full revision info or null)
export const latestRevisionInfoByVariantIdAtomFamily = atomFamily((variantId: string) =>
    selectAtom(
        revisionsByVariantIdAtomFamily(variantId),
        (revs: any[]) => {
            if (!Array.isArray(revs) || revs.length === 0) return null
            return revs.reduce((acc: any, r: any) => {
                if (!acc) return r
                const aTs = acc.createdAtTimestamp ?? acc.revision ?? 0
                const rTs = r.createdAtTimestamp ?? r.revision ?? 0
                return aTs >= rTs ? acc : r
            }, null as any)
        },
        deepEqual,
    ),
)

// Latest revision across the entire app
export const latestAppRevisionIdAtom = selectAtom(
    revisionListAtom,
    (revs) => (revs.length ? revs[0].id : null),
    (a, b) => a === b,
)

export const latestAppRevisionInfoAtom = selectAtom(
    revisionListAtom,
    (revs) => (revs.length ? revs[0] : null),
    deepEqual,
)

// ---------------------------------------------------------------------------
// On-demand enrichment selectors (lean, no duplication)

// Derive the user profile associated with a revision's "modifiedBy*" field
export const variantUserProfileAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const rev: any = getEnhancedRevisionById(get as any, revisionId)
        const profilesResult = get(userProfilesMapAtom) as any
        const profilesMap: Map<string, any> =
            profilesResult && profilesResult.data
                ? (profilesResult.data as Map<string, any>)
                : new Map()

        const modBy =
            rev?.modifiedById ??
            rev?.modifiedBy ??
            rev?.modified_by_id ??
            rev?.modified_by ??
            rev?.createdBy ??
            rev?.created_by ??
            null

        const userProfile =
            modBy && typeof modBy === "string" && profilesMap.has(modBy)
                ? profilesMap.get(modBy)
                : null
        return {modifiedById: (modBy as string) ?? null, userProfile}
    }),
)

// Stable string selector for display name to avoid object identity churn
export const variantUserDisplayNameAtomFamily = atomFamily((revisionId: string) =>
    selectAtom(
        variantUserProfileAtomFamily(revisionId),
        ({userProfile, modifiedById}) => {
            const up: any = userProfile as any

            const direct = up?.displayName || up?.name || up?.username || up?.email || null
            if (direct && typeof direct === "string") return direct as string

            const id = (modifiedById as string) || ""
            const looksLikeUuid =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
            return looksLikeUuid ? "-" : id || "-"
        },
        (a, b) => a === b,
    ),
)

// ---------------------------------------------------------------------------
// Parent Variant selectors for adapted revisions

// Raw parent variant object by id (no deep cloning)
export const parentVariantByIdAtomFamily = atomFamily((variantId: string) =>
    atom((get) => {
        const vars = get(variantsAtom)
        return vars.find((x) => x.variantId === variantId) ?? null
    }),
)

// Latest commit message on parent variant (single pass, no array copy)
export const parentVariantLatestCommitMessageAtomFamily = atomFamily((variantId: string) =>
    atom((get) => {
        const v = get(parentVariantByIdAtomFamily(variantId)) as any
        const revs: any[] = (v?.revisions as any[]) || []
        if (revs.length === 0) return null
        const latest = revs.reduce((acc, r) => (acc && acc.revision > r.revision ? acc : r), null)
        return latest?.commitMessage ?? latest?.commit_message ?? null
    }),
)

// Stable display name string for a parent variant id
export const parentVariantDisplayNameAtomFamily = atomFamily((variantId: string) =>
    selectAtom(
        parentVariantByIdAtomFamily(variantId),
        (info) => (info?.variantName ?? info?.name ?? "-") as string,
        deepEqual,
    ),
)

// ---------------------------------------------------------------------------
// Per-revision selectors

// Model name (from parameters)
export const modelNameByRevisionIdAtomFamily = atomFamily((revisionId: string) =>
    selectAtom(
        atom((get) => getEnhancedRevisionById(get as any, revisionId) as any),
        (rev) => {
            if (!rev) return "-"
            const parameters = (rev.parameters?.prompt as any)?.llm_config || rev.parameters || {}
            const model = (parameters as any)?.model as string | undefined
            return model && typeof model === "string" && model.trim().length ? model : "-"
        },
        (a, b) => a === b,
    ),
)
