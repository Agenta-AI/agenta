import {useSetAtom} from "jotai"

import {updateVariantPropertyEnhancedMutationAtom} from "../../state/atoms"

/**
 * @deprecated Prefer prompts-only facade or direct atom usage.
 *
 * - For prompts (variant) properties with known revisionId+propertyId, use `usePromptProperty`:
 *   `const { value, setValue } = usePromptProperty({ revisionId, propertyId })`
 *
 * - For generic/advanced updates where facade can't be used, call the centralized atom directly:
 *   `const update = useSetAtom(updateVariantPropertyEnhancedMutationAtom)`
 *
 * This hook remains for backward compatibility but will be removed after migration.
 */
export const usePlaygroundMutations = () => {
    const updateVariantProperty = useSetAtom(updateVariantPropertyEnhancedMutationAtom)

    return {
        updateVariantProperty,
    }
}
