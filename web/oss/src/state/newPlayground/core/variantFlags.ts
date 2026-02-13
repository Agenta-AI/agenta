import {runnableAtoms} from "@agenta/entities/legacyAppRevision"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {currentAppContextAtom} from "@/oss/state/app/selectors/app"

export interface VariantFlagsParams {
    revisionId: string
    routePath?: string
}

export const variantFlagsAtomFamily = atomFamily((params: VariantFlagsParams) =>
    atom((get) => {
        const {revisionId} = params
        const appContext = get(currentAppContextAtom)
        const appType = appContext?.appType || undefined

        // Use schema-derived isChatVariant (per-revision),
        // with app-level appType as an authoritative override when available
        const isChatFromSchema = get(runnableAtoms.isChatVariant(revisionId))
        const isChat = appType ? appType === "chat" : isChatFromSchema

        const isCustom = appType === "custom"

        return {isChat, isCustom}
    }),
)
