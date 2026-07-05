import type {ComponentProps} from "react"
import {useMemo} from "react"

import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {dayjs} from "@agenta/shared/utils"
import {EnvironmentTag} from "@agenta/ui"
import {EntityListItemLabel, VersionBadge} from "@agenta/ui/components/presentational"
import {Card, Space} from "antd"

import {deploymentCardClass} from "./styles"

type DeploymentCardProps = {
    env: AppEnvironmentDeployment
    selectedEnv?: string
} & ComponentProps<typeof Card>

const DeploymentCard = ({env, selectedEnv, ...props}: DeploymentCardProps) => {
    const hasDeployment = !!env.deployedRevisionId

    const lastModifiedText = useMemo(() => {
        if (!hasDeployment || !env.updatedAt) return "-"
        const d = dayjs.utc(env.updatedAt)
        return d.isValid() ? d.local().format("MMM D, YYYY h:mm A") : "-"
    }, [hasDeployment, env.updatedAt])

    return (
        <Card
            className={deploymentCardClass}
            style={{
                borderColor: selectedEnv === env.name ? "#1C2C3D" : undefined,
            }}
            {...props}
        >
            <EnvironmentTag environment={env.name} />

            <Space className="justify-between">
                <span>Variant</span>
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
                    <Badge onClick={(e) => e.stopPropagation()} variant="secondary">
                        No deployment
                    </Badge>
                )}
            </Space>
            <Space className="justify-between">
                <span>Last modified</span>
                <span>{lastModifiedText}</span>
            </Space>
        </Card>
    )
}

export default DeploymentCard

export {default as DeploymentCardSkeleton, DEPLOYMENT_SKELETON_ENVIRONMENTS} from "./skeleton"
