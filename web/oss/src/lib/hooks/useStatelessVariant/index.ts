// @ts-nocheck
import {useMemo} from "react"

import Router from "next/router"
import useSWR, {type Middleware} from "swr"

import {useAppsData} from "@/oss/contexts/app.context"
import {getCurrentProject} from "@/oss/contexts/project.context"
import {Variant} from "@/oss/lib/Types"

import appSchemaMiddleware from "./middlewares/appSchemaMiddleware"
import type {
    PlaygroundStateData,
    UsePlaygroundStateOptions,
    UsePlaygroundReturn,
    VariantSelector,
} from "./types"

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
    const key = useMemo(
        () => `/api/apps/${appId}/variants?project_id=${projectId}&v=2`,
        [appId, projectId],
    )

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
