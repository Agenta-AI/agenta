import {useEffect} from "react"

import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {PageNotFound} from "@/components/PageNotFound"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {agentEntryHref} from "../agents/agentEntry"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {AppActionsMenu} from "./AppActionsMenu"
import {AppDeploymentSection} from "./AppDeploymentSection"
import {AppEvaluationsSection} from "./AppEvaluationsSection"
import {AppRecentPromptsSection} from "./AppRecentPromptsSection"
import {AppOverviewSkeleton} from "./states/AppOverviewSkeleton"
import {AppTitleSkeleton} from "./states/AppTitleSkeleton"
import {AppUsageSkeleton} from "./states/AppUsageSkeleton"
import {useOverviewApp} from "./useOverviewApp"

// The charts download only in beta developer mode, after the overview itself.
const AppUsageSection = dynamic(() => import("./AppUsageSection").then((m) => m.AppUsageSection), {
    ssr: false,
    loading: () => <AppUsageSkeleton />,
})

const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/**
 * The overview of one prompt or custom app: where it is deployed, its newest prompts, and its
 * newest evaluations. An agent id goes to the agent overview, and an id that is no app here
 * (unknown or archived) is "not found". In beta developer mode an evaluator id shows the same
 * overview without Deployment, as in the old app; outside it an evaluator is "not found".
 *
 * Each section loads and fails on its own. The usage charts show only in beta developer mode.
 */
export const AppOverviewScreen = ({
    workspaceId,
    projectId,
    appId,
}: {
    workspaceId: string
    projectId: string
    appId: string
}) => {
    useBindProjectContext(projectId)
    const router = useRouter()
    const queryClient = useQueryClient()
    const base = `/w/${workspaceId}/p/${projectId}`
    const overview = useOverviewApp(appId)
    const showUsage = useAtomValue(betaDeveloperModeActiveAtom)
    const status = overview.status

    useEffect(() => {
        if (status === "agent") void router.replace(agentEntryHref(base, appId))
    }, [status, router, base, appId])

    if (status === "missing") return <PageNotFound />

    const evaluator = overview.status === "evaluator"
    const app = overview.status === "app" || overview.status === "evaluator" ? overview.app : null
    const title = app ? app.name || app.slug || "Untitled" : null

    return (
        <>
            <PageTitle title="Overview" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                {title === null ? (
                                    <div className="flex-1">
                                        <AppTitleSkeleton />
                                    </div>
                                ) : (
                                    <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px]">
                                        {title}
                                    </h1>
                                )}
                                {app ? (
                                    <AppActionsMenu
                                        projectId={projectId}
                                        app={app}
                                        base={base}
                                        evaluator={evaluator}
                                    />
                                ) : null}
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        {status === "error" ? (
                            <LoadError
                                framed
                                title="Could not load apps"
                                onRetry={() =>
                                    void queryClient.invalidateQueries({queryKey: ["workflows"]})
                                }
                            />
                        ) : app ? (
                            <div className="flex flex-col gap-8">
                                {showUsage ? <AppUsageSection appId={app.id} /> : null}
                                {evaluator ? null : <AppDeploymentSection app={app} base={base} />}
                                <AppRecentPromptsSection
                                    projectId={projectId}
                                    app={app}
                                    base={base}
                                    evaluator={evaluator}
                                />
                                <AppEvaluationsSection
                                    projectId={projectId}
                                    appId={app.id}
                                    base={base}
                                    kind="auto"
                                />
                                <AppEvaluationsSection
                                    projectId={projectId}
                                    appId={app.id}
                                    base={base}
                                    kind="human"
                                />
                            </div>
                        ) : (
                            <AppOverviewSkeleton />
                        )}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
