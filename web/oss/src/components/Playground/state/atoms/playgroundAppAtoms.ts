/**
 * App-Scoped Playground Atoms
 *
 * Wraps per-revision entity atoms into app-scoped selectors
 * for consumers that need "the app's schema/route/status".
 *
 * Anchor: playgroundLatestRevisionIdAtom (first server revision).
 * This works because URI/schema are app-scoped per the backend design,
 * even though the API requires a variant to fetch them.
 */
import {
    revisionOpenApiSchemaAtomFamily,
    revisionAgConfigSchemaAtomFamily,
    legacyAppRevisionSchemaQueryAtomFamily,
    legacyAppRevisionEntityWithBridgeAtomFamily,
    runnableAtoms,
} from "@agenta/entities/legacyAppRevision"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {snakeToCamel} from "@/oss/lib/helpers/utils"
import {findRevisionDeployment} from "@/oss/lib/shared/variant/utils"
import {appsQueryAtom, routerAppIdAtom, recentAppIdAtom} from "@/oss/state/app/atoms/fetcher"
import {environmentsAtom} from "@/oss/state/environment/atoms/fetcher"

import {playgroundLatestRevisionIdAtom, playgroundRevisionListAtom} from "./variants"

// ============================================================================
// APP-SCOPED SCHEMA (anchored on first server revision)
// ============================================================================

/**
 * App-level OpenAPI schema derived from per-revision entity data.
 * Reads the first server revision's schema.
 */
export const playgroundAppSchemaAtom = atom((get) => {
    const revId = get(playgroundLatestRevisionIdAtom)
    if (!revId) return undefined
    return get(revisionOpenApiSchemaAtomFamily(revId))
})

/**
 * Whether the app uses ag_config (completion/chat apps).
 * Derived from the entity layer's pre-parsed schema, avoiding fragile
 * getRequestSchema path lookups with potentially empty routePath.
 *
 * Returns:
 * - `true` if ag_config schema exists
 * - `false` if schema loaded but no ag_config
 * - `undefined` if still loading
 */
export const playgroundHasAgConfigAtom = atom<boolean | undefined>((get) => {
    const revId = get(playgroundLatestRevisionIdAtom)
    if (!revId) return undefined
    const query = get(legacyAppRevisionSchemaQueryAtomFamily(revId))
    if (query.isPending) return undefined
    const agConfig = get(revisionAgConfigSchemaAtomFamily(revId))
    return agConfig != null
})

/**
 * App-level route path derived from per-revision entity data.
 */
export const playgroundAppRoutePathAtom = atom((get) => {
    const revId = get(playgroundLatestRevisionIdAtom)
    if (!revId) return ""
    const entity = get(legacyAppRevisionEntityWithBridgeAtomFamily(revId))
    return entity?.routePath || ""
})

/**
 * App-level URI info (runtimePrefix + routePath) derived from per-revision entity data.
 */
export const playgroundAppUriInfoAtom = atom((get) => {
    const revId = get(playgroundLatestRevisionIdAtom)
    if (!revId) return undefined
    const entity = get(legacyAppRevisionEntityWithBridgeAtomFamily(revId))
    if (!entity) return undefined
    return {
        runtimePrefix: entity.runtimePrefix || "",
        routePath: entity.routePath || undefined,
    }
})

// ============================================================================
// APP STATUS (anchored on first server revision's schema query)
// ============================================================================

/**
 * App-level status loading state.
 * True while the first server revision's schema query is pending,
 * or when no server revision exists yet.
 */
export const playgroundAppStatusLoadingAtom = atom((get) => {
    const revId = get(playgroundLatestRevisionIdAtom)
    if (!revId) return true
    const query = get(legacyAppRevisionSchemaQueryAtomFamily(revId))
    return query.isPending
})

/**
 * App-level reachability status.
 * True when the schema has been successfully fetched.
 */
