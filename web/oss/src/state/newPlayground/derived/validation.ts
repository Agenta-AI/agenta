import {atom} from "jotai"

import {playgroundConfigAtom} from "../core/config"
import type {DirtyState} from "../types"

import {selectedVariantRequestBodyAtom, displayedVariantsRequestBodiesAtom} from "./requestBody"

/**
 * Validation and Dirty State Atoms
 *
 * These atoms handle dirty state detection and validation.
 * Optimized equality checks comparing derived vs original revision state.
 */

// Check if a variant is dirty (modified from original revision)
export const isVariantDirtyAtom = atom(null, (get, set, variantId: string): DirtyState => {
    const config = get(playgroundConfigAtom)
    const variant = config.variants[variantId]

    if (!variant) {
        return {
            variantId,
            isDirty: false,
            changes: [],
        }
    }

    // If no original revision, it's a new variant (dirty)
    if (!variant.metadata.originalRevisionId) {
        return {
            variantId,
            isDirty: true,
            changes: ["New variant"],
        }
    }

    // TODO: Compare with original revision from revisions atom
    // For now, check if updatedAt > createdAt
    const isDirty = variant.metadata.updatedAt > variant.metadata.createdAt

    return {
        variantId,
        isDirty,
        changes: isDirty ? ["Modified"] : [],
    }
})

// Check if selected variant is dirty
export const isSelectedVariantDirtyAtom = atom((get) => {
    const config = get(playgroundConfigAtom)
    if (!config.selectedVariantId) return false

    const dirtyCheck = get(isVariantDirtyAtom)
    return dirtyCheck ? dirtyCheck.isDirty : false
})

// Check if any displayed variant is dirty
export const hasAnyDirtyVariantAtom = atom((get) => {
    const config = get(playgroundConfigAtom)
    const dirtyCheck = get(isVariantDirtyAtom)

    return config.displayedVariantIds.some((variantId) => {
        const result = dirtyCheck ? dirtyCheck : {isDirty: false}
        return result.isDirty
    })
})

// Validate selected variant configuration
export const selectedVariantValidationAtom = atom((get) => {
    const requestBodyData = get(selectedVariantRequestBodyAtom)

    if (!requestBodyData) {
        return {
            isValid: false,
            errors: ["No variant selected"],
            warnings: [],
        }
    }

    const errors: string[] = []
    const warnings: string[] = []

    // Add validation errors from request body transformation
    errors.push(...requestBodyData.validationErrors)

    // Additional validation rules
    if (requestBodyData.requestBody) {
        const {requestBody} = requestBodyData

        // Chat variant validation
        if (Array.isArray(requestBody.messages)) {
            if (requestBody.messages.length === 0) {
                warnings.push("No messages defined")
            }

            const hasUserMessage = requestBody.messages.some((msg: any) => msg.role === "user")
            if (!hasUserMessage) {
                errors.push("At least one user message is required")
            }
        }

        // Completion variant validation
        if (typeof requestBody.prompt === "string") {
            if (!requestBody.prompt.trim()) {
                errors.push("Prompt cannot be empty")
            }
        }

        // Parameters validation
        if (requestBody.parameters) {
            const params = requestBody.parameters

            if (params.temperature !== undefined) {
                if (params.temperature < 0 || params.temperature > 2) {
                    warnings.push("Temperature should be between 0 and 2")
                }
            }

            if (params.max_tokens !== undefined) {
                if (params.max_tokens < 1) {
                    errors.push("Max tokens must be greater than 0")
                }
            }
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    }
})

// Validate all displayed variants
export const allVariantsValidationAtom = atom((get) => {
    const requestBodies = get(displayedVariantsRequestBodiesAtom)

    return requestBodies.map((requestBodyData) => {
        const errors: string[] = []
        const warnings: string[] = []

        if (!requestBodyData.isValid) {
            errors.push(...requestBodyData.validationErrors)
        }

        // Same validation logic as above but for each variant
        if (requestBodyData.requestBody) {
            const {requestBody} = requestBodyData

            if (Array.isArray(requestBody.messages)) {
                if (requestBody.messages.length === 0) {
                    warnings.push("No messages defined")
                }

                const hasUserMessage = requestBody.messages.some((msg: any) => msg.role === "user")
                if (!hasUserMessage) {
                    errors.push("At least one user message is required")
                }
            }

            if (typeof requestBody.prompt === "string" && !requestBody.prompt.trim()) {
                errors.push("Prompt cannot be empty")
            }
        }

        return {
            variantId: requestBodyData.variantId,
            isValid: errors.length === 0,
            errors,
            warnings,
        }
    })
})
