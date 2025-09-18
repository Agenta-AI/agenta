/**
 * Property-level atom selectors (residual)
 * Focused, high-signal selectors that remain after modularization.
 */

import isEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import {appTypeAtom} from "./app"
import {revisionListAtom} from "./variants"

// Chat-related selectors are in generationProperties.ts. This file keeps only lightweight, generic selectors.

/**
 * Optimized chat detection selector
 * Returns a boolean derived from revision metadata: isChatVariant || isChat
 */
export const isChatVariantAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        // App-level determination; ignore per-revision computation
        const appType = get(appTypeAtom)
        return appType === "chat"
    }),
)

/**
 * Atom family for selecting a variant by revision ID
 * Provides optimized access to variant data using revision ID as key
 * Used throughout the app for variant-specific operations
 */
export const variantByRevisionIdAtomFamily = atomFamily((revisionId: string) =>
    selectAtom(
        atom((get) => get(revisionListAtom) || []),
        (revisions) => revisions.find((r: any) => r.id === revisionId) || null,
        isEqual,
    ),
)
