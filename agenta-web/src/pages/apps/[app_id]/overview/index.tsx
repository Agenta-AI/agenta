import DeleteAppModal from "@/components/AppSelector/modals/DeleteAppModal"
import EditAppModal from "@/components/AppSelector/modals/EditAppModal"
import AbTestingEvalOverview from "@/components/pages/overview/abTestingEvaluation/AbTestingEvalOverview"
import AutomaticEvalOverview from "@/components/pages/overview/automaticEvaluation/AutomaticEvalOverview"
import DeploymentOverview from "@/components/pages/overview/deployments/DeploymentOverview"
import SingleModelEvalOverview from "@/components/pages/overview/singleModelEvaluation/SingleModelEvalOverview"
import VariantsOverview from "@/components/pages/overview/variants/VariantsOverview"
import {useAppsData} from "@/contexts/app.context"
import {useAppId} from "@/hooks/useAppId"
import {dynamicComponent} from "@/lib/helpers/dynamic"
import {renameVariablesCapitalizeAll} from "@/lib/helpers/utils"
import {Environment, JSSTheme, Variant} from "@/lib/Types"
import {fetchSingleProfile, fetchVariants} from "@/services/api"
import {deleteApp} from "@/services/app-selector/api"
import {fetchEnvironments} from "@/services/deployment/api"
import {MoreOutlined} from "@ant-design/icons"
import {PencilLine, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Space, Typography} from "antd"
import {useRouter} from "next/router"
import {useCallback, useEffect, useState} from "react"
import {createUseStyles} from "react-jss"

const ObservabilityOverview: any = dynamicComponent(
    "pages/overview/observability/ObservabilityOverview",
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
}))

export default function Overview() {
    const router = useRouter()
    const appId = useAppId()
    const classes = useStyles()
    const {currentApp} = useAppsData()
    const capitalizedAppName = renameVariablesCapitalizeAll(currentApp?.app_name || "")
    const [variants, setVariants] = useState<Variant[]>([])
    const [isVariantLoading, setIsVariantLoading] = useState(false)
    const [isDeleteAppModalOpen, setIsDeleteAppModalOpen] = useState(false)
    const [isDelAppLoading, setIsDelAppLoading] = useState(false)
    const [environments, setEnvironments] = useState<Environment[]>([])
    const [isDeploymentLoading, setIsDeploymentLoading] = useState(true)
    const [usernames, setUsernames] = useState<Record<string, string>>({})
    const [isEditAppModalOpen, setIsEditAppModalOpen] = useState(false)

    const loadEnvironments = useCallback(async () => {
        try {
            setIsDeploymentLoading(true)
            const response = await fetchEnvironments(appId)
            setEnvironments(response)
        } catch (error) {
            console.error(error)
        } finally {
            setIsDeploymentLoading(false)
        }
    }, [appId])

    const fetchAllVariants = async () => {
        const usernameMap: Record<string, string> = {}
        try {
            setIsVariantLoading(true)

            const data = await fetchVariants(appId)
            const uniqueModifiedByIds = Array.from(
                new Set(data.map((variant) => variant.modifiedById)),
            )

            const profiles = await Promise.all(
                uniqueModifiedByIds.map((id) => fetchSingleProfile(id)),
            )

            profiles.forEach((profile, index) => {
                const id = uniqueModifiedByIds[index]
                usernameMap[id] = profile?.username || "-"
            })

            setUsernames(usernameMap)
            setVariants(data)
        } catch (error) {
            console.error(error)
        } finally {
            setIsVariantLoading(false)
        }
    }

    useEffect(() => {
        fetchAllVariants()
    }, [appId])

    const handleDeleteOk = async () => {
        if (!currentApp) return

        setIsDelAppLoading(true)
        try {
            await deleteApp(currentApp.app_id)
            router.push("/apps")
        } catch (error) {
            console.error(error)
        } finally {
            localStorage.removeItem(`tabIndex_${currentApp.app_id}`)
            setIsDeleteAppModalOpen(false)
            setIsVariantLoading(false)
        }
    }

    return (
        <>
            <div className={classes.container}>
                <Space className="justify-between">
                    <Title>{capitalizedAppName}</Title>

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
                        <Button type="text" icon={<MoreOutlined />} size="small" />
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
                    fetchAllVariants={fetchAllVariants}
                    loadEnvironments={loadEnvironments}
                    usernames={usernames}
                />

                <AutomaticEvalOverview />

                <AbTestingEvalOverview />

                <SingleModelEvalOverview />
            </div>
            {currentApp && (
                <DeleteAppModal
                    open={isDeleteAppModalOpen}
                    onOk={handleDeleteOk}
                    onCancel={() => setIsDeleteAppModalOpen(false)}
                    confirmLoading={isDelAppLoading}
                    appName={currentApp?.app_name}
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
