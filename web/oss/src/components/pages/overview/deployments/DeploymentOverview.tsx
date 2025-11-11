import {useEffect} from "react"

import {Skeleton, Typography} from "antd"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import DeploymentCard from "@/oss/components/DeploymentCard"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {Environment, JSSTheme} from "@/oss/lib/Types"

const {Title} = Typography

interface DeploymentOverviewProps {
    variants: EnhancedVariant[]
    isDeploymentLoading: boolean
    environments: Environment[]
    loadEnvironments: () => Promise<void>
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.paddingXS,
        "& > h1.ant-typography": {
            fontSize: theme.fontSize,
        },
    },
    cardContainer: {
        display: "flex",
        gap: theme.padding,
    },
}))

const DeploymentOverview = ({
    variants,
    isDeploymentLoading,
    environments,
    loadEnvironments,
}: DeploymentOverviewProps) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    useEffect(() => {
        if (!appId) return
        loadEnvironments()
    }, [appId, loadEnvironments])

    return (
        <div className={classes.container}>
            <Title>Deployment</Title>

            {isDeploymentLoading ? (
                <div className="flex gap-2">
                    {Array.from({length: 3}).map((_, index) => (
                        <Skeleton key={index} />
                    ))}
                </div>
            ) : (
                <div className={classes.cardContainer}>
                    {environments.map((env, index) => {
                        const selectedDeployedVariant = variants?.find(
                            (variant) => variant?.id === env.deployed_app_variant_revision_id,
                        )

                        return (
                            <DeploymentCard
                                key={index}
                                onClick={() => {
                                    router.push({
                                        pathname: `/apps/${appId}/deployments`,
                                        query: {
                                            selectedEnvName: env.name,
                                        },
                                    })
                                }}
                                selectedDeployedVariant={selectedDeployedVariant}
                                env={env}
                            />
                        )
                    })}
                </div>
            )}
        </div>
    )
}

export default DeploymentOverview
