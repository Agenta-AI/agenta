/**
 * Property-level atom selectors (residual)
 * Focused, high-signal selectors that remain after modularization.
 */

import isEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import {revisionListAtom} from "./variants"

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
