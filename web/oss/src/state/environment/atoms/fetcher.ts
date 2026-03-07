import {
    fetchEnvironmentsList,
    type Environment as EntityEnvironment,
} from "@agenta/entities/environment"
import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom, unwrap} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithQuery} from "jotai-tanstack-query"

import {Environment} from "@/oss/lib/Types"
import {routerAppIdAtom, currentAppAtom} from "@/oss/state/app/selectors/app"
import {projectIdAtom} from "@/oss/state/project/selectors/project"
import {jwtReadyAtom} from "@/oss/state/session/jwt"
import {devLog} from "@/oss/state/utils/devLog"

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

function toLegacyEnvironment(env: EntityEnvironment, appId: string): Environment {
    const reference = getEnvironmentReferenceForApp(env, appId)
    return {
        name: env.name ?? env.slug ?? "",
        app_id: appId,
        deployed_app_variant_id: reference?.application_variant?.id ?? null,
        deployed_variant_name: reference?.application_variant?.slug ?? null,
        deployed_app_variant_revision_id: reference?.application_revision?.id ?? null,
        revision: reference?.application_revision?.version ?? null,
    }
}

// -------- Query atom --------------------------------------------------------

export const environmentsQueryAtom = atomWithQuery<Environment[]>((get) => {
    const appIdFromRoute = get(routerAppIdAtom)
    const currentApp = get(currentAppAtom)
    const appId = appIdFromRoute || currentApp?.app_id || null

    const projectId = get(projectIdAtom)
    const jwtReady = get(jwtReadyAtom).data ?? false

    const enabled = !!appId && !!projectId && jwtReady

    return {
        queryKey: ["environments", appId, projectId],
        queryFn: async () => {
            if (!appId) return []
            if (!projectId) return []
            const data = await fetchEnvironmentsList({projectId})
            return (data.environments ?? []).map((env) => toLegacyEnvironment(env, appId))
        },
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        enabled,
    }
})

const logEnv = process.env.NEXT_PUBLIC_LOG_ENV_ATOMS === "true"

devLog(environmentsQueryAtom as any, "environmentsQueryAtom", logEnv)

// -------- Derived atoms -----------------------------------------------------

const EmptyEnvs: Environment[] = []

/** Canonical display order for environments */
const ENV_ORDER: Record<string, number> = {
    development: 0,
    staging: 1,
    production: 2,
}

export const environmentsAtom = selectAtom(
    unwrap(environmentsQueryAtom),
    (res) => {
        const envs: Environment[] = (res as any)?.data ?? EmptyEnvs
        if (envs.length <= 1) return envs
        return [...envs].sort(
            (a, b) => (ENV_ORDER[a.name.toLowerCase()] ?? 99) - (ENV_ORDER[b.name.toLowerCase()] ?? 99),
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
