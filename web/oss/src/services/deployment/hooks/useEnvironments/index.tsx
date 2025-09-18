import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import type {Environment} from "@/oss/lib/Types"
import {
    environmentsAtom as _environmentsAtom,
    environmentsLoadableAtom,
} from "@/oss/state/environment/atoms/fetcher"

interface UseEnvironmentOptions {
    // kept for backward-compatibility, currently unused
    appId?: string
}

const DEFAULT_ENVIRONMENTS: Environment[] = []

export const environmentsAtom = selectAtom(
    _environmentsAtom,
    (envs) => envs ?? DEFAULT_ENVIRONMENTS,
    deepEqual,
)

export const useEnvironments = ({}: UseEnvironmentOptions = {}) => {
    // atom selectors already scope to current app / project, so we can ignore appId here
    const environments = useAtomValue(environmentsAtom)
    const loadable = useAtomValue(environmentsLoadableAtom) as any

    return {
        environments,
        isEnvironmentsLoading: loadable.isLoading ?? loadable.isFetching,
        isEnvironmentsLoadingError: loadable.isError ?? loadable.error,
        mutate: loadable.refetch,
    }
}
