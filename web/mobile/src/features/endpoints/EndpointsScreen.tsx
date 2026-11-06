import {useCallback, useMemo} from "react"

import {
    appWorkflowsListQueryStateAtom,
    workflowVariantsListQueryStateAtomFamily,
} from "@agenta/entities/workflow"
import {PlugsIcon} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageNotFound} from "@/components/PageNotFound"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {AppOverviewLink} from "../app-overview/AppOverviewLink"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {useDeveloperPageFrame} from "../developer/developerPageFrame"
import {useRouteAppId} from "../developer/useRouteAppId"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {EndpointsView, type EndpointsViewState} from "./EndpointsView"
import {useEndpointEnvironments} from "./useEndpointEnvironments"
import {useEndpointSnippets} from "./useEndpointSnippets"

/** The page column, shared with the other list pages, so the nav entries line up. */
/**
 * How to call an app and fetch its config, per environment. The app comes from `?app=`: the
 * rail link has no params, so the page offers a picker and writes the choice back to the address.
 */
export const EndpointsScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const PAGE_FRAME = useDeveloperPageFrame()
    useBindProjectContext(projectId)
    const router = useRouter()
    const queryClient = useQueryClient()
    const route = useRouteAppId()
    const appId = route.appId ?? ""

    const apps = useAtomValue(appWorkflowsListQueryStateAtom)
    const variants = useAtomValue(
        useMemo(() => workflowVariantsListQueryStateAtomFamily(appId), [appId]),
    )
    const environments = useEndpointEnvironments(appId)

    const appList = useMemo(
        () =>
            (apps.data ?? []).map((workflow) => ({
                id: workflow.id,
                name: workflow.name || workflow.slug || "Untitled app",
                slug: workflow.slug ?? null,
            })),
        [apps.data],
    )
    const app = appList.find((item) => item.id === appId) ?? null
    const snippets = useEndpointSnippets(app?.slug ?? null, environments.selected)

    const {refetch: refetchEnvironments} = environments
    const retry = useCallback(() => {
        void queryClient.invalidateQueries({queryKey: ["workflows"]})
        void refetchEnvironments()
    }, [queryClient, refetchEnvironments])

    const pickApp = useCallback(
        (id: string) =>
            void router.replace(
                {pathname: router.pathname, query: {...router.query, app: id}},
                undefined,
                {shallow: true},
            ),
        [router],
    )

    const notFound = !apps.isPending && !apps.isError && appId !== "" && app === null

    let state: EndpointsViewState
    if (apps.isError || (appId && (variants.isError || environments.isError || snippets.isError)))
        state = "error"
    else if (
        apps.isPending ||
        (appId && (variants.isPending || environments.isPending || snippets.isPending))
    )
        state = "loading"
    else if (!appId) state = "pickApp"
    else if ((variants.data ?? []).length === 0 || environments.environments.length === 0)
        state = "noVariants"
    else state = "ready"

    return (
        <>
            <PageTitle title="API endpoint" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 flex min-w-0 flex-1 items-center gap-2 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    <PlugsIcon aria-hidden className="shrink-0" />
                                    API endpoint
                                </h1>
                                {route.fromPath ? null : (
                                    <AppOverviewLink
                                        base={`/w/${workspaceId}/p/${projectId}`}
                                        appId={app?.id ?? null}
                                    />
                                )}
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        {notFound ? (
                            <PageNotFound />
                        ) : (
                            <EndpointsView
                                state={state}
                                apps={appList}
                                appId={app?.id ?? null}
                                onPickApp={route.fromPath ? undefined : pickApp}
                                onRetry={retry}
                                environments={environments.environments}
                                selected={environments.selected}
                                onSelectEnvironment={environments.select}
                                invoke={snippets.invoke}
                                fetchConfig={snippets.fetchConfig}
                            />
                        )}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
