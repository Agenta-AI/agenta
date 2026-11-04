import {useMemo} from "react"

import {appEnvironmentsLoadableAtomFamily} from "@agenta/entities/environment"
import {workflowVariantsListDataAtomFamily} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

/**
 * The environments of one app with the variant each one deploys. The deployment stores the
 * variant name it had at deploy time, so the cards take the current name from the variant list
 * and a renamed variant shows its new name.
 */
export const useAppEnvironments = (appId: string) => {
    const storedEnvironments = useAtomValue(appEnvironmentsLoadableAtomFamily(appId))
    const variants = useAtomValue(workflowVariantsListDataAtomFamily(appId))
    const variantNames = useMemo(
        () =>
            new Map(
                variants.flatMap((variant) => {
                    const name = variant.name || variant.slug
                    return name ? [[variant.id, name] as const] : []
                }),
            ),
        [variants],
    )
    const environments = useMemo(
        () => ({
            ...storedEnvironments,
            data: storedEnvironments.data.map((entry) => ({
                ...entry,
                deployedVariantName:
                    (entry.deployedVariantId ? variantNames.get(entry.deployedVariantId) : null) ??
                    entry.deployedVariantName,
            })),
        }),
        [storedEnvironments, variantNames],
    )
    return {environments, variantNames}
}
