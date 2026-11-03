import type {ComponentType} from "react"

import {
    evaluationRunQueryAtomFamily,
    runHeaderAtomFamily,
    type RunHeader,
} from "@agenta/entities/evaluationRun"
import {LoadError} from "@agenta/ui/components/presentational"
import {Tabs, TabsList, TabsTrigger} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {PageNotFound} from "@/components/PageNotFound"

import {useFocusScenarioParam} from "./focus/useFocusScenarioParam"
import {OverviewTab} from "./overview/OverviewTab"
import {ScenariosSkeleton} from "./scenarios/states/ScenariosSkeleton"
import {RunDetailsSkeleton} from "./states/RunDetailsSkeleton"
import {useRunDetailsView, type RunDetailsView} from "./useRunDetailsView"

// The scenario table and its cell renderers load when the tab opens, not with the page.
const ScenariosTab = dynamic<{runId: string; header: RunHeader}>(
    () => import("./scenarios/ScenariosTab").then((module) => module.ScenariosTab),
    {ssr: false, loading: () => <ScenariosSkeleton />},
)

// The scenario drawer loads only once a scenario is focused.
const ScenarioFocusSheet = dynamic<{runId: string; header: RunHeader}>(
    () => import("./focus/ScenarioFocusSheet").then((module) => module.ScenarioFocusSheet),
    {ssr: false},
)

/**
 * The tabs built so far. A tab without a body shows disabled, and its view falls back to
 * Overview, until the Configuration and Annotate work lands.
 */
type TabBody = ComponentType<{runId: string; header: RunHeader}>
const TAB_BODIES: Partial<Record<RunDetailsView, TabBody>> & {overview: TabBody} = {
    overview: OverviewTab,
    scenarios: ScenariosTab,
}

/** The run page under its title: the tabs and the open tab, or the run's load state. */
export const RunDetailsBody = ({runId}: {runId: string}) => {
    const runQuery = useAtomValue(evaluationRunQueryAtomFamily(runId))
    const header = useAtomValue(runHeaderAtomFamily(runId))
    const {tabs, view, setView} = useRunDetailsView(header)
    const [focusedScenarioId] = useFocusScenarioParam(runId)

    if (runQuery.isSuccess && !runQuery.data) return <PageNotFound />
    // A failed refresh keeps the run on screen; only a run that never loaded shows the error.
    if (runQuery.isError && !runQuery.data) {
        return (
            <LoadError
                framed
                title="Could not load this evaluation"
                onRetry={() => void runQuery.refetch()}
            />
        )
    }
    if (!header) return <RunDetailsSkeleton />

    const shown = TAB_BODIES[view] ? view : "overview"
    const Body = TAB_BODIES[shown] ?? TAB_BODIES.overview
    return (
        <Tabs value={shown} onValueChange={setView}>
            <div className="-mx-4 overflow-x-auto px-4 pb-4">
                <TabsList aria-label="Evaluation sections">
                    {tabs.map((tab) => (
                        <TabsTrigger
                            key={tab.value}
                            value={tab.value}
                            disabled={!TAB_BODIES[tab.value]}
                        >
                            {tab.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </div>
            <Body runId={runId} header={header} />
            {focusedScenarioId ? <ScenarioFocusSheet runId={runId} header={header} /> : null}
        </Tabs>
    )
}
