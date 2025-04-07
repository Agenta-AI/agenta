import {type FC} from "react"

import {Badge, Space, Tooltip} from "antd"
import clsx from "clsx"

import {Variant} from "@/oss/lib/shared/variant"

export const statusMap: Record<string, {badge: string}> = {
    production: {badge: "#73D13D"},
    staging: {badge: "#FF7A45"},
    development: {badge: "#9254DE"},
}

const EnvironmentStatus: FC<{variant: Pick<Variant, "deployedIn">; className?: string}> = ({
    variant,
    className,
}) => {
    return (
        <Space className={clsx(["environment-badges", className])}>
            {(variant.deployedIn || []).map((env) => (
                <Tooltip key={env.name} title={env.name}>
                    <div>
                        <Badge
                            color={statusMap[env.name]?.badge ?? "transparent"}
                            title={env.name}
                        />
                    </div>
                </Tooltip>
            ))}
        </Space>
    )
}

export default EnvironmentStatus
