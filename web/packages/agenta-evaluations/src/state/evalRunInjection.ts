/**
 * @agenta/evaluations/state — eval-run injection seam.
 *
 * The eval-run runtime atoms (relocated in WP-4e-2) depend on a handful of app-wide,
 * OSS-state-coupled values that cannot live in the headless package: the workspace member
 * list, the testcase entity query family, the App/Variant/Testset reference resolvers, and
 * two imperative cache-invalidation callbacks. Rather than import `@/oss/*` (forbidden in
 * this package), the package exposes PRIMITIVE injection atoms with safe defaults; the OSS
 * `-ui` layer populates them once at boot via `registerEvalRunInjections`, and the runtime
 * atoms read the injected values reactively.
 *
 * VIEW-only seams (run-list / run-details app-state, routing, query, reference, and
 * onboarding values) live in `@agenta/evaluations-ui` (`host/runViewInjection.ts`) — they
 * are pure VIEW concerns and the headless package carries only the seams its runtime atoms
 * actually read.
 */
import {atom, type Atom, type WritableAtom} from "jotai"

import type {AnnotationDto, AnnotationResponseDto} from "./evalRun/atoms/annotationTypes"

// ─────────────────────────────────────────────────────────────────────────────
// Injected shape: workspace members
//
// Mirrors `WorkspaceMember` from `@/oss/lib/Types` (read via
// `@/oss/state/workspace/atoms/selectors` `workspaceMembersAtom`). Defined locally as a
// minimal, structurally-compatible shape — the eval-run annotation atom only reads
// `member.user.id` / `member.user.username`.
// ─────────────────────────────────────────────────────────────────────────────

export interface InjectedWorkspaceRole {
    role_description: string
    role_name: string
}

export interface InjectedWorkspaceUser {
    id: string
    email: string
    username: string
    status: "member" | "pending" | "expired"
    created_at: string
}

export interface InjectedWorkspaceMember {
    user: InjectedWorkspaceUser
    roles: (InjectedWorkspaceRole & {permissions: string[]})[]
}

/**
 * Injected workspace members. Default `[]`. Populated by the OSS `-ui` layer from
 * `workspaceMembersAtom`.
 */
export const injectedWorkspaceMembersAtom = atom<InjectedWorkspaceMember[]>([])

// ─────────────────────────────────────────────────────────────────────────────
// Injected shape: testcase query family
//
// `@/oss/state/entities/testcase/testcaseEntity` `testcaseQueryAtomFamily` (now promoted to
// `@agenta/entities/testcase`) is `atomFamily((testcaseId: string) => atomWithQuery(...))`
// where the produced atom resolves to a TanStack-query result whose `.data` is the
// flattened testcase (or null). The eval-run scenario-testcase atom only reads `.data`, so
// the injected surface is typed as a factory returning a read-only jotai `Atom` over a
// minimal query-result envelope. Default `null` (no family injected yet).
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal query-result envelope the eval-run consumer reads off the testcase query. */
export interface InjectedTestcaseQueryResult {
    data: Record<string, unknown> | null | undefined
    isPending?: boolean
    isFetching?: boolean
    isLoading?: boolean
    isError?: boolean
    error?: unknown
}

/** `(testcaseId) => Atom<InjectedTestcaseQueryResult>` — an `atomFamily`-shaped getter. */
export type InjectedTestcaseQueryFamily = (testcaseId: string) => Atom<InjectedTestcaseQueryResult>

/**
 * Injected testcase query family. Default `null`. Populated by the OSS `-ui` layer from
 * `testcaseQueryAtomFamily`.
 */
export const injectedTestcaseQueryFamilyAtom = atom<InjectedTestcaseQueryFamily | null>(null)

// ─────────────────────────────────────────────────────────────────────────────
// Injected shape: reference resolvers
//
// `@/oss/components/References/atoms/entityReferences` exposes three resolver families —
// App / Variant / Testset — each `atomFamily(({projectId, <id>}) => Atom<QueryResultShape<T>>)`
// sharing a common `{data, isPending, isFetching, isLoading, isError}` envelope. The eval-run
// references atom reads `.data` (id/name/slug/revision). The injected surface bundles all
// three families. Default `null`.
// ─────────────────────────────────────────────────────────────────────────────

/** Common query envelope all three reference resolvers return. */
export interface ReferenceQueryResult<T> {
    data: T | null
    isPending: boolean
    isFetching: boolean
    isLoading: boolean
    isError: boolean
}

export interface InjectedAppReference {
    id: string
    name?: string | null
    slug?: string | null
}

export interface InjectedVariantReference {
    id: string
    name?: string | null
    slug?: string | null
    revision?: number | string | null
}

export interface InjectedTestsetReference {
    id: string
    name?: string | null
    revisionId?: string | null
    revisionVersion?: number | null
}

export type InjectedAppReferenceFamily = (params: {
    projectId: string | null
    appId: string | null | undefined
}) => Atom<ReferenceQueryResult<InjectedAppReference>>

export type InjectedVariantReferenceFamily = (params: {
    projectId: string | null
    variantId: string | null | undefined
}) => Atom<ReferenceQueryResult<InjectedVariantReference>>

export type InjectedTestsetReferenceFamily = (params: {
    projectId: string | null
    testsetId: string | null | undefined
}) => Atom<ReferenceQueryResult<InjectedTestsetReference>>

/** Bundle of the three entity-reference resolver families. */
export interface InjectedReferenceResolver {
    appReferenceAtomFamily: InjectedAppReferenceFamily
    variantReferenceAtomFamily: InjectedVariantReferenceFamily
    previewTestsetReferenceAtomFamily: InjectedTestsetReferenceFamily
}

