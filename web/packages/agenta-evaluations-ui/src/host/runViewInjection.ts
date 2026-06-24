/**
 * @agenta/evaluations-ui — run-view injection seams.
 *
 * The relocated run-list / run-details VIEWS read a set of OSS app-state, routing,
 * query, reference, and onboarding values. These are pure VIEW concerns, so the seams
 * live here in the `-ui` layer (not in the headless `@agenta/evaluations` package, which
 * only carries the seams its runtime atoms actually read — workspace members, the testcase
 * query family, the reference resolver, the annotation transform, and the two
 * cache-invalidation callbacks).
 *
 * Each seam is a PRIMITIVE atom with a safe default; the OSS host populates them once via
 * `registerRunViewInjections`, and the relocated view atoms read the injected values
 * reactively. Atom families/factories are injected as opaque getter functions — the package
 * never sees the OSS atom's internals, only the produced `Atom<T>`.
 *
 * @packageDocumentation
 */

import type {ReferenceQueryResult} from "@agenta/evaluations/state"
import type {RunMetricDescriptor} from "@agenta/evaluations/state/runsTable"
import {atom, type Atom, type PrimitiveAtom, type WritableAtom} from "jotai"

// ─────────────────────────────────────────────────────────────────────────────
// Online-evaluations API (run-list actions cell — start/stop simple evaluation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Online-evaluations API surface the run-list VIEW consumes. The run-list actions cell
 * calls `startSimpleEvaluation` / `stopSimpleEvaluation` against an evaluation id; the OSS
 * service stays in OSS (other onlineEvaluation-page files still use it) so the impls are
 * injected here.
 */
export interface InjectedOnlineEvaluationsApi {
    startSimpleEvaluation: (evaluationId: string) => Promise<unknown>
    stopSimpleEvaluation: (evaluationId: string) => Promise<unknown>
}

/** Injected online-evaluations API. Default `null`. */
export const injectedOnlineEvaluationsApiAtom = atom<InjectedOnlineEvaluationsApi | null>(null)

// ─────────────────────────────────────────────────────────────────────────────
// Run-list VIEW app-state seams
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

// ─────────────────────────────────────────────────────────────────────────────
// Evaluator-metric blueprint + resolved-label + evaluator-reference seams
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors `EvaluatorMetricGroupBlueprint` from OSS, re-typed against the package's
 * `RunMetricDescriptor`. The run-list view groups columns by it.
 */
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
// RunDetails focus-drawer navigation seam
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

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding-widget seams (run-list opens the SDK-eval create modal off a widget event)
// ─────────────────────────────────────────────────────────────────────────────

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

/** Payload for `registerRunViewInjections`. Every field is optional — only the provided
 * seams are overwritten, so the OSS layer can register incrementally. */
export interface RunViewInjections {
    onlineEvaluationsApi?: InjectedOnlineEvaluationsApi | null
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
    navigationRequest?: Atom<InjectedNavigationCommand | null> | null
    onboardingWidgetActivation?: string | null
    setOnboardingWidgetActivation?: (value: string | null) => void
    recordWidgetEvent?: (eventId: string) => void
}

/**
 * Write-atom that populates the run-view injection seams. The OSS host calls
 * `set(registerRunViewInjections, {...})` once at boot (and on relevant changes). Only the
 * keys present in the payload are written.
 */
export const registerRunViewInjections: WritableAtom<null, [RunViewInjections], void> = atom(
    null,
    (_get, set, injections: RunViewInjections) => {
        // NOTE: many seams hold FUNCTION values (atomFamilies, callbacks). jotai's primitive
        // `set(atom, value)` treats a function value as an updater `(prev) => next` and
        // INVOKES it. So every value is wrapped in `() => value`, which jotai calls and whose
        // return is stored verbatim. Harmless for non-function values.
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
        if (injections.navigationRequest !== undefined) {
            const v = injections.navigationRequest
            set(injectedNavigationRequestAtom, () => v)
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
    },
)
