import type {ComponentType} from "react"

import {
    evaluationRunQueryAtomFamily,
    runHeaderAtomFamily,
    type RunHeader,
} from "@agenta/entities/evaluationRun"
import {LoadError} from "@agenta/ui/components/presentational"
import {Tabs, TabsList, TabsTrigger} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {OverviewTab} from "./overview/OverviewTab"
import {RunDetailsSkeleton} from "./states/RunDetailsSkeleton"
import {useRunDetailsView, type RunDetailsView} from "./useRunDetailsView"

import {PageNotFound} from "@/components/PageNotFound"

/**
 * The tabs built so far. A tab without a body shows disabled, and its view falls back to
 * Overview, until the Scenarios, Configuration and Annotate work lands.
 */
const TAB_BODIES: Partial<
    Record<RunDetailsView, ComponentType<{runId: string; header: RunHeader}>>
> = {overview: OverviewTab}

const shownView = (view: RunDetailsView): RunDetailsView => (TAB_BODIES[view] ? view : "overview")

/** The run page under its title: the tabs and the open tab, or the run's load state. */
export const RunDetailsBody = ({runId}: {runId: string}) => {
    const runQuery = useAtomValue(evaluationRunQueryAtomFamily(runId))
    const header = useAtomValue(runHeaderAtomFamily(runId))
    const {tabs, view, setView} = useRunDetailsView(header)

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

    const Body = TAB_BODIES[shownView(view)] ?? OverviewTab
    return (
        <Tabs value={shownView(view)} onValueChange={setView}>
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
        </Tabs>
    )
}
