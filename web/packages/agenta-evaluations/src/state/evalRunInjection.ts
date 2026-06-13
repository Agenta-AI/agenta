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
 * This module is ADDITIVE and currently UNUSED — nothing reads these atoms until WP-4e-2
 * relocates the atoms that consume them. It exists only to establish the seam shape and to
 * keep the package free of any `@/oss` import.
 */
import {atom, type Atom, type PrimitiveAtom, type WritableAtom} from "jotai"

import type {AnnotationDto, AnnotationResponseDto} from "./evalRun/atoms/annotationTypes"
import type {RunMetricDescriptor} from "./runsTable"

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
// payload shapes are therefore defined locally below, and the seam atom exposes an
// (optional) handle for any future runtime surface. Default `null`; nothing reads it today.
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

/**
 * Online-evaluations API surface the relocated eval-run VIEW consumes. The run-list
 * actions cell (relocated in WP-4h-4) calls `startSimpleEvaluation` / `stopSimpleEvaluation`
 * against an evaluation id; the OSS service file (`@/oss/services/onlineEvaluations/api`)
 * STAYS in OSS — nine onlineEvaluation-page files still use it — so the impls are injected
 * here rather than relocated. `query.ts` consumes only the payload TYPES above (no runtime
 * fn), so those are not part of this surface.
 */
export interface InjectedOnlineEvaluationsApi {
    startSimpleEvaluation: (evaluationId: string) => Promise<unknown>
    stopSimpleEvaluation: (evaluationId: string) => Promise<unknown>
}

/**
 * Injected online-evaluations API. Default `null`. Populated by the OSS `-ui` layer from
 * `@/oss/services/onlineEvaluations/api`.
 */
export const injectedOnlineEvaluationsApiAtom = atom<InjectedOnlineEvaluationsApi | null>(null)

// ─────────────────────────────────────────────────────────────────────────────
// Injected shapes: run-list VIEW app-state seams (WP-4h-4)
//
// The relocated `RunsTable` view (`EvaluationRunsTablePOC` → `@agenta/evaluations-ui`)
// reads a handful of OSS app-state / query / reference atoms. Each is exposed as a
// primitive injection atom (or atom-family getter) with a safe default; the OSS `-ui`
// layer populates them via `registerEvalRunInjections`, and the relocated view atoms read
// the injected values reactively. Atom families/factories are injected as opaque getter
// functions (the proven `injectedReferenceResolverAtom` pattern) — the package never sees
// the OSS atom's internals, only the produced `Atom<T>`.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal app entry the run-list reads off the apps query. */
export interface InjectedAppEntry {
    id?: string | null
    name?: string | null
    slug?: string | null
    [key: string]: unknown
}

/** Minimal apps-query envelope `context.ts`/`view.ts` read (`.data` is the app list). */
export interface InjectedAppsQueryResult {
    data: InjectedAppEntry[] | null | undefined
    isLoading?: boolean
    isPending?: boolean
    isFetching?: boolean
    error?: unknown
}

/** Injected `appsQueryAtom`. Default empty result. */
export const injectedAppsQueryAtom = atom<InjectedAppsQueryResult>({data: []})

/** Injected `routerAppIdAtom`. Default `null`. */
export const injectedRouterAppIdAtom = atom<string | null>(null)

/** Minimal URL-state shape `navigationActions.ts` reads (`projectURL`/`baseAppURL`/...). */
export interface InjectedUrlState {
    projectURL?: string
    baseProjectURL?: string
    baseAppURL?: string
    appURL?: string
    workspaceName?: string
    [key: string]: unknown
}

/** Injected `urlAtom`. Default empty. */
export const injectedUrlAtom = atom<InjectedUrlState>({})

/** App identifiers `context.ts` reads (`.projectId`). */
export interface InjectedAppIdentifiers {
    projectId?: string | null
    appId?: string | null
}

/** Injected `appIdentifiersAtom`. Default empty. */
export const injectedAppIdentifiersAtom = atom<InjectedAppIdentifiers>({})

/** Injected `routeLayerAtom` ("app" | "project" | other). Default `null`. */
export const injectedRouteLayerAtom = atom<string | null>(null)

/** Minimal saved-query shape `view.ts` reads off the queries response. */
export interface InjectedSavedQuery {
    id?: string | null
    slug?: string | null
    name?: string | null
    meta?: {filtering?: unknown; filters?: unknown} | null
}

/**
 * Minimal queries-query envelope `view.ts` reads. This is the TanStack-query result's
 * `.data` (the `QueriesResponse`), whose `.data.queries` is the saved-query list — the view
 * reads `loadableResult.data.data.queries`, i.e. (loadable→QueriesResponse).data.queries.
 */
export interface InjectedQueriesQueryResult {
    data?: {queries?: InjectedSavedQuery[]} | null
    isLoading?: boolean
    isPending?: boolean
    error?: unknown
}

/** Params the saved-queries family accepts (`{payload, enabled}`). */
export interface InjectedQueriesQueryParams {
    payload?: Record<string, unknown>
    enabled?: boolean
}

