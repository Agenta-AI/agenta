import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {currentAppContextAtom} from "@/oss/state/newApps/selectors/apps"
import {customPropertiesAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {requestSchemaMetaAtomFamily} from "@/oss/state/newPlayground/core/requestSchemaMeta"

import {getEnhancedRevisionById} from "../../variant/atoms/fetcher"

export interface VariantFlagsParams {
    revisionId: string
    routePath?: string
}

export const variantFlagsAtomFamily = atomFamily((params: VariantFlagsParams) =>
    atom((get) => {
        const {routePath, revisionId} = params
        const variant = getEnhancedRevisionById(get as any, revisionId) as any
        const meta = get(requestSchemaMetaAtomFamily({variant, routePath}))
        const appType = get(currentAppContextAtom)?.appType || undefined
        const isChat = appType ? appType === "chat" : Boolean(meta?.hasMessages)

        // Derive isCustom from appType + custom properties presence
        const customProps = get(customPropertiesAtomFamily({variant, routePath, revisionId}))
        const hasCustomProps = !!customProps && Object.keys(customProps).length > 0
        const isCustom =
            (get(currentAppContextAtom)?.appType || undefined) === "custom" || hasCustomProps

        return {isChat, isCustom}
    }),
)
