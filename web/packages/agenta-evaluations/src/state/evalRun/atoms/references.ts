/**
 * EvalRunDetails Reference Atoms
 *
 * Thin wrappers around entity-backed reference resolvers, injected by the OSS `-ui` layer
 * via `injectedReferenceResolverAtom` (the App / Variant / Testset reference families from
 * `@/oss/components/References/atoms/entityReferences`). These wrappers auto-resolve
 * projectId from `effectiveProjectIdAtom` so consumers can pass a single ID parameter
 * (preserving the existing API).
 *
 * No separate API calls are made — all data comes from entity molecules that are already
 * fetched and cached. When the resolver seam is not registered, the atoms degrade to an
 * empty (non-erroring) query envelope.
 */

import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {
    injectedReferenceResolverAtom,
    type ReferenceQueryResult,
    type InjectedAppReference,
    type InjectedVariantReference,
    type InjectedTestsetReference,
} from "../../evalRunInjection"

import {effectiveProjectIdAtom} from "./run"

// Re-export reference types for consumers (aliased to the legacy names).
export type {InjectedAppReference as ApplicationReference} from "../../evalRunInjection"
export type {InjectedVariantReference as VariantReference} from "../../evalRunInjection"
export type {InjectedTestsetReference as TestsetReference} from "../../evalRunInjection"

const emptyReference = <T>(): ReferenceQueryResult<T> => ({
    data: null,
    isPending: false,
    isFetching: false,
    isLoading: false,
    isError: false,
})

// ─────────────────────────────────────────────────────────────────────────────
// Application Reference (backed by workflowsListQueryStateAtom)
// ─────────────────────────────────────────────────────────────────────────────

export const applicationReferenceQueryAtomFamily = atomFamily((appId: string | null | undefined) =>
    atom((get): ReferenceQueryResult<InjectedAppReference> => {
        const resolver = get(injectedReferenceResolverAtom)
        if (!resolver) return emptyReference<InjectedAppReference>()
        const projectId = get(effectiveProjectIdAtom)
        return get(resolver.appReferenceAtomFamily({projectId, appId}))
    }),
)

// ─────────────────────────────────────────────────────────────────────────────
// Variant Reference (backed by workflowMolecule)
// ─────────────────────────────────────────────────────────────────────────────

export const variantReferenceQueryAtomFamily = atomFamily((variantId: string | null | undefined) =>
    atom((get): ReferenceQueryResult<InjectedVariantReference> => {
        const resolver = get(injectedReferenceResolverAtom)
        if (!resolver) return emptyReference<InjectedVariantReference>()
        const projectId = get(effectiveProjectIdAtom)
        return get(resolver.variantReferenceAtomFamily({projectId, variantId}))
    }),
)

// ─────────────────────────────────────────────────────────────────────────────
// Testset Reference (backed by testsetQueryAtomFamily)
// ─────────────────────────────────────────────────────────────────────────────

export const testsetReferenceQueryAtomFamily = atomFamily((testsetId: string | null | undefined) =>
    atom((get): ReferenceQueryResult<InjectedTestsetReference> => {
        const resolver = get(injectedReferenceResolverAtom)
        if (!resolver) return emptyReference<InjectedTestsetReference>()
        const projectId = get(effectiveProjectIdAtom)
        return get(resolver.previewTestsetReferenceAtomFamily({projectId, testsetId}))
    }),
)
