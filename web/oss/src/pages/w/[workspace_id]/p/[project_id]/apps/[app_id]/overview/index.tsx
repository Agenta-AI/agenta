import {memo, useState} from "react"

import {PageLayout} from "@agenta/ui"
import {MoreOutlined} from "@ant-design/icons"
import {Copy, PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Space, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
import {openEditAppModalAtom} from "@/oss/components/pages/app-management/modals/EditAppModal/store/editAppModalStore"
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

                <Dropdown
                    trigger={["click"]}
                    styles={{
                        root: {
                            width: 180,
                        },
                    }}
                    menu={{
                        items: [
                            ...(currentWorkflow?.flags?.is_custom
                                ? [
                                      {
                                          key: "configure",
                                          label: "Configure",
                                          icon: <PencilSimple size={16} />,
                                          onClick: openModal,
                                      },
                                      //   {
                                      //       key: "history",
                                      //       label: "History",
                                      //       icon: <ClockCounterClockwise size={16} />,
                                      //       onClick: () =>
                                      //           setIsCustomWorkflowHistoryDrawerOpen(true),
                                      //   },
                                  ]
                                : [
                                      {
                                          key: "rename_app",
                                          label: "Rename",
                                          icon: <PencilSimple size={16} />,
                                          onClick: () =>
                                              openEditAppModal({
                                                  id: workflowId,
                                                  name: workflowName,
                                                  onRenamed: async () => {
                                                      await mutateApps?.()
                                                  },
                                              }),
                                      },
                                  ]),
                            {
                                key: "copy_id",
                                label: "Copy ID",
                                icon: <Copy size={16} />,
                                onClick: () => copyToClipboard(workflowId),
                            },
                            ...(currentWorkflow?.slug
                                ? [
                                      {
                                          key: "copy_slug",
                                          label: "Copy Slug",
                                          icon: <Copy size={16} />,
                                          onClick: () => copyToClipboard(currentWorkflow.slug!),
                                      },
                                  ]
                                : []),
                            {
                                key: "delete_app",
                                label: "Delete",
                                icon: <Trash size={16} />,
                                danger: true,
                                onClick: () =>
                                    openDeleteAppModal({
                                        id: workflowId,
                                        name: workflowName,
                                    }),
                            },
                        ],
                    }}
                >
                    <Button type="text" icon={<MoreOutlined />} />
                </Dropdown>
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
