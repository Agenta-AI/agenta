import {useEffect} from "react"

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
    onSuccess?: (data: Environment[]) => void
}

const DEFAULT_ENVIRONMENTS: Environment[] = []

export const environmentsAtom = selectAtom(
    _environmentsAtom,
    (envs) => envs ?? DEFAULT_ENVIRONMENTS,
    deepEqual,
)

export const useEnvironments = (options: UseEnvironmentOptions = {}) => {
    const {onSuccess} = options
    // atom selectors already scope to current app / project, so we can ignore appId here
    const environments = useAtomValue(environmentsAtom)
    const loadable = useAtomValue(environmentsLoadableAtom)

    const isEnvironmentsLoading = Boolean(
        loadable.isPending || loadable.isLoading || loadable.isFetching,
    )
    const isEnvironmentsLoadingError = loadable.isError ? loadable.error : null

    useEffect(() => {
        if (!isEnvironmentsLoading && !isEnvironmentsLoadingError) {
            onSuccess?.(environments)
        }
    }, [environments, isEnvironmentsLoading, isEnvironmentsLoadingError, onSuccess])

    return {
        environments,
        isEnvironmentsLoading,
        isEnvironmentsLoadingError,
        mutate: loadable.refetch,
    }
}
