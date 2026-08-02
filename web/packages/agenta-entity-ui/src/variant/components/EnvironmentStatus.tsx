import {type FC} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import type {VariantStatusInfo} from "../types"

export const statusMap: Record<string, {badge: string}> = {
    production: {badge: "#73D13D"},
    staging: {badge: "#FF7A45"},
    development: {badge: "#9254DE"},
}

const EnvironmentStatus: FC<{
    /** `id` is optional — without it the revision-deployment fallback lookup is skipped */
    variant: Pick<VariantStatusInfo, "deployedIn"> & Partial<Pick<VariantStatusInfo, "id">>
    className?: string
}> = ({variant, className}) => {
    // Fallback to environment entity if deployedIn is not embedded on the variant
    const fallbackDeployedIn = useAtomValue(
        environmentMolecule.atoms.revisionDeployment(variant?.id || ""),
    )

    const deployedIn =
        (Array.isArray(variant.deployedIn) && variant.deployedIn.length > 0
            ? variant.deployedIn
            : fallbackDeployedIn) || []

    return (
        <TooltipProvider>
            <div className={clsx(["environment-badges ml-1 flex items-center gap-2", className])}>
                {deployedIn.map((env) => {
                    return (
                        <Tooltip key={env.name}>
                            <TooltipTrigger asChild>
                                <div>
                                    {/* antd Badge status dot: 6px (measured), -1px optical lift. */}
                                    <span
                                        title={env.name}
                                        className="relative -top-px inline-block size-1.5 rounded-full align-middle"
                                        style={{
                                            backgroundColor:
                                                statusMap[env.name]?.badge ?? "transparent",
                                        }}
                                    />
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>{env.name}</TooltipContent>
                        </Tooltip>
                    )
                })}
            </div>
        </TooltipProvider>
    )
}

export default EnvironmentStatus
