import {EnvironmentTag, environmentColors} from "@agenta/ui"
import {Card, Skeleton, Space, Typography} from "antd"

import {useDeploymentCardStyles} from "./styles"

export const DEPLOYMENT_SKELETON_ENVIRONMENTS = ["Development", "Staging", "Production"]

interface DeploymentCardSkeletonProps {
    envName: string
    isSelected?: boolean
}

const DeploymentCardSkeleton = ({envName, isSelected}: DeploymentCardSkeletonProps) => {
    const classes = useDeploymentCardStyles()
    const borderColor =
        environmentColors[envName.toLowerCase() as keyof typeof environmentColors]?.textColor

    return (
        <Card
            className={classes.deploymentCard}
            style={{
                borderColor: isSelected ? borderColor : undefined,
                // @ts-ignore -- custom CSS variable consumed in styles
                "--hover-border-color": borderColor,
            }}
        >
            <EnvironmentTag environment={envName} />

            <Space className="justify-between">
                <Typography.Text>Variant</Typography.Text>
                <Skeleton.Button active size="small" style={{width: 140}} shape="round" />
            </Space>

            <Space className="justify-between">
                <Typography.Text>Last modified</Typography.Text>
                <Skeleton.Button active size="small" style={{width: 110}} shape="round" />
            </Space>
        </Card>
    )
}

export default DeploymentCardSkeleton
