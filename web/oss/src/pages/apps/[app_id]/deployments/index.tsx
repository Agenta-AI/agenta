// @ts-nocheck
import {useEffect, useMemo, useState} from "react"

import {Flex, Spin, Typography} from "antd"
import {createUseStyles} from "react-jss"

import DeploymentCard from "@/oss/components/DeploymentCard"
import DeploymentsDashboard from "@/oss/components/DeploymentsDashboard"
import {useAppsData} from "@/oss/contexts/app.context"
import {useAppId} from "@/oss/hooks/useAppId"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {JSSTheme} from "@/oss/lib/Types"
import {DeploymentRevisions} from "@/oss/lib/types_ee"
import {useEnvironments} from "@/oss/services/deployment/hooks/useEnvironments"
import {fetchAllDeploymentRevisions} from "@/oss/services/deploymentVersioning/api"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.marginLG,
    },
    title: {
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading4,
    },
}))

const DeploymentsPage = () => {
    const classes = useStyles()
    const [selectedEnv, setSelectedEnv] = useQueryParam("selectedEnvName", "development")

    const {currentApp} = useAppsData()
    const appId = useAppId()
    const {environments, isEnvironmentsLoading, mutate: loadEnvironments} = useEnvironments({appId})
    const {
        data,
        isLoading: isVariantLoading,
        mutate: loadVariants,
    } = useVariants(currentApp)({appId})

    const [isLoadingEnvRevisions, setIsLoadingEnvRevisions] = useState(false)
    const [envRevisions, setEnvRevisions] = useState<DeploymentRevisions>()

    const variants = useMemo(() => data?.variants || [], [data])

    const deployedVariant = useMemo(() => {
        return (
            (variants || []).find(
                (variant) => variant?.id === envRevisions?.deployed_app_variant_revision_id,
            ) || null
        )
    }, [variants, envRevisions?.deployed_app_variant_revision_id])

    const handleFetchAllDeploymentRevisions = async (envName: string) => {
        try {
            setIsLoadingEnvRevisions(true)
            setSelectedEnv(envName)
            const data = await fetchAllDeploymentRevisions(appId, envName)
            setEnvRevisions(data)
            loadEnvironments()
            loadVariants()
        } catch (error) {
            console.error("Error fetching deployment revisions:", error)
        } finally {
            setIsLoadingEnvRevisions(false)
        }
    }

    useEffect(() => {
        handleFetchAllDeploymentRevisions(selectedEnv)
    }, [])

    return (
        <Spin spinning={isLoadingEnvRevisions || isVariantLoading}>
            <div className={classes.container}>
                <Typography.Text className={classes.title}>Deployment</Typography.Text>

                <Flex align="center" gap={16}>
                    {environments.map((env, index) => {
                        const selectedDeployedVariant = variants?.find(
                            (variant) => variant?.id === env.deployed_app_variant_revision_id,
                        )

                        return (
                            <DeploymentCard
                                key={index}
                                onClick={() => handleFetchAllDeploymentRevisions(env.name)}
                                selectedDeployedVariant={selectedDeployedVariant}
                                env={env}
                                selectedEnv={selectedEnv}
                                loading={isEnvironmentsLoading}
                            />
                        )
                    })}
                </Flex>

                <DeploymentsDashboard
                    envRevisions={envRevisions}
                    variants={variants}
                    deployedVariant={deployedVariant}
                    handleFetchAllDeploymentRevisions={handleFetchAllDeploymentRevisions}
                />
            </div>
        </Spin>
    )
}

export default DeploymentsPage
