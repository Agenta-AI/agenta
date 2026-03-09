import {
    environmentsListQueryAtomFamily,
    type Environment as EntityEnvironment,
} from "@agenta/entities/environment"
import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom} from "jotai/utils"
import {eagerAtom} from "jotai-eager"

import {Environment} from "@/oss/lib/Types"
import {routerAppIdAtom, currentAppAtom} from "@/oss/state/app/selectors/app"

interface EnvironmentReference {
    application?: {id?: string; slug?: string}
    application_variant?: {id?: string; slug?: string}
    application_revision?: {id?: string; slug?: string; version?: string}
}

function getEnvironmentReferenceForApp(
    env: EntityEnvironment,
    appId: string,
): EnvironmentReference | null {
    const refs = env.data?.references
    if (!refs) return null

    for (const reference of Object.values(refs) as EnvironmentReference[]) {
        if (reference?.application?.id === appId) {
            return reference
        }
    }

    return null
}

function stripAppPrefix(
    variantSlug: string | undefined | null,
    appSlug: string | undefined | null,
) {
    if (!variantSlug) return variantSlug ?? null
    if (appSlug && variantSlug.startsWith(`${appSlug}.`)) {
        return variantSlug.slice(appSlug.length + 1)
    }
    return variantSlug
}

function toLegacyEnvironment(env: EntityEnvironment, appId: string): Environment {
    const reference = getEnvironmentReferenceForApp(env, appId)
    const appSlug = reference?.application?.slug
    return {
        name: env.name ?? env.slug ?? "",
        app_id: appId,
        deployed_app_variant_id: reference?.application_variant?.id ?? null,
        deployed_variant_name: stripAppPrefix(reference?.application_variant?.slug, appSlug),
        deployed_app_variant_revision_id: reference?.application_revision?.id ?? null,
        revision: reference?.application_revision?.version ?? null,
        updated_at: env.updated_at ?? env.created_at ?? null,
    }
}

// -------- Derived from entity system query ----------------------------------
// Reads from the entity system's environmentsListQueryAtomFamily(false)
// instead of making a separate fetch, eliminating the duplicate API call.

export const environmentsQueryAtom = atom((get) => {
    const listQuery = get(environmentsListQueryAtomFamily(false))
    const appIdFromRoute = get(routerAppIdAtom)
    const currentApp = get(currentAppAtom)
    const appId = appIdFromRoute || currentApp?.app_id || null

    const environments = listQuery.data?.environments ?? []
    const data = appId
        ? environments.map((env) => toLegacyEnvironment(env, appId))
        : ([] as Environment[])

    return {
        data,
        isPending: listQuery.isPending,
        isLoading: listQuery.isPending,
        isFetching: listQuery.isFetching,
        isError: listQuery.isError,
        error: listQuery.error ?? null,
        refetch: listQuery.refetch,
    }
})

// -------- Derived atoms -----------------------------------------------------

const EmptyEnvs: Environment[] = []

/** Canonical display order for environments */
const ENV_ORDER: Record<string, number> = {
    development: 0,
    staging: 1,
    production: 2,
}

export const environmentsAtom = selectAtom(
    environmentsQueryAtom,
    (res) => {
        const envs: Environment[] = res?.data ?? EmptyEnvs
        if (envs.length <= 1) return envs
        return [...envs].sort(
            (a, b) =>
                (ENV_ORDER[a.name.toLowerCase()] ?? 99) - (ENV_ORDER[b.name.toLowerCase()] ?? 99),
        )
    },
    deepEqual,
)

export const environmentsLoadableAtom = atom((get) => get(environmentsQueryAtom))

// Quick lookup map: env name -> environment object
export const environmentMapAtom = eagerAtom<Record<string, Environment>>((get) => {
    const envs = get(environmentsAtom) as Environment[]
    const map: Record<string, Environment> = {}
    envs.forEach((e) => {
        map[e.name] = e
    })
    return map
})

// Utility refetch atom (mount once to keep environments fresh when variants ready)
export const environmentsPrefetchAtom = atom((get) => {
    const loadable = get(environmentsLoadableAtom)
    return loadable
})
