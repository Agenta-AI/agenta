import type {ComponentProps} from "react"
import {useMemo} from "react"

import {dayjs} from "@agenta/shared/utils"
import {EntityListItemLabel, VersionBadge} from "@agenta/ui/components/presentational"
import {Card, Space, Tag, Typography} from "antd"

import EnvironmentTagLabel from "@/oss/components/EnvironmentTagLabel"
import {Environment} from "@/oss/lib/Types"

import {useDeploymentCardStyles} from "./styles"

type DeploymentCardProps = {
    env: Environment
    selectedEnv?: string
} & ComponentProps<typeof Card>

const DeploymentCard = ({env, selectedEnv, ...props}: DeploymentCardProps) => {
    const classes = useDeploymentCardStyles()

    const hasDeployment = !!env.deployed_app_variant_revision_id

    const lastModifiedText = useMemo(() => {
        if (!env.updated_at) return "-"
        const d = dayjs.utc(env.updated_at)
        return d.isValid() ? d.local().format("MMM D, YYYY h:mm A") : "-"
    }, [env.updated_at])

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
                        label={env.deployed_variant_name || "-"}
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
