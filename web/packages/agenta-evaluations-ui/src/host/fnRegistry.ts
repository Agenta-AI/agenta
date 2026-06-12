/**
 * Eval-view non-React fn registry — channel 2 of the WP-4h seam architecture (§12.1c).
 *
 * The React component/hook channel (`hostRegistry.tsx`) can only serve code that runs
 * inside a React render. Some relocated eval-view modules are plain (non-React) logic that
 * runs against `getDefaultStore()` — e.g. `RunsTable/actions/navigationActions.ts`. Those
 * still depend on a handful of OSS-owned pure functions (URL builders, the URL-readiness
 * promise, payload normalizers) that are NOT eval-specific and must stay in OSS. This
 * module is a tiny module-level registry the OSS layer populates once at boot; the
 * relocated modules call the registered impls by name.
 *
 * Mirrors the atom seam discipline: safe no-op / identity defaults so the package
 * type-checks and degrades gracefully if a fn is unregistered (a wiring bug surfaces as a
 * console warning, not a crash).
 *
 * @packageDocumentation
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- relocated annotation transform/service
   seams own heavily-`any` OSS payload shapes; the names are the contract (see §11.4). */

import type {ComponentType} from "react"

/** URL-readiness options the OSS `waitForValidURL` accepts. */
export interface WaitForUrlOptions {
    requireOrg?: boolean
    requireProject?: boolean
    requireApp?: boolean
}

/** Minimal URL-state shape the navigation actions read. */
export interface EvalViewUrlState {
    projectURL?: string
    baseProjectURL?: string
    baseAppURL?: string
    appURL?: string
    workspaceName?: string
    [key: string]: unknown
}

/** The OSS-owned non-React functions the relocated eval-view modules call. */
export interface EvalViewFns {
    /** `@/oss/state/url` `waitForValidURL` — resolves once URL state satisfies the options. */
    waitForValidURL: (options?: WaitForUrlOptions) => Promise<EvalViewUrlState>
    /** `@/oss/components/pages/evaluations/utils` `buildAppScopedUrl`. */
    buildAppScopedUrl: (baseAppURL: string, appId: string, path: string) => string
    /** `@/oss/components/pages/evaluations/utils` `buildEvaluationNavigationUrl`. */
    buildEvaluationNavigationUrl: (params: {
        scope: "app" | "project"
        baseAppURL: string
        projectURL: string
        appId?: string
        path: string
    }) => string
    /** `@/oss/lib/helpers/url` `buildRevisionsQueryParam`. */
    buildRevisionsQueryParam: (ids: (string | null | undefined)[]) => string | undefined
    /**
     * `@/oss/components/pages/evaluations/utils` `extractPrimaryInvocation`. Reads the
     * primary variant/invocation off an evaluation row (app/variant/revision identifiers).
     * Loosely typed at the seam — the OSS impl owns the `EvaluationRow` shape.
     */
    extractPrimaryInvocation: (evaluation: unknown) => {
        appId?: string
        appName?: string
        revisionId?: string
        variantId?: string
        variantName?: string
        revisionLabel?: string | number
    } | null
    /**
     * `@/oss/components/pages/evaluations/onlineEvaluation/assets/helpers` `fromFilteringPayload`.
     * Converts an online-eval filtering payload into the OSS `Filter[]` shape the filter UI
     * renders. Loosely typed at the seam — the OSS impl owns `Filter`.
     */
    fromFilteringPayload: (payload?: unknown) => unknown[]

