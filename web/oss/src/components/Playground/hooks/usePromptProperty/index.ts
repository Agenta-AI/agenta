import {useAtom, useAtomValue} from "jotai"

import {promptPropertyAtomFamily} from "../../state/atoms"

/**
 * usePromptProperty
 * Prompts-only read/write for a given revisionId (variant revision) and propertyId.
 * Reads from promptsAtomFamily and writes via updateVariantPropertyEnhancedMutationAtom.
 */
export const usePromptProperty = (params: {revisionId: string; propertyId: string}) => {
    const value = useAtomValue(promptPropertyAtomFamily(params))
    const [_, setValue] = useAtom(promptPropertyAtomFamily(params))
    return {value, setValue}
}
