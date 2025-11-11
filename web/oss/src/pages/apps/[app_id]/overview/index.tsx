// @ts-nocheck
import {useCallback, useState, useMemo} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {PencilLine, PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Space, Typography} from "antd"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import DeploymentOverview from "@/oss/components/pages/overview/deployments/DeploymentOverview"
import VariantsOverview from "@/oss/components/pages/overview/variants/VariantsOverview"
import TimeFilter, {TimeRange} from "@/oss/components/TimeFilter"
import {useAppsData} from "@/oss/contexts/app.context"
import {useAppId} from "@/oss/hooks/useAppId"
import {isDemo} from "@/oss/lib/helpers/utils"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import type {JSSTheme} from "@/oss/lib/Types"
import {deleteApp} from "@/oss/services/app-selector/api"
import {useEnvironments} from "@/oss/services/deployment/hooks/useEnvironments"

const CustomWorkflowHistory: any = dynamic(
    () => import("@/oss/components/pages/app-management/drawers/CustomWorkflowHistory"),
)
const ObservabilityOverview: any = dynamic(
    () => import("@/oss/components/pages/overview/observability/ObservabilityOverview"),
)
const DeleteAppModal: any = dynamic(
    () => import("@/oss/components/pages/app-management/modals/DeleteAppModal"),
)
const EditAppModal: any = dynamic(
    () => import("@/oss/components/pages/app-management/modals/EditAppModal"),
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
        display: "flex",
        flexDirection: "column",
        gap: 40,
        "& h1": {
            fontSize: theme.fontSizeHeading4,
            fontWeight: theme.fontWeightMedium,
            lineHeight: theme.lineHeightHeading4,
        },
    },
    timeFilterSection: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
        marginTop: -16, // Counteract part of the 40px gap from container
    },
}))

const OverviewPage = () => {
    const router = useRouter()
    const appId = useAppId()
    const classes = useStyles()
    const {currentApp, mutate: mutateApps} = useAppsData()
    const [isDeleteAppModalOpen, setIsDeleteAppModalOpen] = useState(false)
    const [isDelAppLoading, setIsDelAppLoading] = useState(false)
    const [isEditAppModalOpen, setIsEditAppModalOpen] = useState(false)

    const [isCustomWorkflowHistoryDrawerOpen, setIsCustomWorkflowHistoryDrawerOpen] =
        useState(false)
    const [timeRange, setTimeRange] = useState<TimeRange>("30_days")

    const {data, mutate, isLoading: isVariantLoading} = useVariants(currentApp)({appId})
    const {CustomWorkflowModal, openModal} = useCustomWorkflowConfig({
        afterConfigSave: mutate,
    })
    const sortedVariants = useMemo(() => {
        if (!data) return []

        return data.variants.sort((a, b) => {
            return b.createdAtTimestamp - a.createdAtTimestamp
        })
    }, [data])
    const {
        environments,
        isEnvironmentsLoading: isDeploymentLoading,
        mutate: loadEnvironments,
    } = useEnvironments({appId})

    const handleDeleteOk = useCallback(async () => {
        if (!currentApp) return

        setIsDelAppLoading(true)
        try {
            await deleteApp(currentApp.app_id)
            await mutateApps()
            router.push("/apps")
        } catch (error) {
            console.error(error)
        } finally {
            localStorage.removeItem(`tabIndex_${currentApp.app_id}`)
            setIsDeleteAppModalOpen(false)
        }
    }, [currentApp, router])

    return (
        <>
            <div className={classes.container}>
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
                                              onClick: () => setIsEditAppModalOpen(true),
                                          },
                                      ]),
                                {
                                    key: "delete_app",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: () => setIsDeleteAppModalOpen(true),
                                },
                            ],
                        }}
                    >
                        <Button type="text" icon={<MoreOutlined />} />
                    </Dropdown>
                </Space>

                <div className={classes.timeFilterSection}>
                    <div />
                    <TimeFilter value={timeRange} onChange={setTimeRange} />
                </div>

                <ObservabilityOverview timeRange={timeRange} />

                <DeploymentOverview
                    variants={sortedVariants}
                    isDeploymentLoading={isDeploymentLoading}
                    loadEnvironments={loadEnvironments}
                    environments={environments}
                />

                <VariantsOverview
                    variantList={sortedVariants}
                    isVariantLoading={isVariantLoading}
                    environments={environments}
                    fetchAllVariants={mutate}
                    loadEnvironments={loadEnvironments}
                />

                {isDemo() && (
                    <>
                        <AutoEvaluation viewType="overview" />

                        <AbTestingEvaluation viewType="overview" />

                        <SingleModelEvaluation viewType="overview" />
                    </>
                )}
            </div>
            {currentApp && (
                <DeleteAppModal
                    open={isDeleteAppModalOpen}
                    onOk={handleDeleteOk}
                    onCancel={() => setIsDeleteAppModalOpen(false)}
                    confirmLoading={isDelAppLoading}
                    appDetails={currentApp}
                />
            )}

            {currentApp && (
                <EditAppModal
                    open={isEditAppModalOpen}
                    onCancel={() => setIsEditAppModalOpen(false)}
                    appDetails={currentApp}
                />
            )}

            {CustomWorkflowModal}

            <CustomWorkflowHistory
                open={isCustomWorkflowHistoryDrawerOpen}
                onClose={() => setIsCustomWorkflowHistoryDrawerOpen(false)}
            />
        </>
    )
}

export default OverviewPage
