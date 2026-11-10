import type {ComponentType} from "react"

import {
    evaluationRunQueryAtomFamily,
    runHeaderAtomFamily,
    runReferencesAtomFamily,
    type RunHeader,
} from "@agenta/entities/evaluationRun"
import {LoadError} from "@agenta/ui/components/presentational"
import {Tabs, TabsList, TabsTrigger} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {PageNotFound} from "@/components/PageNotFound"

import {useRevisionParam} from "../revisions/useRevisionParam"

import {CompareOverviewSkeleton} from "./compare/states/CompareOverviewSkeleton"
import {useCompareRunIds} from "./compare/useCompareRunIds"
import {useFocusedRunId} from "./compare/useFocusedRunId"
import {ConfigurationSkeleton} from "./configuration/states/ConfigurationSkeleton"
import {RunAnnotateSkeleton} from "./focus/states/RunAnnotateSkeleton"
import {useFocusScenarioParam} from "./focus/useFocusScenarioParam"
import {OverviewTab} from "./overview/OverviewTab"
import {ScenariosSkeleton} from "./scenarios/states/ScenariosSkeleton"
import {RunDetailsSkeleton} from "./states/RunDetailsSkeleton"
import {useRunDetailsView, type RunDetailsView} from "./useRunDetailsView"

interface TabBodyProps {
    projectId: string
    runId: string
    header: RunHeader
    /** The runs compared with this one (`?compare=`); empty when none. */
    compareIds: readonly string[]
}

// The compared overview loads only while runs are compared.
const CompareOverviewTab = dynamic<TabBodyProps>(
    () =>
        import("./compare/overview/CompareOverviewTab").then((module) => module.CompareOverviewTab),
    {ssr: false, loading: () => <CompareOverviewSkeleton />},
)

// The compared configuration, one column per run, loads only while runs are compared.
const CompareConfigurationTab = dynamic<TabBodyProps>(
    () =>
        import("./compare/configuration/CompareConfigurationTab").then(
            (module) => module.CompareConfigurationTab,
        ),
    {ssr: false, loading: () => <ConfigurationSkeleton />},
)

/** The tabs that have their own compared view. */
const COMPARE_BODIES: Partial<Record<RunDetailsView, ComponentType<TabBodyProps>>> = {
    overview: CompareOverviewTab,
    configuration: CompareConfigurationTab,
}

// The scenario table and its cell renderers load when the tab opens, not with the page.
const ScenariosTab = dynamic<TabBodyProps>(
    () => import("./scenarios/ScenariosTab").then((module) => module.ScenariosTab),
    {ssr: false, loading: () => <ScenariosSkeleton />},
)

// The Annotate tab brings the annotation controllers: it loads when the tab opens.
const RunAnnotateTab = dynamic<TabBodyProps>(
    () => import("./focus/RunAnnotateTab").then((module) => module.RunAnnotateTab),
    {ssr: false, loading: () => <RunAnnotateSkeleton />},
)

// The scenario drawer loads only once a scenario is focused.
const ScenarioFocusSheet = dynamic<{runId: string; header: RunHeader; poll: boolean}>(
    () => import("./focus/ScenarioFocusSheet").then((module) => module.ScenarioFocusSheet),
    {ssr: false},
)

// The configuration tab, with its sections and the JSON editor, loads when the tab opens.
const ConfigurationTab = dynamic<TabBodyProps>(
    () => import("./configuration/ConfigurationTab").then((module) => module.ConfigurationTab),
    {ssr: false, loading: () => <ConfigurationSkeleton />},
)

// The revision drawer loads when a revision is opened, not with the page.
const RevisionDrawerHost = dynamic(
    () => import("../revisions/RevisionDrawerHost").then((module) => module.RevisionDrawerHost),
    {ssr: false},
)

/**
 * The tabs built so far. A tab without a body shows disabled, and its view falls back to
 * Overview.
 */
type TabBody = ComponentType<TabBodyProps>
const TAB_BODIES: Partial<Record<RunDetailsView, TabBody>> & {overview: TabBody} = {
    overview: OverviewTab,
    scenarios: ScenariosTab,
    configuration: ConfigurationTab,
    focus: RunAnnotateTab,
}

/** The run page under its title: the tabs and the open tab, or the run's load state. */
export const RunDetailsBody = ({projectId, runId}: {projectId: string; runId: string}) => {
    const runQuery = useAtomValue(evaluationRunQueryAtomFamily(runId))
    const header = useAtomValue(runHeaderAtomFamily(runId))
    const references = useAtomValue(runReferencesAtomFamily(runId))
    const {tabs, view, setView} = useRunDetailsView(header)
    const [focusedScenarioId] = useFocusScenarioParam(runId)
    const [openRevisionId] = useRevisionParam()
    const [compareIds] = useCompareRunIds(runId)
    // A compared run's row opens the drawer on that run, so Previous and Next stay in it.
    const focusRunId = useFocusedRunId(runId, compareIds)
    const focusHeader = useAtomValue(runHeaderAtomFamily(focusRunId))

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
    const Body =
        (compareIds.length > 0 ? COMPARE_BODIES[shown] : undefined) ??
        TAB_BODIES[shown] ??
        TAB_BODIES.overview
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
            <Body projectId={projectId} runId={runId} header={header} compareIds={compareIds} />
            {focusedScenarioId && focusHeader ? (
                <ScenarioFocusSheet
                    key={focusRunId}
                    runId={focusRunId}
                    header={focusHeader}
                    poll={focusRunId === runId && shown !== "scenarios" && shown !== "focus"}
                />
            ) : null}
            {openRevisionId ? (
                <RevisionDrawerHost
                    kind={openRevisionId === references?.revisionId ? "variant" : "evaluator"}
                />
            ) : null}
        </Tabs>
    )
}