/** `({payload, enabled}) => Atom<InjectedQueriesQueryResult>` — `atomFamily`-shaped getter. */
export type InjectedQueriesQueryFamily = (
    params: InjectedQueriesQueryParams,
) => Atom<InjectedQueriesQueryResult>

/** Injected `queriesQueryAtomFamily`. Default `null`. */
export const injectedQueriesQueryFamilyAtom = atom<InjectedQueriesQueryFamily | null>(null)

/** Minimal active-workflow shape the run-list filters read (`id`/`name`/`slug`). */
export interface InjectedCurrentWorkflow {
    id?: string | null
    name?: string | null
    slug?: string | null
    [key: string]: unknown
}

/** Injected `currentWorkflowAtom` — the active workflow. Default `null`. */
export const injectedCurrentWorkflowAtom = atom<InjectedCurrentWorkflow | null>(null)

// Evaluator-metric blueprint factory (`getEvaluatorMetricBlueprintAtom(scopeId)`).
// The OSS factory returns an `Atom` over an evaluator-metric-group blueprint list; the
// run-list view groups columns by it. Mirrors `EvaluatorMetricGroupBlueprint` from
// `@/oss/components/References/atoms/metricBlueprint`, re-typed against the package's
// `RunMetricDescriptor`.
export interface InjectedEvaluatorMetricGroupBlueprint {
    id: string
    label: string
    referenceId?: string | null
    projectId?: string | null
    evaluatorId?: string | null
    handles?: {
        slug?: string | null
        name?: string | null
        id?: string | null
        variantId?: string | null
        variantSlug?: string | null
        revisionId?: string | null
        revisionSlug?: string | null
        projectId?: string | null
    } | null
    columns: RunMetricDescriptor[]
}

/**
 * `(scopeId) => WritableAtom<...>` — the blueprint factory. Writable: the columns hook both
 * reads the blueprint and writes the recomputed group set back.
 */
export type InjectedMetricBlueprintFactory = (
    scopeId: string | null | undefined,
) => WritableAtom<
    InjectedEvaluatorMetricGroupBlueprint[],
    [
        | InjectedEvaluatorMetricGroupBlueprint[]
        | ((
              prev: InjectedEvaluatorMetricGroupBlueprint[],
          ) => InjectedEvaluatorMetricGroupBlueprint[]),
    ],
    void
>

/** Injected `getEvaluatorMetricBlueprintAtom`. Default `null`. */
export const injectedMetricBlueprintFactoryAtom = atom<InjectedMetricBlueprintFactory | null>(null)

/** `(descriptorId) => PrimitiveAtom<string | null>` — the resolved-metric-label atom family
 * (writable; the run-metric cell writes the resolved label back). */
export type InjectedResolvedMetricLabelsFamily = (
    descriptorId: string,
) => PrimitiveAtom<string | null>

/** Injected `resolvedMetricLabelsAtomFamily`. Default `null`. */
export const injectedResolvedMetricLabelsFamilyAtom =
    atom<InjectedResolvedMetricLabelsFamily | null>(null)

// Evaluator reference resolver (`evaluatorReferenceAtomFamily`).
/** Evaluator-reference metric entry the view reads. */
export interface InjectedEvaluatorReferenceMetric {
    canonicalPath: string
    label?: string | null
    outputType?: string | null
}

/** Evaluator reference shape the view reads off the resolver. */
export interface InjectedEvaluatorReference {
    id?: string | null
    slug?: string | null
    name?: string | null
    workflowKey?: string | null
    metrics?: InjectedEvaluatorReferenceMetric[]
}

export type InjectedEvaluatorReferenceFamily = (params: {
    projectId: string | null
    slug?: string | null
    id?: string | null
}) => Atom<ReferenceQueryResult<InjectedEvaluatorReference>>

/** Injected `evaluatorReferenceAtomFamily`. Default `null`. */
export const injectedEvaluatorReferenceFamilyAtom = atom<InjectedEvaluatorReferenceFamily | null>(
    null,
)

/** `(userId) => Atom<{username?: string | null} | null>` — workspace-member-by-id family. */
export type InjectedWorkspaceMemberByIdFamily = (
    userId: string | null | undefined,
) => Atom<{username?: string | null; user?: {username?: string | null}} | null>

/** Injected `workspaceMemberByIdFamily`. Default `null`. */
export const injectedWorkspaceMemberByIdFamilyAtom = atom<InjectedWorkspaceMemberByIdFamily | null>(
    null,
)

// ─────────────────────────────────────────────────────────────────────────────
// Injected shape: navigation-request atom (RunDetails focus-drawer URL sync — WP-4h-5)
//
// The relocated focus-drawer URL sync (`RunDetails/state/urlFocusDrawer.ts`) imperatively
// READS the OSS `navigationRequestAtom` (`@/oss/state/appState`) to detect a pending
// query-patch navigation before resetting drawer state. Rather than relocate the OSS
// navigation atom (owned by the app-state layer + consumed by `AppGlobalWrappers`), the OSS
// host injects the atom REFERENCE here; the package reads it via
// `store.get(injectedNavigationRequestAtom)` then `store.get(thatAtom)`.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal navigation-command shape the focus-drawer sync inspects (`type`/`patch`). */
export interface InjectedNavigationCommand {
    type: string
    patch?: Record<string, unknown>
    [key: string]: unknown
}

