import {Card, CardContent} from "@agenta/primitive-ui/components/card"
import {EnvironmentTag, environmentColors} from "@agenta/ui"
import {Skeleton, Space} from "antd"

import {deploymentCardClass} from "./styles"

export const DEPLOYMENT_SKELETON_ENVIRONMENTS = ["Development", "Staging", "Production"]

interface DeploymentCardSkeletonProps {
    envName: string
    isSelected?: boolean
}

const DeploymentCardSkeleton = ({envName, isSelected}: DeploymentCardSkeletonProps) => {
    const borderColor =
        environmentColors[envName.toLowerCase() as keyof typeof environmentColors]?.textColor

    return (
        <Card
            className={deploymentCardClass}
            style={{
                borderColor: isSelected ? borderColor : undefined,
                // @ts-ignore -- custom CSS variable consumed in styles
                "--hover-border-color": borderColor,
            }}
        >
            <CardContent className="flex flex-col gap-2 p-3 [&>span:first-of-type]:capitalize">
                <EnvironmentTag environment={envName} />

                <Space className="justify-between">
                    <span>Variant</span>
                    <Skeleton.Button active size="small" style={{width: 140}} shape="round" />
                </Space>

                <Space className="justify-between">
                    <span>Last modified</span>
                    <Skeleton.Button active size="small" style={{width: 110}} shape="round" />
                </Space>
            </CardContent>
        </Card>
    )
}

export default DeploymentCardSkeleton
