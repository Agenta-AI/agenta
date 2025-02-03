import {useMemo} from "react"

import Router from "next/router"
import useSWR, {type Middleware} from "swr"
import {getCurrentProject} from "@/contexts/project.context"

import appSchemaMiddleware from "./middlewares/appSchemaMiddleware"

import type {
    PlaygroundStateData,
    UsePlaygroundStateOptions,
    UsePlaygroundReturn,
    VariantSelector,
} from "./types"
import {Variant} from "@/lib/Types"

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
        ...rest,
    })

    return swr as UsePlaygroundReturn<Selected>
}

export default useStatelessVariants
