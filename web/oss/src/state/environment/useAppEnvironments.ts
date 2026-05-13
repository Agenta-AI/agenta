import {useEffect} from "react"

import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import {
    appEnvironmentsAtom as _appEnvironmentsAtom,
    appEnvironmentsLoadableAtom,
} from "./appEnvironmentAtoms"

interface UseAppEnvironmentOptions {
    appId?: string
    onSuccess?: (data: AppEnvironmentDeployment[]) => void
}

const DEFAULT_ENVIRONMENTS: AppEnvironmentDeployment[] = []

const environmentsSafeAtom = selectAtom(
    _appEnvironmentsAtom,
    (envs) => envs ?? DEFAULT_ENVIRONMENTS,
    deepEqual,
)

export const useAppEnvironments = (options: UseAppEnvironmentOptions = {}) => {
    const {onSuccess} = options
    const environments = useAtomValue(environmentsSafeAtom)
    const loadable = useAtomValue(appEnvironmentsLoadableAtom)

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
