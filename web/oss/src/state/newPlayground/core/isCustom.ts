import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {customPropertiesAtomFamily} from "@/oss/state/newPlayground/core/customProperties"

export interface IsCustomParams {
    variant: EnhancedVariant
    appType?: string
    routePath?: string
    revisionId?: string
}

export const isCustomAtomFamily = atomFamily((params: IsCustomParams) =>
    atom((get) => {
        const appType = params.appType
        // Read custom (non-prompt) properties derived from spec or local cache
        const customProps = get(
            customPropertiesAtomFamily({
                variant: params.variant,
                routePath: params.routePath,
                revisionId: params.revisionId,
            }),
        )
        const hasCustomProps = !!customProps && Object.keys(customProps).length > 0
        return appType === "custom" || hasCustomProps
    }),
)
