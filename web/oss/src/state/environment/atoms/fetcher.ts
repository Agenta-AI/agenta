import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom, unwrap} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithQuery} from "jotai-tanstack-query"

import {snakeToCamel} from "@/oss/lib/helpers/utils"
import {Environment} from "@/oss/lib/Types"
import {fetchEnvironments} from "@/oss/services/deployment/api"
import {routerAppIdAtom, currentAppAtom} from "@/oss/state/app/selectors/app"
import {projectIdAtom} from "@/oss/state/project/selectors/project"
import {jwtReadyAtom} from "@/oss/state/session/jwt"
import {devLog} from "@/oss/state/utils/devLog"

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
            const data = await fetchEnvironments(appId)
            const camel = (data ?? []).map((env: any) =>
                Object.fromEntries(Object.entries(env).map(([k, v]) => [snakeToCamel(k), v])),
            ) as Environment[]
            return camel
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

export const environmentsAtom = selectAtom(
    unwrap(environmentsQueryAtom),
    (res) => (res as any)?.data ?? EmptyEnvs,
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