export const playgroundAppStatusAtom = atom((get) => {
    const revId = get(playgroundLatestRevisionIdAtom)
    if (!revId) return false
    const query = get(legacyAppRevisionSchemaQueryAtomFamily(revId))
    return !query.isPending && !query.isError && query.data?.openApiSchema != null
})

// ============================================================================
// CHAT MODE (anchored on first server revision)
// ============================================================================

/**
 * App-level chat mode detection from entity-layer schema.
 * Uses isChatVariantAtomFamily which checks schema endpoints for messagesSchema.
 */
export const playgroundIsChatModeAtom = atom<boolean | undefined>((get) => {
    const revId = get(playgroundLatestRevisionIdAtom)
    if (!revId) return undefined
    return get(runnableAtoms.isChatVariant(revId))
})

// ============================================================================
// DEPLOYMENT (independent utility)
// ============================================================================

/**
 * Per-revision deployment info.
 * Reads environmentsAtom + findRevisionDeployment.
 */
export const playgroundRevisionDeploymentAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const envs = get(environmentsAtom)
        if (!Array.isArray(envs)) return null
        const camel = envs.map((env: any) =>
            Object.fromEntries(Object.entries(env).map(([k, v]) => [snakeToCamel(k), v])),
        ) as any[]
        return findRevisionDeployment(revisionId, camel)
    }),
)

/**
 * Deployed revision ID for a given environment name.
 * Reverse lookup: environment name → revision ID currently deployed there.
 */
export const deployedRevisionIdByEnvironmentAtomFamily = atomFamily((envName: string) =>
    atom<string | null>((get) => {
        const envs = get(environmentsAtom)
        if (!Array.isArray(envs)) return null
        const env = envs.find((e: any) => e.name === envName || e.environment_name === envName)
        return env?.deployed_app_variant_revision_id ?? env?.deployedAppVariantRevisionId ?? null
    }),
)

// ============================================================================
// LATEST APP REVISION
// ============================================================================

/**
 * Latest revision ID across the entire app, derived from the playground revision list.
 * Does not trigger `allRevisionsAtom` / `variantRevisionsQueryFamily`.
 *
 * Used to determine if a revision is the most recently modified in the app
 * (for "Last modified" tag in VariantDetailsWithStatus).
 */
export const playgroundLatestAppRevisionIdAtom = atom((get) => {
    const revisions = get(playgroundRevisionListAtom) || []
    // Skip local drafts, take the first server revision (list is sorted by updatedAtTimestamp desc)
    const serverRevision = revisions.find((r: any) => !r.isLocalDraft)
    return (serverRevision?.id as string) ?? null
})

// ============================================================================
// PLAYGROUND RENDER GUARD
// ============================================================================

/**
 * Determines if Playground should render for the current app.
 *
 * Relocated from state/app/selectors/app.ts.
 * Uses entity-layer bridge atoms for status checking.
 */
export const shouldRenderPlaygroundAtom = atom<boolean>((get) => {
    const appId = get(routerAppIdAtom) || get(recentAppIdAtom)
    const q: any = get(appsQueryAtom)
    const isPending = Boolean(q?.isPending)
    const data: any[] = (q?.data as any) ?? []
    const app = appId ? data.find((item: any) => item.app_id === appId) : null

    // If apps list hasn't loaded yet, allow render (components can handle skeletons)
    if (isPending) return true

    // Block entirely for invalid/legacy apps
    const isInvalid = app && (!app.app_type || String(app.app_type).includes(" (old)"))
    if (isInvalid) return false

    // If no app found, do not block rendering
    if (!app) return true

    // For non-custom apps, render regardless of status checks
    if (app.app_type !== "custom") return true

    // For custom apps, check entity-layer schema status to determine reachability
    const isLoading = get(playgroundAppStatusLoadingAtom)
    const isUp = get(playgroundAppStatusAtom)

    // Render while loading or if up; block only when definitively down
    if (isLoading) return true
    return Boolean(isUp)
})
