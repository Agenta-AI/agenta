import {environmentsListQueryAtomFamily} from "@agenta/entities/environment"
import {useQueries} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {appDeploymentHistoryQuery} from "./useAppDeploymentHistory"

export interface LastDeployedTarget {
    projectId: string
    appId: string
    appSlug: string | null
}

/** When each environment last deployed this app, by environment slug. */
export const useLastDeployedAt = (target: LastDeployedTarget | null): Map<string, string> => {
    const list = useAtomValue(environmentsListQueryAtomFamily(false))
    const environments = target ? (list.data?.environments ?? []) : []
    const results = useQueries({
        queries: environments.map((environment) =>
            appDeploymentHistoryQuery({
                projectId: target?.projectId ?? "",
                appId: target?.appId ?? "",
                appSlug: target?.appSlug ?? null,
                environmentId: environment.id,
            }),
        ),
    })
    const dates = new Map<string, string>()
    environments.forEach((environment, index) => {
        const newest = results[index]?.data?.[0]?.createdAt
        if (environment.slug && newest) dates.set(environment.slug, newest)
    })
    return dates
}
