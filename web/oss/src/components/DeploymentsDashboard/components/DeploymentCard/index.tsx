import type {ComponentProps} from "react"
import {useMemo} from "react"

import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {dayjs} from "@agenta/shared/utils"
import {EntityListItemLabel, VersionBadge} from "@agenta/ui/components/presentational"
import {Card, Space, Tag, Typography} from "antd"

import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"

import {useDeploymentCardStyles} from "./styles"

type DeploymentCardProps = {
    env: AppEnvironmentDeployment
    selectedEnv?: string
} & ComponentProps<typeof Card>

const DeploymentCard = ({env, selectedEnv, ...props}: DeploymentCardProps) => {
    const classes = useDeploymentCardStyles()

    const hasDeployment = !!env.deployedRevisionId

    const lastModifiedText = useMemo(() => {
        if (!hasDeployment || !env.updatedAt) return "-"
        const d = dayjs.utc(env.updatedAt)
        return d.isValid() ? d.local().format("MMM D, YYYY h:mm A") : "-"
    }, [hasDeployment, env.updatedAt])

    return (
        <Card
            className={classes.deploymentCard}
            style={{
                borderColor: selectedEnv === env.name ? "#1C2C3D" : undefined,
            }}
            {...props}
        >
            <EnvironmentTagLabel environment={env.name} />

            <Space className="justify-between">
                <Typography.Text>Variant</Typography.Text>
                {hasDeployment ? (
                    <EntityListItemLabel
                        label={env.deployedVariantName || "-"}
                        trailing={
                            env.revision != null ? (
                                <VersionBadge
                                    version={Number(env.revision)}
                                    variant="chip"
                                    size="small"
                                />
                            ) : undefined
                        }
                    />
                ) : (
                    <Tag onClick={(e) => e.stopPropagation()}>No deployment</Tag>
                )}
            </Space>
            <Space className="justify-between">
                <Typography.Text>Last modified</Typography.Text>
                <Typography.Text>{lastModifiedText}</Typography.Text>
            </Space>
        </Card>
    )
}

export default DeploymentCard

export {default as DeploymentCardSkeleton, DEPLOYMENT_SKELETON_ENVIRONMENTS} from "./skeleton"
