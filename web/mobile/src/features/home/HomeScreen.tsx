import {useMemo} from "react"

import {
    agentWorkflowsListQueryStateAtom,
    invalidateWorkflowsListCache,
    type Workflow,
} from "@agenta/entities/workflow"
import {HomeFocus, type HomeListAgent} from "@agenta/home-ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useAtomValue} from "jotai"
import {AnimatePresence, motion} from "motion/react"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useMotionPresets} from "@/lib/motion/presets"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useCurrentProject} from "../context/useCurrentProject"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {FirstRunScreen} from "../onboarding/FirstRunScreen"
import {resolveHomeSurface} from "../onboarding/homeSurface"

import {HomeSkeleton} from "./states/HomeSkeleton"
import {HomeListError, HomeListSkeleton, HomeSectionEmpty} from "./states/HomeStates"
import {useHomeHandoff} from "./useHomeHandoff"

/**
 * The project's home — one question, one composer, one list.
 *
 * The page's shape is the shared `HomeFocus` (`@agenta/home-ui`); only what this app alone owns
 * arrives here — the routing verbs behind the composer and its designed states. What used to sit
 * under it (sessions, automation runs, next triggers, usage) lives on the pages that own those
 * things: as summaries here they made Home a table of contents rather than a place to start work.
 *
 * A project with no agents gets [[FirstRunScreen]] in this same frame instead. Home has nothing to
 * offer that user: its composer runs a task with an agent that already exists. See `homeSurface`.
 */
export const HomeScreen = ({workspaceId, projectId}: {workspaceId: string; projectId: string}) => {
    useBindProjectContext(projectId)
    const project = useCurrentProject(workspaceId, projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo<Workflow[]>(() => agentsQuery.data ?? [], [agentsQuery.data])
    const presets = useMotionPresets()
    const handoff = useHomeHandoff(base)
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

    // The frame every screen here applies: the shared column plus a phone's own gutters below
    // `lg`, widening to the page gutters above it. The deep top inset is Home's own — the centred
    // column is the whole page, so it hangs rather than starting at the top. The skeleton takes
    // the SAME frame, or the hold sits somewhere the page does not.
    const frame = `${pageContentWidthClass} px-4 pb-12 pt-10 lg:px-16 lg:pb-16 lg:pt-[120px]`

    // A first run swaps only the BODY: the shell, its header and the nav drawer stay put, so a
    // user with no agents can still reach Settings — which is where they land if the key gate
    // sends them there. The two pre-Home states crossfade into each other rather than popping;
    // Home itself is left unanimated, exactly as it has always rendered.
    const firstRunBody = (
        <AnimatePresence mode="wait" initial={false}>
            <motion.div
                key={surface}
                variants={presets.crossfade}
                initial="initial"
                animate="animate"
                exit="exit"
            >
                {surface === "loading" ? (
                    <HomeSkeleton className={frame} />
                ) : (
                    <FirstRunScreen base={base} />
                )}
            </motion.div>
        </AnimatePresence>
    )

    const homeBody = (
        <HomeFocus
            className={frame}
            agents={listAgents}
            attachments={handoff.attachments}
            onStartTask={handoff.onStartTask}
            onCreateFromPrompt={handoff.onCreateFromPrompt}
            templatesHref={`${base}/templates`}
            loading={agentsQuery.isPending}
            loadingSlot={<HomeListSkeleton />}
            emptySlot={<HomeSectionEmpty text="Agents you create will show up here." />}
            errorSlot={
                agentsQuery.isError ? (
                    // The list atom exposes no refetch; invalidating its cache is what re-runs it.
                    <HomeListError onRetry={() => void invalidateWorkflowsListCache()} />
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
                    {surface === "home" ? homeBody : firstRunBody}
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
