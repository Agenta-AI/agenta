import isEqual from "lodash/isEqual"
import type {InitialStateType, StateVariant} from "../../../state/types"
import {accessKeyInVariant} from "../../../assets/helpers"

export const findVariantById = (
    state: InitialStateType | undefined,
    variantId: string,
): StateVariant | undefined => state?.variants?.find((v) => v.variantId === variantId)

export const compareVariants = (
    variantsA: StateVariant[] = [],
    variantsB: StateVariant[] = [],
): boolean => {
    const keysA = variantsA.map((v) => v.variantId)
    const keysB = variantsB.map((v) => v.variantId)
    return keysA.length === keysB.length && keysA.every((key) => keysB.includes(key))
}

export const compareVariantConfig = (
    variantA: StateVariant | undefined,
    variantB: StateVariant | undefined,
    configKey: string,
): boolean => {
    if (!variantA || !variantB) return variantA === variantB

    const paramsA = accessKeyInVariant(configKey, variantA)
    const paramsB = accessKeyInVariant(configKey, variantB)
    return isEqual(paramsA, paramsB)
}

export const createBaseCompare = (
    customCompare?: (a?: InitialStateType, b?: InitialStateType) => boolean,
) => {
    return (a?: InitialStateType, b?: InitialStateType): boolean => {
        if (!a || !b) return false
        if (customCompare) return customCompare(a, b)
        return isEqual(a, b)
    }
}

export const createVariantCompare = (
    customCompare?: (a?: InitialStateType, b?: InitialStateType) => boolean,
) => {
    return (a?: InitialStateType, b?: InitialStateType): boolean => {
        const test = () => {
            const variantsA = a?.variants
            const variantsB = b?.variants

            if (!!variantsA && !!variantsB && !isEqual(variantsA, variantsB)) {
                const keysA = variantsA.map((v) => v.variantId)
                const keysB = variantsB.map((v) => v.variantId)

                return keysA.length === keysB.length && keysA.every((key) => keysB.includes(key))
            }
            return isEqual(a, b)
        }

        return customCompare ? customCompare(a, b) : test()
    }
}

export const compareVariant = (
    a: InitialStateType | undefined,
    b: InitialStateType | undefined,
    variantId: string,
    customCompare?: (a?: InitialStateType, b?: InitialStateType) => boolean,
    configKey?: string,
): boolean => {
    const variantA = findVariantById(a, variantId)
    const variantB = findVariantById(b, variantId)

    if (!!variantA && !!variantB && !isEqual(variantA, variantB)) {
        if (configKey) {
            return compareVariantConfig(variantA, variantB, configKey)
        }
        return isEqual(variantA, variantB)
    }
    return createBaseCompare(customCompare)(a, b)
}
