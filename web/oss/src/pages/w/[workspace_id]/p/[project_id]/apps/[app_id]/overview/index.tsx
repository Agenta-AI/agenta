// @ts-nocheck
import {memo, useState} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {PencilSimple, Trash} from "@phosphor-icons/react"
// TEMPORARY: Disabling name editing
// import {PencilLine} from "@phosphor-icons/react"
import {Button, Dropdown, Space, Typography} from "antd"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import PageLayout from "@/oss/components/PageLayout/PageLayout"
import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
// TEMPORARY: Disabling name editing
// import {openEditAppModalAtom} from "@/oss/components/pages/app-management/modals/EditAppModal/store/editAppModalStore"
import DeploymentOverview from "@/oss/components/pages/overview/deployments/DeploymentOverview"
import VariantsOverview from "@/oss/components/pages/overview/variants/VariantsOverview"
import {useAppsData} from "@/oss/state/app"

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
    // TEMPORARY: Disabling name editing
    // const openEditAppModal = useSetAtom(openEditAppModalAtom)
    const {currentApp, mutate: mutateApps} = useAppsData()
    const {openModal} = useCustomWorkflowConfig({
        afterConfigSave: mutateApps,
        configureWorkflow: true,
    })
    return (
        <>
            <Space className="flex items-center gap-3">
                <Title level={3} className="!m-0">
                    {currentApp?.app_name || ""}
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
                            ...(currentApp?.app_type === "custom"
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
                                      // TEMPORARY: Disabling name editing
                                      // {
                                      //     key: "rename_app",
                                      //     label: "Rename",
                                      //     icon: <PencilLine size={16} />,
                                      //     onClick: () => openEditAppModal(currentApp!),
                                      // },
                                  ]),
                            {
                                key: "delete_app",
                                label: "Delete",
                                icon: <Trash size={16} />,
                                danger: true,
                                onClick: () => openDeleteAppModal(currentApp!),
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

const OverviewPage = () => {
    const {currentApp} = useAppsData()
    const appId = currentApp?.app_id ?? null
    const [isCustomWorkflowHistoryDrawerOpen, setIsCustomWorkflowHistoryDrawerOpen] =
        useState(false)

    return (
        <>
            <PageLayout className="gap-8">
                <AppDetailsSection />
                <ObservabilityOverview />
                <DeploymentOverview />
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

export default OverviewPage
