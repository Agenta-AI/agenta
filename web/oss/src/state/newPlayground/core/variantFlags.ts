import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {currentAppContextAtom} from "@/oss/state/newApps/selectors/apps"
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

        const isCustom = (get(currentAppContextAtom)?.appType || undefined) === "custom"

        return {isChat, isCustom}
    }),
)