/**
 * Injected reference resolvers. Default `null`. Populated by the OSS `-ui` layer from
 * `entityReferences`.
 */
export const injectedReferenceResolverAtom = atom<InjectedReferenceResolver | null>(null)

// ─────────────────────────────────────────────────────────────────────────────
// Injected shape: imperative invalidation callbacks
//
// `invalidateEvaluationRunsTableAtom` (a write-atom set with `set(atom)`) and
// `clearMetricSelectionCache` (a plain fn) are both fire-and-forget side effects the
// edit/invocation atoms trigger. Both injected as `(() => void) | null`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Injected runs-table invalidation callback (wraps `invalidateEvaluationRunsTableAtom`).
 * Default `null`.
 */
export const injectedRunInvalidateAtom = atom<(() => void) | null>(null)

/**
 * Injected metric-selection cache-clear callback (wraps `clearMetricSelectionCache`).
 * Default `null`.
 */
export const injectedClearMetricSelectionAtom = atom<(() => void) | null>(null)

// ─────────────────────────────────────────────────────────────────────────────
// Injected shape: annotation transform
//
// The eval-run annotation batcher (`annotations.ts`) transforms each raw trace into an
// `AnnotationDto`, resolving `createdBy` against the workspace member list. The transform
// lived in `@/oss/lib/hooks/useAnnotations/assets/transformer` (`transformApiData`). It is
// injected here as a pure fn `({data, members}) => AnnotationDto`. Default `null`; when
// absent the batcher degrades to a verbatim pass-through (no `createdBy` resolution).
// ─────────────────────────────────────────────────────────────────────────────

export type InjectedAnnotationTransform = (args: {
    data: AnnotationResponseDto
    members: InjectedWorkspaceMember[]
}) => AnnotationDto

/**
 * Injected annotation transform. Default `null`. Populated by the OSS `-ui` layer from
 * `transformApiData`.
 */
export const injectedAnnotationTransformAtom = atom<InjectedAnnotationTransform | null>(null)

// ─────────────────────────────────────────────────────────────────────────────
// Injected shape: online-evaluations query payloads
//
// `query.ts` consumed two TYPES from `@/oss/services/onlineEvaluations/api`
// (`QueryFilteringPayload` / `QueryWindowingPayload`) to type the query-revision snapshot;
// it calls NO runtime function from that module (it issues its own axios request). The
// payload shapes are therefore defined locally below.
// ─────────────────────────────────────────────────────────────────────────────

type OnlineEvalLogicalOperator = "and" | "or" | "not" | "nand" | "nor"

export interface QueryConditionPayload {
    field: string
    key?: string
    value?: unknown
    operator?: string
    options?: Record<string, unknown>
}

export interface QueryFilteringPayload {
    operator?: OnlineEvalLogicalOperator
    conditions: (QueryConditionPayload | QueryFilteringPayload)[]
}

export interface QueryWindowingPayload {
    newest?: string
    oldest?: string
    next?: string
    limit?: number
    order?: "ascending" | "descending"
    interval?: number
    rate?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration write-atom
// ─────────────────────────────────────────────────────────────────────────────

/** Payload for `registerEvalRunInjections`. Every field is optional — only the provided
 * seams are overwritten, so the OSS layer can register incrementally. */
export interface EvalRunInjections {
    workspaceMembers?: InjectedWorkspaceMember[]
    testcaseQueryFamily?: InjectedTestcaseQueryFamily | null
    referenceResolver?: InjectedReferenceResolver | null
    runInvalidate?: (() => void) | null
    clearMetricSelection?: (() => void) | null
    annotationTransform?: InjectedAnnotationTransform | null
}

/**
 * Write-atom that populates the injection seams. The OSS `-ui` layer calls
 * `set(registerEvalRunInjections, {...})` once at boot (and on relevant changes, e.g. the
 * workspace member list). Only the keys present in the payload are written.
 */
export const registerEvalRunInjections: WritableAtom<null, [EvalRunInjections], void> = atom(
    null,
    (_get, set, injections: EvalRunInjections) => {
        // NOTE: many injected seams hold FUNCTION values (atomFamilies, transforms,
        // callbacks). jotai's primitive `set(atom, value)` treats a function value as an
        // updater `(prev) => next` and INVOKES it — e.g. `set(x, transformApiData)` would
        // call `transformApiData(prev)`. So every value is wrapped in `() => value`, which
        // jotai calls and whose return is stored verbatim. Harmless for non-function values.
        if (injections.workspaceMembers !== undefined) {
            const v = injections.workspaceMembers
            set(injectedWorkspaceMembersAtom, () => v)
        }
        if (injections.testcaseQueryFamily !== undefined) {
            const v = injections.testcaseQueryFamily
            set(injectedTestcaseQueryFamilyAtom, () => v)
        }
        if (injections.referenceResolver !== undefined) {
            const v = injections.referenceResolver
            set(injectedReferenceResolverAtom, () => v)
        }
        if (injections.runInvalidate !== undefined) {
            const v = injections.runInvalidate
            set(injectedRunInvalidateAtom, () => v)
        }
        if (injections.clearMetricSelection !== undefined) {
            const v = injections.clearMetricSelection
            set(injectedClearMetricSelectionAtom, () => v)
        }
        if (injections.annotationTransform !== undefined) {
            const v = injections.annotationTransform
            set(injectedAnnotationTransformAtom, () => v)
        }
    },
)
