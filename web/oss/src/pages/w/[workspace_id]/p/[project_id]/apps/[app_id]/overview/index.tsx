import {memo, useState} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {PageLayout} from "@agenta/ui"
import {MoreOutlined} from "@ant-design/icons"
import {Copy, PencilSimple, Trash} from "@phosphor-icons/react"
// TEMPORARY: Disabling name editing
// import {PencilLine} from "@phosphor-icons/react"
import {Space} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
// TEMPORARY: Disabling name editing
// import {openEditAppModalAtom} from "@/oss/components/pages/app-management/modals/EditAppModal/store/editAppModalStore"
import DeploymentOverview from "@/oss/components/pages/overview/deployments/DeploymentOverview"
import VariantsOverview from "@/oss/components/pages/overview/variants/VariantsOverview"
import RequireWorkflowKind from "@/oss/components/RequireWorkflowKind"
import {useAppId} from "@/oss/hooks/useAppId"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
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

const AppDetailsSection = memo(() => {
    const openDeleteAppModal = useSetAtom(openDeleteAppModalAtom)
    // TEMPORARY: Disabling name editing
    // const openEditAppModal = useSetAtom(openEditAppModalAtom)
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
                <h3 className="!m-0 text-lg font-semibold leading-snug">{workflowName}</h3>

                <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent size-7 text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50">
                        {<MoreOutlined />}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={4} className="w-[180px]">
                        {currentWorkflow?.flags?.is_custom && (
                            <DropdownMenuItem onClick={openModal}>
                                <PencilSimple size={16} />
                                Configure
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => copyToClipboard(workflowId)}>
                            <Copy size={16} />
                            Copy ID
                        </DropdownMenuItem>
                        {currentWorkflow?.slug && (
                            <DropdownMenuItem
                                onClick={() => copyToClipboard(currentWorkflow.slug!)}
                            >
                                <Copy size={16} />
                                Copy Slug
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                            variant="destructive"
                            onClick={() =>
                                openDeleteAppModal({
                                    id: workflowId,
                                    name: workflowName,
                                })
                            }
                        >
                            <Trash size={16} />
                            Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
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
    const [isCustomWorkflowHistoryDrawerOpen, setIsCustomWorkflowHistoryDrawerOpen] =
        useState(false)

    return (
        <>
            <PageLayout className="gap-8">
                <AppDetailsSection />
                <ObservabilityOverview />
                {!isEvaluator ? <DeploymentOverview /> : null}
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
