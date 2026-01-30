import {ossAppRevisionMolecule} from "@agenta/entities/ossAppRevision"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {currentAppContextAtom} from "@/oss/state/app/selectors/app"
import {requestSchemaMetaAtomFamily} from "@/oss/state/newPlayground/core/requestSchemaMeta"

import {getEnhancedRevisionById} from "../../variant/atoms/fetcher"

export interface VariantFlagsParams {
    revisionId: string
    routePath?: string
}

const resolveRevisionSource = (get: any, revisionId: string) => {
    const serverData = get(ossAppRevisionMolecule.atoms.serverData(revisionId)) as any
    if (serverData) return serverData

    const moleculeData = get(ossAppRevisionMolecule.atoms.data(revisionId)) as any
    if (moleculeData) return moleculeData

    return getEnhancedRevisionById(get as any, revisionId)
}

export const variantFlagsAtomFamily = atomFamily((params: VariantFlagsParams) =>
    atom((get) => {
        const {routePath, revisionId} = params
        const variant = resolveRevisionSource(get, revisionId) as any
        const meta = get(requestSchemaMetaAtomFamily({variant, routePath}))
        const appType = get(currentAppContextAtom)?.appType || undefined
        const isChat = appType ? appType === "chat" : Boolean(meta?.hasMessages)

        const isCustom = (get(currentAppContextAtom)?.appType || undefined) === "custom"

        return {isChat, isCustom}
    }),
)
