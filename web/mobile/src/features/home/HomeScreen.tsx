import {useMemo} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {NextTriggersSection} from "@agenta/entity-ui/agent"
import {AgentsPanel, HomeOverview, UsageCard, type AgentsPanelEntry} from "@agenta/home-ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useAtomValue} from "jotai"
import {AnimatePresence, motion} from "motion/react"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useMotionPresets} from "@/lib/motion/presets"

import {NewAgentAction} from "../agents/NewAgentAction"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {useCurrentProject} from "../context/useCurrentProject"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {FirstRunScreen} from "../onboarding/FirstRunScreen"
import {resolveHomeSurface} from "../onboarding/homeSurface"
import {FirstRunLoading} from "../onboarding/states/FirstRunStates"
import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

import {HomeComposer} from "./HomeComposer"
import {HomeSectionEmpty} from "./states/HomeStates"

/**
 * The project's home — the SHARED page (`@agenta/home-ui`), the same one the desktop app
 * renders: the hero, then what is in flight (sessions, automation runs), with what you could
 * start (agents, next triggers, usage) in the rail beside it at lg and beneath it on a phone.
 *
 * The composer mints a session id, stashes the task and navigates to the chat route, which is
 * where the conversation engine lives — the first send is what creates the session server-side.
 *
 * A project with no agents gets [[FirstRunScreen]] in this same frame instead. Home has nothing
 * to offer that user: its composer runs a task with an agent that already exists, so it does not
 * render at all, leaving one button on an empty page. See `homeSurface` for the decision.
 */
export const HomeScreen = ({workspaceId, projectId}: {workspaceId: string; projectId: string}) => {
    useBindProjectContext(projectId)
    const project = useCurrentProject(workspaceId, projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const router = useRouter()
    const sessionMenu = useSessionRowMenu(base)
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo<Workflow[]>(() => agentsQuery.data ?? [], [agentsQuery.data])
    const presets = useMotionPresets()
    const surface = resolveHomeSurface({
        agentCount: agents.length,
        isPending: agentsQuery.isPending,
        isError: agentsQuery.isError,
    })
    const agentNames = useMemo(
        () => new Map(agents.map((agent) => [agent.id, agent.name || agent.slug || "Agent"])),
        [agents],
    )

    // Rename/archive/playground have no mobile surface, so their menu entries are simply not
    // offered — the card renders without them rather than with dead actions.
    const agentEntries = useMemo<AgentsPanelEntry[]>(
        () =>
            agents.map((agent) => ({
                agent: {
                    id: agent.id,
                    name: agent.name || agent.slug || "Untitled agent",
                    description: agent.description,
                    updatedAt: agent.updated_at ?? undefined,
                },
                createdAt: agent.created_at ?? undefined,
                onOpenOverview: () => void router.push(`${base}/agents/${agent.id}`),
            })),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [agents, base],
    )

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
                    <FirstRunLoading />
                ) : (
                    <FirstRunScreen base={base} workspaceId={workspaceId} projectId={projectId} />
                )}
            </motion.div>
        </AnimatePresence>
    )

    const homeBody = (
        <HomeOverview
            // The frame every screen here applies: the shared column plus a phone's
            // own gutters below `lg`, widening to the page gutters above it — the
            // desktop app's `PageLayout` gives its copy of this page the same box.
            // No top inset below `lg`: this box is the scroller there, and a
            // padding-top on a scroller pushes its `sticky` section headers down.
            className={`${pageContentWidthClass} px-4 pb-6 lg:px-16 lg:pb-8 lg:pt-14`}
            title="What do you want to do?"
            action={<NewAgentAction base={base} align="end" />}
            composer={agents.length > 0 ? <HomeComposer agents={agents} base={base} /> : null}
            sessionsHref={`${base}/sessions`}
            onOpenSession={sessionMenu.open}
            sessionMenuFor={sessionMenu.menuFor}
            onSessionMenuSelect={sessionMenu.onMenuSelect}
            alwaysShowPin
            agentsPanel={
                <AgentsPanel
                    entries={agentEntries}
                    loading={agentsQuery.isPending}
                    allAgentsHref={`${base}/agents`}
                    empty={<HomeSectionEmpty text="Agents you create will show up here." />}
                />
            }
            triggersPanel={<NextTriggersSection agentNames={agentNames} />}
            usagePanel={<UsageCard />}
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
