import {useEffect} from "react"

import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
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
import {BindWorkspaceMembers} from "./BindWorkspaceMembers"
import {AppOverviewSkeleton} from "./states/AppOverviewSkeleton"
import {AppTitleSkeleton} from "./states/AppTitleSkeleton"
import {useOverviewApp} from "./useOverviewApp"

const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/**
 * The overview of one prompt or custom app: where it is deployed, its newest prompts, and its
 * newest evaluations. An agent id goes to the agent overview, and an id that is no app here
 * (unknown, archived, or an evaluator) is "not found".
 *
 * Each section loads and fails on its own. The usage charts are not part of this screen yet.
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
    // Beta developer mode matches /w: the menu sits right after the title, and authors show names.
    const beta = useAtomValue(betaDeveloperModeActiveAtom)
    const status = overview.status

    useEffect(() => {
        if (status === "agent") void router.replace(agentEntryHref(base, appId))
    }, [status, router, base, appId])

    if (status === "missing") return <PageNotFound />

    const app = overview.status === "app" ? overview.app : null
    const title = app ? app.name || app.slug || "Untitled" : null

    return (
        <>
            <PageTitle title="Overview" />
            {beta ? <BindWorkspaceMembers /> : null}
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
                                    <h1
                                        className={`m-0 min-w-0 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] ${beta ? "" : "flex-1"}`}
                                    >
                                        {title}
                                    </h1>
                                )}
                                {app ? (
                                    <AppActionsMenu projectId={projectId} app={app} base={base} />
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
                                <AppDeploymentSection app={app} base={base} />
                                <AppRecentPromptsSection
                                    projectId={projectId}
                                    app={app}
                                    base={base}
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
