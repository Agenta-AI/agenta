import {useCallback, useMemo, type ReactNode} from "react"

import {AgentOverviewLayout} from "@agenta/entity-ui/agent"
import {resetSessionFiltersAtom, sessionSearchAtom, useSessionsList} from "@agenta/sessions/state"
import {useFilterMenuView} from "@agenta/ui/filter-menu"
import {useSetAtom} from "jotai"

import {useScrollFade} from "@/lib/useScrollFade"

import type {SessionRowVerbs} from "../sessions/SessionListTable"
import {activityFloorIso} from "../sessions/sessionListView"

import {AgentActivityFilterMenu} from "./AgentActivityFilterMenu"
import {AgentActivityTable} from "./AgentActivityTable"
import {AgentActivityTabs} from "./AgentActivityTabs"
import {
    agentActivityPolicy,
    DEFAULT_AGENT_ACTIVITY_VIEW,
    type AgentActivityView,
} from "./agentActivityView"
import {AgentAutomationsCard} from "./AgentAutomationsCard"
import {AgentComposer} from "./AgentComposer"
import {AgentConfigCard} from "./AgentConfigCard"
import {AgentDriveCard} from "./AgentDriveCard"

/**
 * The overview's body, on the shared two-column arrangement: the composer over the activity
 * tabs on the left, the agent's own state as three soft cards on the right — Configuration,
 * Files, Automations — and the two stacked below `lg`.
 */
export const AgentOverviewBody = ({
    agentId,
    agentName,
    base,
    agentNames,
    verbs,
    onEditConfig,
    channels,
}: {
    agentId: string
    agentName: string
    /** `/w/:workspace/p/:project` */
    base: string
    agentNames: ReadonlyMap<string, string>
    verbs: SessionRowVerbs
    onEditConfig: () => void
    /** The Channels connect card, host-owned (it wires to the channels API). */
    channels?: ReactNode
}) => {
    // The grouping is a preference; the tab, the window and the status are the question of the moment.
    const [view, setView] = useFilterMenuView<AgentActivityView>({
        key: "agenta:agent-overview:view",
        fallback: DEFAULT_AGENT_ACTIVITY_VIEW,
        persist: ["group"],
    })
    // Once per facet change, never per render — a `Date.now()` floor would re-key the query forever.
    const activityFloor = useMemo(() => activityFloorIso(view.activity), [view.activity])

    // The SAME arguments the table passes, so both resolve to one query; here only for the count.
    const policy = useMemo(() => agentActivityPolicy(view.tab), [view.tab])
    const list = useSessionsList({
        agentId,
        activityFloor,
        defaultPolicy: policy,
        automationPolicy: policy,
    })

    // Home's edge fade: the list says there is more above or below instead of ending in a line.
    const fade = useScrollFade<HTMLDivElement>()

    const setSearch = useSetAtom(sessionSearchAtom)
    const resetFilters = useSetAtom(resetSessionFiltersAtom)
    const clearSearch = useCallback(() => setSearch(""), [setSearch])
    const resetView = useCallback(() => {
        resetFilters()
        setView({...DEFAULT_AGENT_ACTIVITY_VIEW, tab: view.tab})
    }, [resetFilters, setView, view.tab])
    const setTab = useCallback(
        (tab: AgentActivityView["tab"]) => setView({...view, tab}),
        [setView, view],
    )

    return (
        <AgentOverviewLayout
            // The rows' hover fill bleeds 12px past the tabs on both sides, as on the agents
            // page. The scroller is this frame, and a scrollport clips at its padding box, so
            // 12px of the page gutter lives here rather than on the screen's column.
            className="px-3"
            // The page never scrolls: the composer and the tabs stay put and the list beneath
            // them takes what is left of the screen and scrolls on its own.
            scroll="columns"
            main={
                <>
                    <AgentComposer agentId={agentId} agentName={agentName} base={base} />
                    <div className="mt-3 flex min-h-0 flex-1 flex-col">
                        <AgentActivityTabs
                            tab={view.tab}
                            onChange={setTab}
                            actions={
                                <AgentActivityFilterMenu
                                    view={view}
                                    onChange={setView}
                                    waitingCount={list.waitingCount}
                                    onReset={resetView}
                                />
                            }
                        />
                        {/* The one scroller. `-mx-3 px-3` is net zero on the content and gives
                            the rows' 12px hover bleed somewhere to land — a scrollport clips at
                            its padding box. */}
                        <div
                            ref={fade.ref}
                            onScroll={fade.onScroll}
                            style={fade.style}
                            className="-mx-3 min-h-0 flex-1 overflow-y-auto px-3"
                        >
                            <AgentActivityTable
                                agentId={agentId}
                                view={view}
                                activityFloor={activityFloor}
                                verbs={verbs}
                                onClearSearch={clearSearch}
                                onResetView={resetView}
                            />
                        </div>
                    </div>
                </>
            }
            rail={
                // Only as a side rail. Below `lg` the layout would stack the cards under the
                // list, where three of them read as a second page; the agent's own state is a
                // tap away in the session workspace.
                <div className="hidden w-full flex-col gap-3.5 lg:flex">
                    <AgentConfigCard agentId={agentId} onEdit={onEditConfig} />
                    {channels}
                    <AgentDriveCard agentId={agentId} />
                    <AgentAutomationsCard agentId={agentId} agentNames={agentNames} base={base} />
                </div>
            }
        />
    )
}
