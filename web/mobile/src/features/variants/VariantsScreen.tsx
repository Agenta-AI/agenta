import {useMemo} from "react"

import {appWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {Skeleton, Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/ui/ui"
import {CloudArrowUp, Lightning} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {PageNotFound} from "@/components/PageNotFound"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {AppOverviewLink} from "../app-overview/AppOverviewLink"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {DeveloperAppPicker} from "../developer/DeveloperAppPicker"
import {useUrlParams} from "../developer/useUrlParams"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {DeploymentsTab} from "./DeploymentsTab"
import {PickAppState} from "./states/PickAppState"
import {VariantsTab} from "./VariantsTab"

const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

type TabId = "variants" | "deployments"

/**
 * The variants of one app and where each is deployed. The app is a query parameter, so the
 * nav link needs no id; the tab and the open revision live in the URL too.
 */
export const VariantsScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const {read, write} = useUrlParams()
    const queryClient = useQueryClient()
    const apps = useAtomValue(appWorkflowsListQueryStateAtom)
    const appId = read("app")
    const tab: TabId = read("tab") === "deployments" ? "deployments" : "variants"
    const app = useMemo(
        () => apps.data.find((entry) => entry.id === appId) ?? null,
        [apps.data, appId],
    )

    const body = (() => {
        if (apps.isError) {
            return (
                <LoadError
                    framed
                    title="Could not load apps"
                    onRetry={() => void queryClient.invalidateQueries({queryKey: ["workflows"]})}
                />
            )
        }
        if (!appId) return <PickAppState />
        if (apps.isPending) return <Skeleton className="h-64 w-full" />
        if (!app) return <PageNotFound />
        return (
            <Tabs value={tab} onValueChange={(next) => write({tab: next, revisionId: null})}>
                <TabsList>
                    <TabsTrigger value="variants">
                        <Lightning aria-hidden size={14} />
                        Variants
                    </TabsTrigger>
                    <TabsTrigger value="deployments">
                        <CloudArrowUp aria-hidden size={14} />
                        Deployments
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="variants" className="pt-3">
                    <VariantsTab
                        key={app.id}
                        base={`/w/${workspaceId}/p/${projectId}`}
                        projectId={projectId}
                        app={app}
                    />
                </TabsContent>
                <TabsContent value="deployments" className="pt-3">
                    <DeploymentsTab
                        key={app.id}
                        projectId={projectId}
                        app={app}
                        base={`/w/${workspaceId}/p/${projectId}`}
                    />
                </TabsContent>
            </Tabs>
        )
    })()

    return (
        <>
            <PageTitle title="Registry" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px]">
                                    Registry
                                </h1>
                                <AppOverviewLink
                                    base={`/w/${workspaceId}/p/${projectId}`}
                                    appId={app?.id ?? null}
                                />
                                <DeveloperAppPicker
                                    apps={apps.data}
                                    value={appId}
                                    loading={apps.isPending}
                                    onChange={(next) =>
                                        write({app: next, revisionId: null, env: null})
                                    }
                                />
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>{body}</div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
