import {useMemo, useRef} from "react"

import Router, {useRouter} from "next/router"
import useSWR, {type Middleware} from "swr"
import {getCurrentProject} from "@/contexts/project.context"

import isVariantDirtyMiddleware from "./middlewares/isVariantDirtyMiddleware"
import appSchemaMiddleware from "./middlewares/appSchemaMiddleware"
import playgroundVariantsMiddleware from "./middlewares/playgroundVariantsMiddleware"
import playgroundVariantMiddleware from "./middlewares/playgroundVariantMiddleware"
import selectorMiddleware from "./middlewares/selectorMiddleware"
import playgroundUIMiddleware from "./middlewares/playgroundUIMiddleware"

import type {
    PlaygroundStateData,
    UsePlaygroundStateOptions,
    UsePlaygroundReturn,
    VariantSelector,
} from "./types"

const usePlayground = <Selected = unknown>(
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
) => {
    /**
     * Key for the SWR cache
     */
    const router = useRouter()
    const pathRef = useRef(router.pathname.replaceAll("/", "_"))
    const key = useMemo(
        () => `/api/apps/${appId}/variants?project_id=${projectId}&v=2&path=${pathRef.current}`,
        [appId, projectId],
    )

    const middlewares = useMemo(() => {
        return [
            playgroundUIMiddleware as Middleware,
            playgroundVariantsMiddleware as Middleware,
            playgroundVariantMiddleware as Middleware,
            appSchemaMiddleware as Middleware,
            isVariantDirtyMiddleware as Middleware,
            selectorMiddleware as Middleware,
        ]
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
        ...rest,
    })

    return swr as UsePlaygroundReturn<Selected>
}

export default usePlayground
