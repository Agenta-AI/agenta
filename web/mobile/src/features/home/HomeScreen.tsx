import {useMemo} from "react"

import {
    agentTemplatesAtom,
    agentTemplatesStatusAtom,
    agentWorkflowsListQueryStateAtom,
    invalidateWorkflowsListCache,
    refetchAgentTemplatesAtom,
    type Workflow,
} from "@agenta/entities/workflow"
import {HomeFocus, type HomeListAgent} from "@agenta/home-ui"
import {LoadError} from "@agenta/ui/components/presentational"
import {useAtomValue, useSetAtom} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useCurrentProject} from "../context/useCurrentProject"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {resolveHomeSurface} from "./homeSurface"
import {HOME_PAGE_FRAME} from "./pageFrame"
import {HomeSkeleton} from "./states/HomeSkeleton"
import {HomeListSkeleton, HomeSectionEmpty} from "./states/HomeStates"
import {useHomeHandoff} from "./useHomeHandoff"

/**
 * The project's home — one question, one composer, one list.
 *
 * The page's shape is the shared `HomeFocus` (`@agenta/home-ui`); only what this app alone owns
 * arrives here — the routing verbs behind the composer and its designed states. What used to sit
 * under it (sessions, automation runs, next triggers, usage) lives on the pages that own those
 * things: as summaries here they made Home a table of contents rather than a place to start work.
 *
 * EVERY project gets this page, empty or not. With no agents it opens on the templates tab with
 * the composer already describing one, which is the job the first-run hero used to do on a page
 * of its own. `homeSurface` only decides whether we know enough to draw it yet.
 */
export const HomeScreen = ({workspaceId, projectId}: {workspaceId: string; projectId: string}) => {
    useBindProjectContext(projectId)
    const project = useCurrentProject(workspaceId, projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo<Workflow[]>(() => agentsQuery.data ?? [], [agentsQuery.data])
    const handoff = useHomeHandoff(base, projectId)
    const templates = useAtomValue(agentTemplatesAtom)
    const templatesStatus = useAtomValue(agentTemplatesStatusAtom)
    const refetchTemplates = useSetAtom(refetchAgentTemplatesAtom)
    const surface = resolveHomeSurface({
        agentCount: agents.length,
        isPending: agentsQuery.isPending,
        isError: agentsQuery.isError,
    })

    // Newest first. The list arrives in whatever order the query returns, which put agents made
    // months ago above one created a minute earlier — and the head of this list is also what the
    // composer binds by default.
    const listAgents = useMemo<HomeListAgent[]>(
        () =>
            [...agents]
                .sort(
                    (a, b) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "") || 0,
                )
                .map((agent) => ({
                    id: agent.id,
                    name: agent.name || agent.slug || "Untitled agent",
                    description: agent.description,
                })),
        [agents],
    )

    // The skeleton takes the SAME frame, or the hold sits somewhere the page does not.
    const frame = HOME_PAGE_FRAME

    const homeBody = (
        <HomeFocus
            className={frame}
            agents={listAgents}
            preferredAgentId={handoff.preferredAgentId}
            templates={templates}
            templatesLoading={templatesStatus === "pending"}
            templatesErrorSlot={
                templatesStatus === "error" ? (
                    <LoadError title="Could not load templates" onRetry={refetchTemplates} />
                ) : undefined
            }
            attachments={handoff.attachments}
            onStartTask={handoff.onStartTask}
            onCreateFromPrompt={handoff.onCreateFromPrompt}
            sending={handoff.sending}
            templatesHref={`${base}/templates`}
            loading={agentsQuery.isPending}
            loadingSlot={<HomeListSkeleton />}
            emptySlot={<HomeSectionEmpty text="Agents you create will show up here." />}
            errorSlot={
                agentsQuery.isError ? (
                    // The list atom exposes no refetch; invalidating its cache is what re-runs it.
                    <LoadError
                        title="Could not load your agents"
                        onRetry={() => void invalidateWorkflowsListCache()}
                    />
                ) : undefined
            }
        />
    )

    return (
        <>
            <PageTitle title="Home" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="border-border flex shrink-0 items-center gap-2 border-b px-4 pb-3 pt-2 lg:hidden">
                            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                            <h1 className="m-0 text-sm font-semibold">
                                {project?.project_name ?? "Home"}
                            </h1>
                        </div>
                    }
                >
                    {surface === "home" ? homeBody : <HomeSkeleton className={frame} />}
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