/** Injected OSS `navigationRequestAtom` reference. Default `null` (no pending nav read). */
export const injectedNavigationRequestAtom = atom<Atom<InjectedNavigationCommand | null> | null>(
    null,
)

// Onboarding-widget seams (the run-list opens the SDK-eval create modal off a widget event).
/** Injected `onboardingWidgetActivationAtom` (read). Default `null`. */
export const injectedOnboardingWidgetActivationAtom = atom<string | null>(null)

/**
 * Injected `setOnboardingWidgetActivationAtom` write callback. Default `null` (consumers
 * call it optionally). Must be `null`-initialized, NOT `atom(() => {})` — jotai reads a
 * bare function arg as a derived-atom READ fn, yielding a non-writable atom.
 */
export const injectedSetOnboardingWidgetActivationAtom = atom<
    ((value: string | null) => void) | null
>(null)

/** Injected `recordWidgetEventAtom` write callback. Default `null` (see note above). */
export const injectedRecordWidgetEventAtom = atom<((eventId: string) => void) | null>(null)

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
    onlineEvaluationsApi?: InjectedOnlineEvaluationsApi | null
    // ── run-list VIEW seams (WP-4h-4) ──
    appsQuery?: InjectedAppsQueryResult
    routerAppId?: string | null
    url?: InjectedUrlState
    appIdentifiers?: InjectedAppIdentifiers
    routeLayer?: string | null
    queriesQueryFamily?: InjectedQueriesQueryFamily | null
    currentWorkflow?: InjectedCurrentWorkflow | null
    metricBlueprintFactory?: InjectedMetricBlueprintFactory | null
    resolvedMetricLabelsFamily?: InjectedResolvedMetricLabelsFamily | null
    evaluatorReferenceFamily?: InjectedEvaluatorReferenceFamily | null
    workspaceMemberByIdFamily?: InjectedWorkspaceMemberByIdFamily | null
    onboardingWidgetActivation?: string | null
    setOnboardingWidgetActivation?: (value: string | null) => void
    recordWidgetEvent?: (eventId: string) => void
    // ── RunDetails view seam (WP-4h-5) ──
    navigationRequest?: Atom<InjectedNavigationCommand | null> | null
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
        if (injections.onlineEvaluationsApi !== undefined) {
            const v = injections.onlineEvaluationsApi
            set(injectedOnlineEvaluationsApiAtom, () => v)
        }
        if (injections.appsQuery !== undefined) {
            const v = injections.appsQuery
            set(injectedAppsQueryAtom, () => v)
        }
        if (injections.routerAppId !== undefined) {
            const v = injections.routerAppId
            set(injectedRouterAppIdAtom, () => v)
        }
        if (injections.url !== undefined) {
            const v = injections.url
            set(injectedUrlAtom, () => v)
        }
        if (injections.appIdentifiers !== undefined) {
            const v = injections.appIdentifiers
            set(injectedAppIdentifiersAtom, () => v)
        }
        if (injections.routeLayer !== undefined) {
            const v = injections.routeLayer
            set(injectedRouteLayerAtom, () => v)
        }
        if (injections.queriesQueryFamily !== undefined) {
            const v = injections.queriesQueryFamily
            set(injectedQueriesQueryFamilyAtom, () => v)
        }
        if (injections.currentWorkflow !== undefined) {
            const v = injections.currentWorkflow
            set(injectedCurrentWorkflowAtom, () => v)
        }
        if (injections.metricBlueprintFactory !== undefined) {
            const v = injections.metricBlueprintFactory
            set(injectedMetricBlueprintFactoryAtom, () => v)
        }
        if (injections.resolvedMetricLabelsFamily !== undefined) {
            const v = injections.resolvedMetricLabelsFamily
            set(injectedResolvedMetricLabelsFamilyAtom, () => v)
        }
        if (injections.evaluatorReferenceFamily !== undefined) {
            const v = injections.evaluatorReferenceFamily
            set(injectedEvaluatorReferenceFamilyAtom, () => v)
        }
        if (injections.workspaceMemberByIdFamily !== undefined) {
            const v = injections.workspaceMemberByIdFamily
            set(injectedWorkspaceMemberByIdFamilyAtom, () => v)
        }
        if (injections.onboardingWidgetActivation !== undefined) {
            const v = injections.onboardingWidgetActivation
            set(injectedOnboardingWidgetActivationAtom, () => v)
        }
        if (injections.setOnboardingWidgetActivation !== undefined) {
            const v = injections.setOnboardingWidgetActivation
            set(injectedSetOnboardingWidgetActivationAtom, () => v)
        }
        if (injections.recordWidgetEvent !== undefined) {
            const v = injections.recordWidgetEvent
            set(injectedRecordWidgetEventAtom, () => v)
        }
        if (injections.navigationRequest !== undefined) {
            const v = injections.navigationRequest
            set(injectedNavigationRequestAtom, () => v)
        }
    },
)
