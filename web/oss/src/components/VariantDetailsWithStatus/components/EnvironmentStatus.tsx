import {type FC} from "react"

import {Badge, Space, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {Variant} from "@/oss/lib/shared/variant"
import {revisionDeploymentAtomFamily} from "@/oss/state/variant/atoms/fetcher"

export const statusMap: Record<string, {badge: string}> = {
    production: {badge: "#73D13D"},
    staging: {badge: "#FF7A45"},
    development: {badge: "#9254DE"},
}

const EnvironmentStatus: FC<{
    variant: Pick<Variant, "deployedIn"> & {id?: string}
    className?: string
}> = ({variant, className}) => {
    // Fallback to deployment atom if deployedIn is not embedded on the variant
    const fallbackDeployedIn = useAtomValue(
        revisionDeploymentAtomFamily((variant as any)?.id || ""),
    ) as any[]

    const deployedIn =
        (Array.isArray(variant.deployedIn) && variant.deployedIn.length > 0
            ? variant.deployedIn
            : fallbackDeployedIn) || []

    return (
        <Space className={clsx(["environment-badges", className])}>
            {deployedIn.map((env) => {
                return (
                    <Tooltip key={env.name} title={env.name}>
                        <div>
                            <Badge
                                color={statusMap[env.name]?.badge ?? "transparent"}
                                title={env.name}
                            />
                        </div>
                    </Tooltip>
                )
            })}
        </Space>
    )
}

export default EnvironmentStatus
