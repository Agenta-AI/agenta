import {useMemo} from "react"
import useSWR, {type Middleware} from "swr"
import Router from "next/router"
import {getCurrentProject} from "@/contexts/project.context"

import {
    PlaygroundStateData,
    UsePlaygroundStateOptions,
    UsePlaygroundReturn,
    InferSelectedData,
} from "./types"

import isVariantDirtyMiddleware from "./middlewares/isVariantDirtyMiddleware"
import appSchemaMiddleware from "./middlewares/appSchemaMiddleware"
import playgroundVariantsMiddleware from "./middlewares/playgroundVariantsMiddleware"
import playgroundVariantMiddleware from "./middlewares/playgroundVariantMiddleware"
import selectorMiddleware from "./middlewares/selectorMiddleware"
import {StateVariant} from "../../state/types"

const usePlayground = <Selected>(
    {
        service = (Router.query.service as string) || "",
        appId = (Router.query.app_id as string) || "",
        projectId = getCurrentProject().projectId,
        ...rest
    }: Omit<UsePlaygroundStateOptions, "stateSelector" | "variantSelector"> & {
        stateSelector?: (state: PlaygroundStateData) => Selected
        variantSelector?: (variant: StateVariant) => Selected
    } = {
        service: (Router.query.service as string) || "",
        appId: (Router.query.app_id as string) || "",
        projectId: getCurrentProject().projectId,
        hookId: "",
        debug: false,
    },
): Omit<UsePlaygroundReturn, "selectedData"> & InferSelectedData<typeof rest> => {
    /**
     * Key for the SWR cache
     */
    const key = useMemo(
        () => `/api/apps/${appId}/variants?project_id=${projectId}&v=2`,
        [appId, projectId],
    )

    const middlewares = useMemo(() => {
        return [
            playgroundVariantsMiddleware as Middleware,
            playgroundVariantMiddleware as Middleware,
            appSchemaMiddleware as Middleware,
            isVariantDirtyMiddleware as Middleware,
            selectorMiddleware as Middleware,
        ]
    }, [])

    const swr = useSWR<PlaygroundStateData, Error, UsePlaygroundStateOptions>(key, {
        use: middlewares,
        service,
        projectId,
        compare: undefined,
        ...rest,
    }) as UsePlaygroundReturn

    return swr as Omit<UsePlaygroundReturn, "selectedData"> & InferSelectedData<typeof rest>
}

export default usePlayground
