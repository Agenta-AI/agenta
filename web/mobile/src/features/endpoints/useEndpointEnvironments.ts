import {useState} from "react"

import {
    appEnvironmentsLoadableAtomFamily,
    type AppEnvironmentDeployment,
} from "@agenta/entities/environment"
import {useAtomValue} from "jotai"

const DEFAULT_ENVIRONMENT = "production"

/** The environment to show before the user picks one: production, else the first that exists. */
const defaultEnvironment = (
    environments: readonly AppEnvironmentDeployment[],
): AppEnvironmentDeployment | null =>
    environments.find((env) => env.name === DEFAULT_ENVIRONMENT) ?? environments[0] ?? null

/**
 * The environments of one app for the Endpoints page, and the one on show. The user's pick is
 * kept per app, so a refetch never resets it and a new app starts from its own default.
 */
export const useEndpointEnvironments = (appId: string) => {
    const query = useAtomValue(appEnvironmentsLoadableAtomFamily(appId))
    const [pick, setPick] = useState<{appId: string; slug: string} | null>(null)

    const available = query.data ?? []
    // The package returns development first; the page lists production first.
    const environments = [...available].reverse()

    const picked =
        pick?.appId === appId ? available.find((env) => env.slug === pick.slug) : undefined
    const selected = picked ?? defaultEnvironment(available)

    const select = (slug: string) => {
        const target = available.find((env) => env.slug === slug)
        if (target?.deployedVariantId) setPick({appId, slug})
    }

    return {
        environments,
        selected,
        select,
        isPending: Boolean(query.isPending),
        isError: Boolean(query.isError),
        refetch: query.refetch,
    }
}
