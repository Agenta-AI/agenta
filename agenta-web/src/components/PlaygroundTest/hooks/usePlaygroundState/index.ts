import {useMemo} from "react"

import useSWR, {Middleware} from "swr"
import Router from "next/router"
import {getCurrentProject} from "@/contexts/project.context"
import type {InitialStateType} from "../../state/types"
import type {UsePlaygroundStateOptions} from "../usePlaygroundState/types"

import isVariantDirtyMiddleware from "./middlewares/isVariantDirtyMiddleware"
import openApiJsonMiddleware from "./middlewares/openApiJsonMiddleware"

const usePlaygroundState = ({
    service = (Router.query.service as string) || "",
    appId = (Router.query.app_id as string) || "",
    projectId = getCurrentProject().projectId,
    selector = (state: InitialStateType) => state,
    hookId,
    use,
    neverFetch,
    ...rest
}: UsePlaygroundStateOptions = {}) => {
    /**
     * Key for the SWR cache
     */
    const key = useMemo(
        () => `/api/apps/${appId}/variants?project_id=${projectId}`,
        [appId, projectId],
    )

    const swr = useSWR<InitialStateType, Error, UsePlaygroundStateOptions>(key, {
        use: [
            isVariantDirtyMiddleware as Middleware,
            openApiJsonMiddleware as Middleware,
            ...(use || []),
        ],
        revalidateOnFocus: false,
        ...(neverFetch && {
            fetcher: undefined,
            revalidateOnMount: false,
            revalidateIfStale: false,
            revalidateOnFocus: false,
            revalidateOnReconnect: false,
            compare: () => true,
        }),
        ...rest,
        service,
    })

    return Object.assign({}, swr, {projectId, service, variants: swr.data?.variants || []})
}

export default usePlaygroundState
