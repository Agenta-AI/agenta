import {EnhancedVariant} from "../../../state/types"
import {findPropertyInObject} from "../assets/helpers"

/**
 * Pure function to find a property by ID in a variant's prompts or inputs
 * TODO: IMPROVE PERFORMANCE
 */
export const findPropertyById = (variant: EnhancedVariant, propertyId?: string) => {
    if (!propertyId || !variant) return undefined

    // Search in prompts
    for (const prompt of variant.prompts || []) {
        const found = findPropertyInObject(prompt, propertyId)
        if (found) return found
    }

    const found = findPropertyInObject(variant.customProperties, propertyId)
    if (found) return found

    return undefined
}
