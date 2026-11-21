import {type FC} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {useT} from "@agenta/i18n"
import variantCatalog from "@agenta/i18n/catalogs/entityUi.variant"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import type {VariantStatusInfo} from "../types"

// The dot takes each environment's saturated tag tone (palette.ts `environmentTag`), not a
// separate hue — same semantic, so the badge and the environment tag can never disagree.
export const statusMap: Record<string, {badge: string}> = {
    production: {badge: "var(--ag-env-production-text)"},
    staging: {badge: "var(--ag-env-staging-text)"},
    development: {badge: "var(--ag-env-development-text)"},
}

const EnvironmentStatus: FC<{
    /** `id` is optional — without it the revision-deployment fallback lookup is skipped */
    variant: Pick<VariantStatusInfo, "deployedIn"> & Partial<Pick<VariantStatusInfo, "id">>
    className?: string
}> = ({variant, className}) => {
    const t = useT(variantCatalog)
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
                                        role="img"
                                        aria-label={t("entityUi.variant.deployedTo", {
                                            name: env.name,
                                        })}
                                        className="relative -top-px inline-block size-1.5 rounded-full align-middle"
                                        style={{
                                            backgroundColor:
                                                statusMap[env.name]?.badge ?? "transparent",
                                        }}
                                    />
                                </div>
                            </TooltipTrigger>
                            <TooltipContent>
                                {t("entityUi.variant.deployedTo", {name: env.name})}
                            </TooltipContent>
                        </Tooltip>
                    )
                })}
            </div>
        </TooltipProvider>
    )
}

export default EnvironmentStatus
