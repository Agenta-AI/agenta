// @ts-nocheck
import {memo, useState} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {PencilLine, PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Space, Typography} from "antd"
import clsx from "clsx"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {createUseStyles} from "react-jss"

import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
import {openEditAppModalAtom} from "@/oss/components/pages/app-management/modals/EditAppModal/store/editAppModalStore"
// import AutomaticEvalOverview from "@/oss/components/pages/overview/automaticEvaluation/AutomaticEvalOverview"
import DeploymentOverview from "@/oss/components/pages/overview/deployments/DeploymentOverview"
import VariantsOverview from "@/oss/components/pages/overview/variants/VariantsOverview"
import {isDemo} from "@/oss/lib/helpers/utils"
import type {JSSTheme} from "@/oss/lib/Types"
import {useAppsData} from "@/oss/state/app"

const CustomWorkflowHistory: any = dynamic(
    () => import("@/oss/components/pages/app-management/drawers/CustomWorkflowHistory"),
)
const ObservabilityOverview: any = dynamic(
    () => import("@/oss/components/pages/overview/observability/ObservabilityOverview"),
)

const AutoEvaluation = dynamic(
    () => import("@/oss/components/pages/evaluations/autoEvaluation/AutoEvaluation"),
    {ssr: false},
)

const AbTestingEvaluation = dynamic(
    () => import("@/oss/components/HumanEvaluations/AbTestingEvaluation"),
    {ssr: false},
)

const SingleModelEvaluation = dynamic(
    () => import("@/oss/components/HumanEvaluations/SingleModelEvaluation"),
    {ssr: false},
)

const {Title} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        "& h1": {
            fontSize: theme.fontSizeHeading4,
            fontWeight: theme.fontWeightMedium,
            lineHeight: theme.lineHeightHeading4,
        },
    },
}))

const AppDetailsSection = memo(() => {
    const openDeleteAppModal = useSetAtom(openDeleteAppModalAtom)
    const openEditAppModal = useSetAtom(openEditAppModalAtom)
    const {currentApp, mutate: mutateApps} = useAppsData()
    const {openModal} = useCustomWorkflowConfig({
        afterConfigSave: mutateApps,
        configureWorkflow: true,
    })
    return (
        <>
            <Space className="justify-between">
                <Title className="!m-0">{currentApp?.app_name || ""}</Title>

                <Dropdown
                    trigger={["click"]}
                    overlayStyle={{width: 180}}
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
                                      {
                                          key: "rename_app",
                                          label: "Rename",
                                          icon: <PencilLine size={16} />,
                                          onClick: () => openEditAppModal(currentApp!),
                                      },
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
    const classes = useStyles()
    const [isCustomWorkflowHistoryDrawerOpen, setIsCustomWorkflowHistoryDrawerOpen] =
        useState(false)

    return (
        <>
            <div className={clsx(classes.container, "flex flex-col gap-10")}>
                <AppDetailsSection />
                <ObservabilityOverview />
                <DeploymentOverview />
                <VariantsOverview />
                {isDemo() && (
                    <>
                        <AutoEvaluation viewType="overview" />
                        <AbTestingEvaluation viewType="overview" />
                        <SingleModelEvaluation viewType="overview" />
                    </>
                )}
            </div>

            <CustomWorkflowHistory
                open={isCustomWorkflowHistoryDrawerOpen}
                onClose={() => setIsCustomWorkflowHistoryDrawerOpen(false)}
            />
        </>
    )
}

export default OverviewPage
