import {useMemo} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {NextTriggersSection} from "@agenta/entity-ui/agent"
import type {SessionRowVm} from "@agenta/sessions/row"
import {SessionCardList} from "@agenta/sessions-ui"
import {useAtomValue} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {ContentRail} from "@/components/ContentRail"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {INLINE_LINK} from "@/lib/interactive"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useCurrentProject} from "../context/useCurrentProject"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {AgentListRow} from "./AgentListRow"
import {HomeSectionEmpty, HomeSectionSkeleton} from "./states/HomeStates"

const Section = ({
    title,
    viewAllHref,
    children,
}: {
    title: string
    viewAllHref?: string
    children: React.ReactNode
}) => (
    <section className="flex flex-col">
        <div className="flex items-center justify-between px-4 pb-1 pt-4">
            <h2 className="m-0 text-xs font-semibold uppercase tracking-wide">{title}</h2>
            {viewAllHref ? (
                <Link
                    href={viewAllHref}
                    className={`text-muted-foreground text-xs no-underline ${INLINE_LINK}`}
                >
                    View all →
                </Link>
            ) : null}
        </div>
        {children}
    </section>
)

/**
 * The project's home — the mobile version of the desktop `/apps` page: what needs you
 * (waiting, pinned, recent sessions) and the automation runs, both straight from the shared
 * card hooks, so every rule matches the desktop columns.
 */
export const HomeScreen = ({workspaceId, projectId}: {workspaceId: string; projectId: string}) => {
    useBindProjectContext(projectId)
    const project = useCurrentProject(workspaceId, projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const router = useRouter()
    const openRow = (vm: SessionRowVm) => void router.push(`${base}/sessions/${vm.id}`)
    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo<Workflow[]>(() => agentsQuery.data ?? [], [agentsQuery.data])
    const agentNames = useMemo(
        () => new Map(agents.map((agent) => [agent.id, agent.name || agent.slug || "Agent"])),
        [agents],
    )

    return (
        <>
            <PageTitle parts={["Home", project?.project_name]} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="border-border shrink-0 border-b px-4 pb-3 pt-2">
                            <ContentRail className="flex items-center gap-2 lg:max-w-5xl">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 text-sm font-semibold">
                                    {project?.project_name ?? "Home"}
                                </h1>
                            </ContentRail>
                        </div>
                    }
                >
                    {/* One column on a phone; two side-by-side at lg — what needs you (sessions,
                    agents) next to what runs on its own (triggers, automation runs). */}
                    <ContentRail className="pb-6 lg:grid lg:max-w-5xl lg:grid-cols-2 lg:items-start lg:gap-x-10">
                        <Section title="Sessions" viewAllHref={`${base}/sessions`}>
                            {/* The SHARED list — the same rows, grouping and working pins as desktop Home;
                                touch keeps the pin always visible (no hover). */}
                            <div className="px-2">
                                <SessionCardList
                                    withPinned
                                    limit={5}
                                    emptyText="Your conversations will show up here."
                                    onOpenRow={openRow}
                                    alwaysShowPin
                                />
                            </div>
                        </Section>

                        <Section title="Your agents">
                            {agentsQuery.isPending ? (
                                <HomeSectionSkeleton />
                            ) : agents.length === 0 ? (
                                <HomeSectionEmpty text="Agents you create will show up here." />
                            ) : (
                                agents.map((agent) => (
                                    <AgentListRow
                                        key={agent.id}
                                        agent={agent}
                                        href={`${base}/agents/${agent.id}`}
                                    />
                                ))
                            )}
                        </Section>

                        {/* The shared antd-free section — trigger data, cadence naming, minute clock all
                    come with it; only the display-name map is ours. */}
                        <div className="px-2 pt-2">
                            <NextTriggersSection agentNames={agentNames} />
                        </div>

                        <Section title="Automation runs">
                            <div className="px-2">
                                <SessionCardList
                                    origin="trigger"
                                    limit={3}
                                    emptyText="Runs your triggers start will show up here."
                                    onOpenRow={openRow}
                                    alwaysShowPin
                                />
                            </div>
                        </Section>
                    </ContentRail>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