    // ── RunDetails view seams (WP-4h-5) ──
    /** `@/oss/lib/helpers/dateTimeHelper` `formatDate24`. */
    formatDate24: (value: string | number | Date | null | undefined) => string
    /** `@/oss/services/annotations/api` `createAnnotation` (loose OSS payload shape). */
    createAnnotation: (payload: any) => Promise<any>
    /** `@/oss/services/annotations/api` `updateAnnotation` (loose OSS payload shape). */
    updateAnnotation: (payload: any) => Promise<any>
    /** `@/oss/components/SharedDrawers/AnnotateDrawer/assets/transforms` `transformMetadata`. */
    transformMetadata: (args: {data: any}) => any
    /** transforms `generateAnnotationPayloadData`. */
    generateAnnotationPayloadData: (args: any) => any
    /** transforms `generateNewAnnotationPayloadData`. */
    generateNewAnnotationPayloadData: (args: any) => any
    /** transforms `getInitialMetricsFromAnnotations`. */
    getInitialMetricsFromAnnotations: (args: any) => any
    /**
     * `@/oss/components/EditorViews/SimpleSharedEditor` — supplied as a component value so the
     * non-React `renderChatMessages` builder can instantiate it. The `simple` editor branch is
     * not exercised by the current RunDetails callers (all pass `view: "table"`), but the seam
     * keeps the builder self-contained.
     */
    SimpleSharedEditor: ComponentType<any>
    /**
     * `@/oss/components/pages/evaluations/onlineEvaluation/constants` `EVALUATOR_CATEGORY_LABEL_MAP`
     * — a `{slug.toLowerCase(): label}` map derived from the OSS legacy evaluator tags. Supplied
     * as a value so the config view can build its evaluator-type lookup without importing the
     * OSS legacy chain (`getEvaluatorTags`).
     */
    evaluatorCategoryLabelMap: Record<string, string>
}

const noopWarn = (name: string) => {
    if (typeof console !== "undefined") {
        console.warn(`[evaluations-ui] eval-view fn "${name}" called before registration`)
    }
}

const defaults: EvalViewFns = {
    waitForValidURL: async () => {
        noopWarn("waitForValidURL")
        return {}
    },
    buildAppScopedUrl: (baseAppURL, appId, path) => {
        noopWarn("buildAppScopedUrl")
        const normalizedPath = path.startsWith("/") ? path : `/${path}`
        return `${baseAppURL}/${encodeURIComponent(appId)}${normalizedPath}`
    },
    buildEvaluationNavigationUrl: ({scope, baseAppURL, projectURL, appId, path}) => {
        noopWarn("buildEvaluationNavigationUrl")
        const normalizedPath = path.startsWith("/") ? path : `/${path}`
        if (scope === "app" && appId) {
            return `${baseAppURL}/${encodeURIComponent(appId)}${normalizedPath}`
        }
        return `${projectURL}${normalizedPath}`
    },
    buildRevisionsQueryParam: (ids) => {
        noopWarn("buildRevisionsQueryParam")
        const clean = ids.filter((id): id is string => typeof id === "string" && id.length > 0)
        return clean.length ? clean.join(",") : undefined
    },
    extractPrimaryInvocation: () => {
        noopWarn("extractPrimaryInvocation")
        return null
    },
    fromFilteringPayload: () => {
        noopWarn("fromFilteringPayload")
        return []
    },
    formatDate24: (value) => {
        noopWarn("formatDate24")
        if (value === null || value === undefined) return ""
        try {
            return new Date(value).toISOString()
        } catch {
            return String(value)
        }
    },
    createAnnotation: async () => {
        noopWarn("createAnnotation")
        return null
    },
    updateAnnotation: async () => {
        noopWarn("updateAnnotation")
        return null
    },
    transformMetadata: ({data}) => {
        noopWarn("transformMetadata")
        return data
    },
    generateAnnotationPayloadData: (args) => {
        noopWarn("generateAnnotationPayloadData")
        return args
    },
    generateNewAnnotationPayloadData: (args) => {
        noopWarn("generateNewAnnotationPayloadData")
        return args
    },
    getInitialMetricsFromAnnotations: () => {
        noopWarn("getInitialMetricsFromAnnotations")
        return {}
    },
    SimpleSharedEditor: () => null,
    evaluatorCategoryLabelMap: {},
}

let registered: EvalViewFns = {...defaults}

/** Populate the registry with the real OSS impls. Called once at boot by the OSS host. */
export const registerEvalViewFns = (fns: Partial<EvalViewFns>): void => {
    registered = {...registered, ...fns}
}

/** Read the current registry. Relocated non-React modules call these. */
export const getEvalViewFns = (): EvalViewFns => registered
