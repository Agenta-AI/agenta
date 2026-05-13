/**
 * EvalRunDetails Reference Atoms
 *
 * Thin wrappers around entity-backed reference atoms from the shared References module.
 * These wrappers auto-resolve projectId from effectiveProjectIdAtom so consumers
 * can pass a single ID parameter (preserving the existing API).
 *
 * No separate API calls are made — all data comes from entity molecules
 * that are already fetched and cached.
 */

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {
    appReferenceAtomFamily,
    variantReferenceAtomFamily,
    previewTestsetReferenceAtomFamily,
} from "@/oss/components/References/atoms/entityReferences"

import {effectiveProjectIdAtom} from "./run"

// Re-export reference types for consumers
export type {AppReference as ApplicationReference} from "@/oss/components/References/atoms/entityReferences"
export type {VariantReference} from "@/oss/components/References/atoms/entityReferences"
export type {TestsetReference} from "@/oss/components/References/atoms/entityReferences"

// ─────────────────────────────────────────────────────────────────────────────
// Application Reference (backed by workflowsListQueryStateAtom)
// ─────────────────────────────────────────────────────────────────────────────

export const applicationReferenceQueryAtomFamily = atomFamily((appId: string | null | undefined) =>
    atom((get) => {
        const projectId = get(effectiveProjectIdAtom)
        return get(appReferenceAtomFamily({projectId, appId}))
    }),
)

// ─────────────────────────────────────────────────────────────────────────────
// Variant Reference (backed by workflowMolecule)
// ─────────────────────────────────────────────────────────────────────────────

export const variantReferenceQueryAtomFamily = atomFamily((variantId: string | null | undefined) =>
    atom((get) => {
        const projectId = get(effectiveProjectIdAtom)
        return get(variantReferenceAtomFamily({projectId, variantId}))
    }),
)

// ─────────────────────────────────────────────────────────────────────────────
// Testset Reference (backed by testsetQueryAtomFamily)
// ─────────────────────────────────────────────────────────────────────────────

export const testsetReferenceQueryAtomFamily = atomFamily((testsetId: string | null | undefined) =>
    atom((get) => {
        const projectId = get(effectiveProjectIdAtom)
        return get(previewTestsetReferenceAtomFamily({projectId, testsetId}))
    }),
)
