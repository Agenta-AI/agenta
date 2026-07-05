import {type FC} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Space, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import type {VariantStatusInfo} from "../types"

export const statusMap: Record<string, {badge: string}> = {
    production: {badge: "#73D13D"},
    staging: {badge: "#FF7A45"},
    development: {badge: "#9254DE"},
}

export const statusVariantMap: Record<string, "success" | "warning" | "secondary"> = {
    production: "success",
    staging: "warning",
    development: "secondary",
}

const EnvironmentStatus: FC<{
    variant: Pick<VariantStatusInfo, "deployedIn" | "id">
    className?: string
}> = ({variant, className}) => {
    const fallbackDeployedIn = useAtomValue(
        environmentMolecule.atoms.revisionDeployment(variant?.id || ""),
    )

    const deployedIn =
        (Array.isArray(variant.deployedIn) && variant.deployedIn.length > 0
            ? variant.deployedIn
            : fallbackDeployedIn) || []

    return (
        <Space className={clsx(["environment-badges ml-1", className])}>
            {deployedIn.map((env) => {
                return (
                    <Tooltip key={env.name} title={env.name}>
                        <div>
                            <Badge
                                variant={statusVariantMap[env.name] ?? "secondary"}
                                dot
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
