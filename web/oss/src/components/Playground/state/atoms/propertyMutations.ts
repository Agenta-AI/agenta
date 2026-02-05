import {atom} from "jotai"

import {moleculePropertyUpdateAtom} from "@/oss/state/newPlayground/legacyEntityBridge"

import type {EnhancedVariantPropertyMutationParams} from "../types"

import {selectedVariantsAtom} from "./core"
import {revisionListAtom} from "./variants"

// Re-export the type for external use
export type {ConfigValue} from "../types"

/**
 * Enhanced Variant Property Mutations
 *
 * These mutations route property updates through the legacyAppRevision molecule,
 * which serves as the single source of truth for revision state.
 *
 * Flow:
 * 1. Resolve target revision ID from variantId
 * 2. Route update to molecule.reducers.updateProperty via moleculePropertyUpdateAtom
 */

/**
 * Parameter update mutation with fallback handling
 * This atom handles parameter updates with proper fallback logic for missing IDs
 * Eliminates the need for React-level useCallback wrappers
 */
export const parameterUpdateMutationAtom = atom(
    null,
    (
        get,
        set,
        params: {
            event: {target: {value: any}} | any
            propertyId?: string
            variantId?: string
            fallbackVariantId?: string
            fallbackPropertyId?: string
        },
    ) => {
        const {event, propertyId, variantId, fallbackVariantId, fallbackPropertyId} = params
        const value =
            event && typeof event === "object" && "target" in event ? event.target.value : event

        const targetVariantId = variantId || fallbackVariantId
        const targetPropertyId = propertyId || fallbackPropertyId

        if (targetVariantId && targetPropertyId) {
            // Use the existing enhanced mutation directly
            set(updateVariantPropertyEnhancedMutationAtom, {
                variantId: targetVariantId,
                propertyId: targetPropertyId,
                value,
            })
        } else {
            console.warn("[Params][Mut][ENTRY] Missing IDs for parameter update", {
                targetVariantId,
                targetPropertyId,
            })
        }
    },
)

/**
 * Enhanced property update mutation that routes updates through the molecule.
 *
 * This mutation:
 * 1. Resolves the target revision ID from variantId
 * 2. Routes update to molecule.reducers.updateProperty (single source of truth)
 */
export const updateVariantPropertyEnhancedMutationAtom = atom(
    null,
    (get, set, params: EnhancedVariantPropertyMutationParams) => {
        const {variantId: rawVariantId, propertyId, value} = params

        // Handle case where variantId might be an object instead of string
        const variantId =
            typeof rawVariantId === "string" ? rawVariantId : (rawVariantId as any)?.id

        if (process.env.NODE_ENV === "development") {
            console.debug("[Params][Mut] start", {variantId, propertyId, value})
        }
        if (!variantId) {
            if (process.env.NODE_ENV === "development") {
                console.warn("No valid variantId provided:", rawVariantId)
            }
            return
        }

        // Resolve target revisionId for this update
        const revisions = get(revisionListAtom)

        // If provided id matches a revision id, use it directly; otherwise find latest/selected for the variant
        let targetRevisionId: string | null = null
        const idStr = String(variantId)
        const directMatch = revisions.find((r: any) => r.id === idStr)

        if (process.env.NODE_ENV === "development") {
            console.debug("[Params][Mut] directMatch", {directMatch: !!directMatch})
        }
        if (directMatch) {
            targetRevisionId = directMatch.id
            if (process.env.NODE_ENV === "development") {
                console.debug("[Params][Mut] use direct revision id", {targetRevisionId})
            }
        } else {
            // Try to find currently displayed/selected revision for this variant
            const selected = get(selectedVariantsAtom)
            const selectedMatch = revisions.find(
                (r: any) => selected.includes(r.id) && r.variantId === idStr,
            )
            if (process.env.NODE_ENV === "development") {
                console.debug("[Params][Mut] selectedMatch", {selectedMatch: !!selectedMatch})
            }
            if (selectedMatch) {
                targetRevisionId = selectedMatch.id
                if (process.env.NODE_ENV === "development") {
                    console.debug("[Params][Mut] selected revision id", {targetRevisionId})
                }
            } else {
                // Fallback to newest revision of the variant
                const newest = revisions
                    .filter((r: any) => r.variantId === idStr)
                    .sort((a: any, b: any) => b.updatedAtTimestamp - a.updatedAtTimestamp)[0]
                targetRevisionId = newest ? newest.id : null
                if (process.env.NODE_ENV === "development") {
                    console.debug("[Params][Mut] fallback newest revision", {targetRevisionId})
                }
            }
        }

        if (!targetRevisionId) {
            if (process.env.NODE_ENV === "development") {
                console.debug("[Params][Mut] no targetRevisionId resolved; abort")
            }
            if (process.env.NODE_ENV === "development") {
                console.warn("No target revision resolved for variant:", variantId)
            }
            return
        }

        // Route update through molecule (single source of truth)
        if (process.env.NODE_ENV === "development") {
            console.debug("[Params][Mut] Using molecule for update", {
                targetRevisionId,
                propertyId,
            })
        }

        set(moleculePropertyUpdateAtom, {
            revisionId: targetRevisionId,
            propertyId,
            value,
        })

        if (process.env.NODE_ENV === "development") {
            console.debug("[Params][Mut] Updated via molecule", {propertyId, value})
        }
    },
)
