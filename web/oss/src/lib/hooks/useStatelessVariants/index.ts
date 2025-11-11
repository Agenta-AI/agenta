// @ts-nocheck
import {useCallback, useMemo} from "react"

import Router from "next/router"
import useSWR, {useSWRConfig, type Middleware} from "swr"

import {getAppValues, useAppsData} from "@/oss/contexts/app.context"
import {DEFAULT_UUID, getCurrentProject} from "@/oss/contexts/project.context"
import {Variant} from "@/oss/lib/Types"

import appSchemaMiddleware from "./middlewares/appSchema"
import type {
    PlaygroundStateData,
    UsePlaygroundStateOptions,
    UsePlaygroundReturn,
    VariantSelector,
} from "./types"

const getKey = (
    appId: string | undefined = getAppValues().currentApp?.app_id,
    projectId: string = getCurrentProject().projectId,
) => {
    return !!appId && !!projectId && projectId !== DEFAULT_UUID
        ? `/api/apps/${appId}/variants?project_id=${projectId}&v=2`
        : null
}

export const useGlobalVariantsRefetch = () => {
    const {mutate} = useSWRConfig()
    const key = useMemo(() => getKey(), [])
    const refetchVariants = useCallback(async () => {
        await mutate(key)
    }, [])
    return refetchVariants
}

const useStatelessVariants = <Selected = unknown>(
    {
        appId = (Router.query.app_id as string) || "",
        projectId = getCurrentProject().projectId,
        ...rest
    }: Omit<UsePlaygroundStateOptions, "stateSelector" | "variantSelector"> & {
        stateSelector?: (state: PlaygroundStateData) => Selected
        variantSelector?: VariantSelector<Selected>
    } = {
        appId: (Router.query.app_id as string) || "",
        projectId: getCurrentProject().projectId,
    },
    variants: Variant[],
) => {
    const {apps} = useAppsData()
    const currentApp = apps.find((app) => app.app_id === appId)
    /**
     * Key for the SWR cache
     */
    const key = useMemo(() => getKey(appId, projectId), [appId, projectId])

    const middlewares = useMemo(() => {
        return [appSchemaMiddleware as Middleware]
    }, [])

    const swr = useSWR<
        PlaygroundStateData,
        Error,
        UsePlaygroundStateOptions<PlaygroundStateData, Selected>
    >(key, {
        use: middlewares,
        projectId,
        appId,
        compare: undefined,
        initialVariants: variants,
        appType: currentApp?.app_type,
        ...rest,
    })

    return swr as UsePlaygroundReturn<Selected>
}

export default useStatelessVariants
