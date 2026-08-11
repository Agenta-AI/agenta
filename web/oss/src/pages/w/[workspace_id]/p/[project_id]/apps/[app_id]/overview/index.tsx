import {memo, useState} from "react"

import {AgentActionsMenu} from "@agenta/entity-ui/agent"
import {PageLayout} from "@agenta/ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {Space, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {agentsWorkflowsAtom, agentsWorkflowsLoadingAtom} from "@/oss/components/pages/agents/store"
import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
import {openEditAppModalAtom} from "@/oss/components/pages/app-management/modals/EditAppModal/store/editAppModalStore"
import AgentOverview from "@/oss/components/pages/overview/agent/AgentOverview"
import DeploymentOverview from "@/oss/components/pages/overview/deployments/DeploymentOverview"
import VariantsOverview from "@/oss/components/pages/overview/variants/VariantsOverview"
import WorkflowPageTitle from "@/oss/components/PageTitle/WorkflowPageTitle"
import RequireWorkflowKind from "@/oss/components/RequireWorkflowKind"
import {useAppId} from "@/oss/hooks/useAppId"
import {useAppsData} from "@/oss/state/app"
import {currentWorkflowAtom} from "@/oss/state/workflow"

const CustomWorkflowHistory: any = dynamic(
    () => import("@/oss/components/pages/app-management/drawers/CustomWorkflowHistory"),
)
const ObservabilityOverview: any = dynamic(
    () => import("@/oss/components/pages/overview/observability/ObservabilityOverview"),
)
const LatestEvaluationRunsTable: any = dynamic(() =>
    import("@/oss/components/EvaluationRunsTablePOC").then((m) => m.LatestEvaluationRunsTable),
)

const {Title} = Typography

const AppDetailsSection = memo(() => {
    const openDeleteAppModal = useSetAtom(openDeleteAppModalAtom)
    const openEditAppModal = useSetAtom(openEditAppModalAtom)
    // Resolve the current workflow (app OR evaluator) from the unified state so
    // this header works on evaluator overview pages too — `useAppsData()`
    // returns null for evaluators (they aren't in the apps list). `mutateApps`
    // is still needed to refresh after the app-only "Configure" custom-workflow
    // flow.
    const {mutate: mutateApps} = useAppsData()
    const currentWorkflow = useAtomValue(currentWorkflowAtom)
    const workflowId = currentWorkflow?.id ?? ""
    const workflowName = currentWorkflow?.name ?? currentWorkflow?.slug ?? ""
    const {openModal} = useCustomWorkflowConfig({
        afterConfigSave: mutateApps,
    })
    return (
        <>
            <Space className="flex items-center gap-3">
                <Title level={3} className="!m-0">
                    {workflowName}
                </Title>

                <AgentActionsMenu
                    agent={{
                        id: workflowId,
                        name: workflowName,
                        slug: currentWorkflow?.slug,
                    }}
                    // The desktop keeps its app-management modals: they validate, and the edit
                    // flow refreshes the apps cache the rest of this app reads.
                    onRename={() =>
                        openEditAppModal({
                            id: workflowId,
                            name: workflowName,
                            onRenamed: async () => {
                                await mutateApps?.()
                            },
                        })
                    }
                    onDelete={() => openDeleteAppModal({id: workflowId, name: workflowName})}
                    onConfigure={currentWorkflow?.flags?.is_custom ? openModal : undefined}
                />
            </Space>
        </>
    )
})

const OverviewContent = () => {
    // Use the route workflow id (works for apps AND evaluators) rather than
    // `useAppsData().currentApp?.id`, which is null for evaluators. The Overview
    // eval-runs tables are `appScoped` to this id, so each scopes to runs where
    // the workflow is the evaluated SUBJECT (the run-list subject predicate in
    // fetchEvaluationRunsWindow) — i.e. "evaluations of this workflow". For an
    // evaluator that's its subject runs (evaluations OF it), not runs that used
    // it as a grader. So the summaries are correct for apps AND evaluators.
    const appId = useAppId() || null
    // Deployments don't apply to evaluator workflows (they're not deployed like
    // apps), so the Deployment section is hidden for them.
    const currentWorkflow = useAtomValue(currentWorkflowAtom)
    const isEvaluator = Boolean(currentWorkflow?.flags?.is_evaluator)
    // Membership of the classified agents list, not the artifact's `is_agent` flag — agent
    // identity is revision-derived, so the artifact flag reads false for real agents.
    const agents = useAtomValue(agentsWorkflowsAtom)
    const agentsLoading = useAtomValue(agentsWorkflowsLoadingAtom)
    const isAgent = Boolean(appId) && agents.some((agent) => agent.workflowId === appId)
    // An agent's overview is about its work, not its prompt revisions or evaluation runs.
    // Held while the list resolves so those sections never flash in and then vanish.
    const showWorkflowSections = !isAgent && !agentsLoading
    const [isCustomWorkflowHistoryDrawerOpen, setIsCustomWorkflowHistoryDrawerOpen] =
        useState(false)

    return (
        <>
            <WorkflowPageTitle title="Overview" />
            {/* The agent branch runs inside the layout's bounded frame (it asks for it), so the
                page column must be allowed to shrink or its children can't take a definite
                height and the per-column scrolls collapse back into one page scroll. It also
                takes the shared centred column, like Home — the prompt-app/evaluator branch
                below stays full width for its charts and evaluation tables. */}
            <PageLayout className={clsx("gap-8", isAgent && [pageContentWidthClass, "min-h-0"])}>
                <AppDetailsSection />

                {/* An agent's overview is its own surface. Charts move into that layout's usage
                    strip (expandable to the same dashboard) rather than opening with four
                    full-page graphs, and Deployment goes with the prompt-app sections: an agent
                    is not promoted through environments. Both branches wait for the agents list
                    so neither flashes in and vanishes. */}
                {isAgent && appId ? (
                    <AgentOverview appId={appId} agentName={currentWorkflow?.name ?? undefined} />
                ) : agentsLoading ? null : (
                    <>
                        <ObservabilityOverview />
                        {!isEvaluator ? <DeploymentOverview /> : null}
                    </>
                )}

                {showWorkflowSections ? (
                    <>
                        <VariantsOverview />
                        <LatestEvaluationRunsTable
                            title="Auto Evaluations"
                            evaluationKind="auto"
                            appId={appId}
                            appScoped
                            withContainerStyles={false}
                        />
                        <LatestEvaluationRunsTable
                            title="Human Evaluations"
                            evaluationKind="human"
                            appId={appId}
                            appScoped
                            withContainerStyles={false}
                        />
                    </>
                ) : null}
            </PageLayout>

            <CustomWorkflowHistory
                open={isCustomWorkflowHistoryDrawerOpen}
                onClose={() => setIsCustomWorkflowHistoryDrawerOpen(false)}
            />
        </>
    )
}

const OverviewPage = () => (
    <RequireWorkflowKind allowed={["app", "evaluator"]} currentRoute="overview">
        <OverviewContent />
    </RequireWorkflowKind>
)

export default OverviewPage
