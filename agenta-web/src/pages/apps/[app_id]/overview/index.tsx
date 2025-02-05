import {useCallback, useState} from "react"

import AbTestingEvaluation from "@/components/HumanEvaluations/AbTestingEvaluation"
import AutomaticEvalOverview from "@/components/pages/overview/automaticEvaluation/AutomaticEvalOverview"
import DeploymentOverview from "@/components/pages/overview/deployments/DeploymentOverview"
import SingleModelEvaluation from "@/components/HumanEvaluations/SingleModelEvaluation"
import VariantsOverview from "@/components/pages/overview/variants/VariantsOverview"
import {useAppsData} from "@/contexts/app.context"
import {useAppId} from "@/hooks/useAppId"
import {dynamicComponent} from "@/lib/helpers/dynamic"
import {Environment, JSSTheme, Variant} from "@/lib/Types"
import {deleteApp} from "@/services/app-selector/api"
import {MoreOutlined} from "@ant-design/icons"
import {PencilLine, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Space, Typography} from "antd"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"
import {useAllVariantsData} from "@/lib/hooks/useAllVariantsData"
import {useEnvironments} from "@/services/deployment/hooks/useEnvironments"

const ObservabilityOverview: any = dynamicComponent(
    "pages/overview/observability/ObservabilityOverview",
)
const DeleteAppModal: any = dynamicComponent("pages/app-management/modals/DeleteAppModal")
const EditAppModal: any = dynamicComponent("pages/app-management/modals/EditAppModal")

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
}))

export default function Overview() {
    const router = useRouter()
    const appId = useAppId()
    const classes = useStyles()
    const {currentApp, mutate: mutateApps} = useAppsData()
    const [isVariantLoading, setIsVariantLoading] = useState(false)
    const [isDeleteAppModalOpen, setIsDeleteAppModalOpen] = useState(false)
    const [isDelAppLoading, setIsDelAppLoading] = useState(false)
    const [isEditAppModalOpen, setIsEditAppModalOpen] = useState(false)

    const {usernames, data: variants, isLoading, mutate} = useAllVariantsData({appId})
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
            setIsVariantLoading(false)
        }
    }, [currentApp, router])

    return (
        <>
            <div className={classes.container}>
                <Space className="justify-between">
                    <Title>{currentApp?.app_name || ""}</Title>

                    <Dropdown
                        trigger={["click"]}
                        overlayStyle={{width: 180}}
                        menu={{
                            items: [
                                {
                                    key: "rename_app",
                                    label: "Rename",
                                    icon: <PencilLine size={16} />,
                                    onClick: () => setIsEditAppModalOpen(true),
                                },
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

                <ObservabilityOverview />

                <DeploymentOverview
                    variants={variants}
                    isDeploymentLoading={isDeploymentLoading}
                    loadEnvironments={loadEnvironments}
                    environments={environments}
                />

                <VariantsOverview
                    variantList={variants}
                    isVariantLoading={isVariantLoading}
                    environments={environments}
                    fetchAllVariants={mutate}
                    loadEnvironments={loadEnvironments}
                    usernames={usernames}
                />

                <AutomaticEvalOverview />

                <AbTestingEvaluation viewType="overview" />

                <SingleModelEvaluation viewType="overview" />
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
        </>
    )
}
