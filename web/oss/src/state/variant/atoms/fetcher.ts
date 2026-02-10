// type-only imports first (eslint import/order)
import deepEqual from "fast-deep-equal"
import {atom, getDefaultStore} from "jotai"
import {atomFamily, loadable, selectAtom} from "jotai/utils"
import {atomWithQuery, queryClientAtom} from "jotai-tanstack-query"

import {formatDay, parseDate} from "@/oss/lib/helpers/dateTimeHelper"
import {snakeToCamel} from "@/oss/lib/helpers/utils"
import {adaptRevisionToVariant} from "@/oss/lib/shared/variant"
import {fetchRevisions} from "@/oss/lib/shared/variant/api"
import {fetchOpenApiSchemaJson} from "@/oss/lib/shared/variant/transformer"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {findRevisionDeployment} from "@/oss/lib/shared/variant/utils"
import type {Variant, VariantRevision} from "@/oss/lib/Types"
import {fetchVariants as fetchAppVariants, fetchSingleProfile} from "@/oss/services/api"
import {recentAppIdAtom, routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"
import {currentAppContextAtom, selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {appStateSnapshotAtom} from "@/oss/state/appState"
import {environmentsAtom} from "@/oss/state/environment/atoms/fetcher"
import {projectIdAtom} from "@/oss/state/project/selectors/project"
import {projectScopedVariantsAtom} from "@/oss/state/projectVariantConfig"

// Utility: check if a string is a canonical UUID (v1–v5)
const isUuid = (val: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)

// basic completeness check – treat stub objects (missing username/email) as incomplete
const isCompleteUser = (u: any): boolean =>
    !!u && typeof u.username === "string" && typeof u.email === "string"

// -------- Variants list for current app ------------------------------------
export const variantsQueryAtom = atomWithQuery<Variant[]>((get) => {
    const projectId = get(projectIdAtom)
    const routerAppId = get(routerAppIdAtom)
    const appId = routerAppId ?? get(recentAppIdAtom) ?? undefined

    // Enable query only when we resolved an app id (router or recent) and the project is known
    const enabled = !!appId && !!projectId

    return {
        queryKey: ["variants", appId, projectId],
        queryFn: async () => {
            const data = await fetchAppVariants(appId as string, false)

            return data
        },
        staleTime: 1000 * 60,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchOnMount: false,
        enabled,
    }
})

// Expose variants list (resolved data) ---------------------------------------
const EmptyVariants: Variant[] = []
export const variantsAtom = selectAtom(
    variantsQueryAtom,
    (res) => {
        const raw: Variant[] = ((res as any)?.data ?? EmptyVariants) as Variant[]
        if (raw.length === 0) return EmptyVariants

        // Deduplicate by variantId keeping newest timestamp
        const byId = new Map<string, Variant>()
        for (const v of raw) {
            const existing = byId.get(v.variantId)
            if (!existing || existing.createdAtTimestamp < v.createdAtTimestamp) {
                byId.set(v.variantId, v)
            }
        }
        // Sort descending by createdAtTimestamp
        return Array.from(byId.values()).sort((a, b) => b.createdAtTimestamp - a.createdAtTimestamp)
    },
    deepEqual,
)

// -------- Revisions per variant (atomFamily) --------------------------------
export const variantRevisionsQueryFamily = atomFamily((variantId: string) =>
    atomWithQuery<VariantRevision[]>((get) => {
        const projectId = get(projectIdAtom)
        // Depend on variants query to ensure revisions refetch when variants change
        const variantsQuery = get(variantsQueryAtom)
        const enabled = !!variantId && !!projectId
        return {
            queryKey: ["variantRevisions", variantId, variantsQuery.dataUpdatedAt],
            queryFn: async () => {
                const parentVariant = variantsQuery.data?.find((v) => v.variantId === variantId)
                const apiRevs = await fetchRevisions(variantId, projectId!)

                const revs = apiRevs.map((r, idx) => {
                    const rev = {
                        // spread retains camel-cased util outputs if any
                        ...r,
                        variantId,
                        variantName: parentVariant?.variantName,
                        createdAt: formatDay({
                            date: r.created_at,
                            inputFormat: "YYYY-MM-DD HH:mm:ss.SSSZ",
                        }),
                        createdAtTimestamp: parseDate({
                            date: r.created_at,
                            inputFormat: "YYYY-MM-DD HH:mm:ss.SSSZ",
                        })
                            .toDate()
                            .valueOf(),
                        updatedAtTimestamp:
                            (r.updated_at ?? r.created_at)
                                ? parseDate({
                                      date: r.updated_at ?? r.created_at,
                                      inputFormat: "YYYY-MM-DD HH:mm:ss.SSSZ",
                                  })
                                      .toDate()
                                      .valueOf()
                                : null,
                    }

                    const adapted = adaptRevisionToVariant(rev, parentVariant)
                    adapted.uri = parentVariant?.uri ?? adapted?.uri
                    return adapted
                }) as VariantRevision[]

                return revs
            },
            staleTime: 1000 * 60,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            refetchOnMount: false,
            placeholderData: (previousData) => {
                const previousVariantId = previousData?.map((v) => v.variantId)
                if (previousVariantId?.includes(variantId)) {
                    return previousData
                }
                return []
            },
            enabled,
        }
    }),
)

// Normalized: expose revisions array directly per variantId (new in Phase 2)
export const revisionsByVariantIdAtomFamily = atomFamily(
    (variantId: string) =>
        selectAtom(variantRevisionsQueryFamily(variantId), (res) => {
            const data = (res as any)?.data ?? res
            return (Array.isArray(data) ? data : []) as VariantRevision[]
        }),
    deepEqual,
)

// -------- Central: all revisions flattened across variants ------------------
export const allRevisionsAtom = atom((get) => {
    const vars = get(variantsAtom)
    const out: EnhancedVariant[] = []
    vars.forEach((v) => {
        const revs = (get(revisionsByVariantIdAtomFamily(v.variantId)) as any[]) || []
        revs.forEach((r: any) => {
            if (r && r.revision != null && Number(r.revision) >= 0) out.push(r as EnhancedVariant)
        })
    })

    return out
})

// Sorted enhanced revisions newest-first
export const sortedEnhancedRevisionsAtom = selectAtom(allRevisionsAtom, (list: EnhancedVariant[]) =>
    list
        .slice()
        .sort(
            (a: EnhancedVariant, b: EnhancedVariant) => b.updatedAtTimestamp - a.updatedAtTimestamp,
        ),
)

// Revision map variantId -> enhanced revisions[] (newest-first)
export const revisionMapAtom = atom<Record<string, EnhancedVariant[]>>((get) => {
    const vars = get(variantsAtom) as any[]
    const map: Record<string, EnhancedVariant[]> = {}
    vars.forEach((v: any) => {
        const revs = get(revisionsByVariantIdAtomFamily(v.variantId)) as any[]
        const arr: EnhancedVariant[] = []
        ;(revs || []).forEach((r: any) => {
            if (r && r.revision != null && Number(r.revision) >= 0) arr.push(r as EnhancedVariant)
        })
        map[v.variantId] = arr.sort(
            (a: EnhancedVariant, b: EnhancedVariant) => b.updatedAtTimestamp - a.updatedAtTimestamp,
        )
    })
    return map
})

// -------- App-level OpenAPI spec/URI (single source of truth) ---------------

// Unified query: fetch openapi.json ONCE for the app and derive uri info & schema
export interface UriState {
    runtimePrefix: string
    routePath?: string
    schema: any
}

export const appUriStateQueryAtom = atomWithQuery<UriState | undefined>((get) => {
    const variants = get(variantsAtom)
    const firstUri = (variants[0] as any)?.uri as string | undefined
    const appType = get(currentAppContextAtom)?.appType || null
    const isCustomApp = appType === "custom"

    // Disable legacy schema fetch on routes that use the entity-layer schema atoms
    // (service prefetch + per-revision fallback) instead of Pipeline A.
    // The playground has fully migrated to Pipeline B (playgroundAppAtoms.ts uses
    // legacyAppRevisionSchemaQueryAtomFamily), so skip on all playground routes.
    const appState = get(appStateSnapshotAtom)
    const isPlayground = appState.pathname?.includes("/playground")
    const isVariantDrawer = appState.pathname?.includes("/variants")
    const shouldSkipLegacyFetch = isPlayground || isVariantDrawer

    const fetchRecursive = async (current: string, removed = ""): Promise<UriState> => {
        const result = await fetchOpenApiSchemaJson(current)
        if (result.schema) {
            return {
                runtimePrefix: current,
                routePath: removed || undefined,
                schema: result.schema,
            }
        }
        const parts = current.split("/")
        const popped = parts.pop()!
        if (parts.length === 0) {
            throw new Error("openapi.json not found")
        }
        return fetchRecursive(parts.join("/"), removed ? `${popped}/${removed}` : popped)
    }

    const currentAppId = get(selectedAppIdAtom)
    return {
        queryKey: ["appSpec", currentAppId, firstUri ?? ""],
        queryFn: () => (firstUri ? fetchRecursive(firstUri) : Promise.resolve(undefined)),
        staleTime: isCustomApp ? undefined : 1000 * 60 * 5,
        placeholderData: (previousData) => previousData,
        enabled: !!firstUri && !shouldSkipLegacyFetch,
        refetchInterval: isCustomApp ? 1000 * 60 * 1 : false,
    }
})

// appStatus is Loading atom family. by looking at the query atom loading status
export const appStatusLoadingAtom = selectAtom(
    appUriStateQueryAtom,
    (q: any) => !q?.isFetched,
    Object.is,
)

// Backwards-compatible app-level simple selector (runtimePrefix/routePath)
export const appUriStateAtom = selectAtom(appUriStateQueryAtom, (res) => (res as any)?.data ?? res)

// Base app schema from app context
const baseAppSchemaAtom = selectAtom(
    appUriStateQueryAtom,
    (res) => (res as any)?.data?.schema ?? (res as any)?.schema,
)

// Combined schema atom that falls back to project-scoped schema
// This is needed for evaluation run details where app context may not be available
export const appSchemaAtom = atom((get) => {
    // First try app-context schema
    const appSchema = get(baseAppSchemaAtom)
    if (appSchema) return appSchema

    // Fallback to project-scoped schema (first available)
    const projectScoped = get(projectScopedVariantsAtom)
    if (projectScoped?.specMap) {
        const firstSchema = Object.values(projectScoped.specMap).find(Boolean)
        if (firstSchema) return firstSchema
    }

    return undefined
})

// Base URI info from app context
const baseAppUriInfoAtom = selectAtom(appUriStateQueryAtom, (res) => {
    const data: any = (res as any)?.data ?? res
    if (!data) return undefined
    return {runtimePrefix: data.runtimePrefix, routePath: data.routePath}
})

// Combined URI info atom that falls back to project-scoped URI info
export const appUriInfoAtom = atom((get) => {
    // First try app-context URI info
    const appUriInfo = get(baseAppUriInfoAtom)
    if (appUriInfo) return appUriInfo

    // Fallback to project-scoped URI info (first available)
    const projectScoped = get(projectScopedVariantsAtom)
    if (projectScoped?.uriMap) {
        const firstUri = Object.values(projectScoped.uriMap).find(Boolean)
        if (firstUri) return firstUri
    }

    return undefined
})

// Centralized lazy getter for OpenAPI spec
export const getSpecLazy = () => {
    try {
        const store = getDefaultStore()
        const schema = store.get(appSchemaAtom) as any
        return schema || null
    } catch (e) {
        return null
    }
}

// -------- User profiles ------------------------------------------------------

// Collect all user IDs appearing in variants or their revisions
const userIdsAtom = atom<string[]>((get) => {
    const variants = get(variantsAtom) as any[]
    const ids = new Set<string>()
    variants.forEach((v) => {
        const modBy =
            (v as any).modifiedById ??
            (v as any).modifiedBy ??
            (v as any).modified_by_id ??
            (v as any).modified_by
        const crtBy = (v as any).createdBy ?? (v as any).created_by
        if (modBy && isUuid(String(modBy))) ids.add(String(modBy))
        if (crtBy && isUuid(String(crtBy))) ids.add(String(crtBy))

        // collect from revisions of this variant via normalized family
        const revs = get(revisionsByVariantIdAtomFamily(v.variantId)) as any[]
        revs.forEach((r) => {
            const m =
                (r as any).modifiedById ??
                r.modifiedBy ??
                (r as any).modified_by_id ??
                r.modified_by
            const c = r.createdBy ?? r.created_by
            if (m && isUuid(String(m))) ids.add(String(m))
            if (c && isUuid(String(c))) ids.add(String(c))
        })
    })
    return Array.from(ids)
})

// Normalized: global reverse index of revisions by id -> {variantId}
export const revisionIndexAtom = atom((get) => {
    const variants = get(variantsAtom)
    const index = new Map<string, {variantId: string}>()
    variants.forEach((v) => {
        const revs = get(revisionsByVariantIdAtomFamily(v.variantId))
        ;(revs || []).forEach((r) => {
            index.set(r.id, {variantId: v.variantId})
        })
    })
    return index
})

// ID routing map: revisionId -> variantId (built from revisionIndexAtom)
export const revisionIdToVariantIdAtom = atom((get) => {
    const idx = get(revisionIndexAtom) as Map<string, {variantId: string}>
    const out: Record<string, string> = {}
    idx.forEach((val, key) => {
        out[key] = val.variantId
    })
    return out
})

// Cheap selector: per-revision data via routing to the correct variant slice
export const enhancedRevisionByIdAtomFamily = atomFamily(
    (revisionId: string) =>
        atom<EnhancedVariant | undefined>((get) => {
            const map = get(revisionIdToVariantIdAtom)
            const variantId = map[revisionId]
            if (!variantId) return undefined
            const revs = get(revisionsByVariantIdAtomFamily(variantId)) as any[]
            return revs?.find((r: any) => r.id === revisionId) as EnhancedVariant | undefined
        }),
    deepEqual,
)

// Backwards-compatible helper using the routing map
export function getEnhancedRevisionById(
    get: (an: any) => any,
    revisionId: string,
): EnhancedVariant | undefined {
    // First, check app-context variants
    const map = get(revisionIdToVariantIdAtom)
    const variantId = map[revisionId]
    if (variantId) {
        const revs = get(revisionsByVariantIdAtomFamily(variantId)) as any[]
        const found = revs?.find((r: any) => r.id === revisionId) as EnhancedVariant | undefined
        if (found) return found
    }

    // Fallback: check project-scoped variants (for evaluation run details context)
    const projectScoped = get(projectScopedVariantsAtom)
    if (projectScoped?.revisions?.length) {
        const found = projectScoped.revisions.find(
            (r: any) => r.id === revisionId || r.variantId === revisionId,
        )
        if (found) return found as EnhancedVariant
    }

    return undefined
}

export const userProfilesMapAtom = atomWithQuery<Map<string, any>>((get) => {
    const ids = get(userIdsAtom)
    return {
        queryKey: ["user-profiles", ids],
        enabled: ids.length > 0,
        staleTime: 60_000,
        placeholderData: (previousData) => previousData,
        queryFn: async () => {
            const map = new Map<string, any>()
            const missingSet = new Set(ids)
            const qc = get(queryClientAtom)

            // 1. Check query cache for any User objects
            qc.getQueryCache()
                .getAll()
                .forEach((q) => {
                    const data: any = q.state.data
                    if (!data) return
                    const add = (u: any) => {
                        if (u && u.id && ids.includes(String(u.id))) {
                            if (isCompleteUser(u)) {
                                map.set(String(u.id), u)
                                missingSet.delete(String(u.id))
                            }
                        }
                    }
                    if (Array.isArray(data)) {
                        data.forEach((d) => {
                            // direct user objects
                            add(d)
                            // workspace entry shape {user: {...}}
                            if (d?.user) add(d.user)
                        })
                    } else if (typeof data === "object") {
                        add(data)
                        if (data?.user) add(data.user)
                        if (Array.isArray(data?.users)) data.users.forEach(add)
                    }
                })

            // 2. Determine which ids are still missing after cache scan or incomplete profiles
            const missing = Array.from(missingSet)

            // 3. Fetch remaining or incomplete profiles in batch
            if (missing.length) {
                const fetched = await Promise.all(
                    missing.map((id) => fetchSingleProfile(id, true).catch(() => null)),
                )
                fetched.forEach((p) => p && map.set(String(p.id), p))
            }
            return map
        },
    }
})

// -------- Derived: enhanced variants ---------------------------------------

// Loadable wrapper exposing {state, data, error}
export const enhancedVariantsLoadableAtom = loadable(variantsAtom)

// -------- Composite loading state atoms -------------------------------------
// Variants query loading state
export const variantsLoadingAtom = selectAtom(
    variantsQueryAtom,
    (res) => ((res as any)?.status ?? "loading") !== "success",
)

// True while any revision query is not yet successful
// Map of variantId -> whether its revisions query has fetched at least once
export const revisionsFetchedMapAtom = atom((get) => {
    const list = get(variantsAtom) as any[]
    const map: Record<string, boolean> = {}
    list.forEach((v) => {
        const q = get(variantRevisionsQueryFamily((v as any).variantId)) as any
        const fetched =
            Boolean(q?.isSuccess) || (typeof q?.dataUpdatedAt === "number" && q.dataUpdatedAt > 0)
        map[(v as any).variantId] = fetched
    })
    return map
})

export const revisionsPendingAtom = atom((get) => {
    const list = get(variantsAtom) as any[]
    if (!list || list.length === 0) return true
    return list.some((v) => {
        const q = get(variantRevisionsQueryFamily((v as any).variantId)) as any
        const isSuccess = Boolean(q?.isSuccess) || (q?.status ?? "loading") === "success"
        const fetchedOnce =
            isSuccess || (typeof q?.dataUpdatedAt === "number" && q.dataUpdatedAt > 0)
        return !fetchedOnce || q?.fetchStatus === "fetching"
    })
})

// True while any spec/schema for a variant is not yet available
export const specsPendingAtom = atom((get) => {
    // In the new structure, OpenAPI spec is fetched once per app via appUriStateQueryAtom/appSchemaAtom
    // Consider specs pending until the unified app schema is available
    const schema = get(appSchemaAtom)
    return !schema
})

// Aggregate loading state across variants, revisions, specs, and enhancement readiness
export const allVariantsLoadingAtom = atom((get) => {
    const isVariantsLoading = get(variantsLoadingAtom)
    const isRevisionsPending = get(revisionsPendingAtom)
    const isSpecsPending = get(specsPendingAtom)
    // Keep "enhanced" readiness simple in current structure: ensure base variants are loaded
    // enhancedVariantsLoadableAtom wraps variantsAtom; if variants aren't ready, it's pending
    const isEnhancedPending = get(enhancedVariantsLoadableAtom).state !== "hasData"

    return isVariantsLoading || isRevisionsPending || isSpecsPending || isEnhancedPending
})

// -------- Deployment Revisions with Variant Mapping ----------------------

// Optimized: per-environment deployed variant selector (proper atomFamily)
export const deployedVariantByEnvironmentAtomFamily = atomFamily((envName: string) =>
    atom<EnhancedVariant | null>((get) => {
        const environments = get(environmentsAtom)
        const targetEnv = environments.find((e: any) => e.name === envName)
        if (!targetEnv) return null

        const enhancedVariants = get(variantsAtom)
        const targetRevisionId = targetEnv.deployedAppVariantRevisionId
        // Find the first variant whose revisions include the deployed revision
        for (const variant of enhancedVariants) {
            const revisions = get(revisionsByVariantIdAtomFamily(variant.variantId))
            if (
                Array.isArray(revisions) &&
                revisions.some((revision) => revision.id === targetRevisionId)
            ) {
                return variant
            }
        }
        return null
    }),
)

export const deployedRevisionByEnvironmentAtomFamily = atomFamily((envName: string) =>
    atom<EnhancedVariant | null>((get) => {
        const environments = get(environmentsAtom)
        const targetEnv = environments.find((e: any) => e.name === envName)
        if (!targetEnv) return null

        const targetRevisionId = targetEnv.deployedAppVariantRevisionId
        const revision = get(enhancedRevisionByIdAtomFamily(targetRevisionId))

        return revision
    }),
)

// -------- Derived: per-revision deployment info (no mutation) --------------
export const revisionDeploymentAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const envs = get(environmentsAtom) as any[]
        const camel = envs.map((env: any) =>
            Object.fromEntries(Object.entries(env).map(([k, v]) => [snakeToCamel(k), v])),
        ) as any[]
        return findRevisionDeployment(revisionId, camel)
    }),
)

// Re-export app status atoms for centralized access
export {appStatusAtom, currentVariantAppStatusAtom, variantAppStatusAtomFamily} from "./appStatus"
