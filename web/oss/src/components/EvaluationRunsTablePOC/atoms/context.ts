import {atom} from "jotai"
import {loadable, selectAtom} from "jotai/utils"

import {appsQueryAtom, routerAppIdAtom} from "@/oss/state/app"
import {appIdentifiersAtom, routeLayerAtom} from "@/oss/state/appState"
import {projectIdAtom} from "@/oss/state/project"

import type {EvaluationRunKind} from "../types"
import {deriveAppIds} from "../utils/runHelpers"

import type {RunFlagsFilter} from "@/agenta-oss-common/lib/hooks/usePreviewEvaluations"

export interface EvaluationRunsTableOverrides {
    appId: string | null
    projectIdOverride: string | null
    evaluationKind: EvaluationRunKind
    includePreview: boolean
    scope?: TableScope
}

type TableScope = "app" | "project"

export interface EvaluationRunsTableContext {
    projectId: string | null
    scopeId: string | null
    scope: TableScope
    evaluationKind: EvaluationRunKind
    includePreview: boolean
    effectiveAppIds: string[]
    derivedPreviewFlags?: RunFlagsFilter
    isAutoOrHuman: boolean
    supportsPreviewMetrics: boolean
    activeAppId: string | null
    storageKey: string
    createSupported: boolean
    createEvaluationType: "auto" | "human" | "online"
}

export const defaultEvaluationRunsTableOverrides: EvaluationRunsTableOverrides = {
    appId: null,
    projectIdOverride: null,
    evaluationKind: "auto",
    includePreview: true,
}

export const evaluationRunsTableOverridesAtom = atom<EvaluationRunsTableOverrides>(
    defaultEvaluationRunsTableOverrides,
)

const loadableAppsQueryAtom = loadable(appsQueryAtom)

const availableAppIdsAtom = atom<string[]>((get) => {
    const result = get(loadableAppsQueryAtom)
    if (result.state === "hasData") {
        const list = Array.isArray(result.data) ? result.data : []
        return list
            .map((item: any) => item?.app_id || item?.appId)
            .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
    }
    return []
})

export const evaluationRunsTableContextAtom = atom<EvaluationRunsTableContext>((get) => {
    const overrides = get(evaluationRunsTableOverridesAtom)
    const routeLayer = get(routeLayerAtom)
    const identifiers = get(appIdentifiersAtom)
    const routerAppId = get(routerAppIdAtom)
    const availableAppIds = get(availableAppIdsAtom)
    const fallbackProjectId = get(projectIdAtom)

    const scope: TableScope = overrides.scope ?? (routeLayer === "app" ? "app" : "project")

    const evaluationKind = overrides.evaluationKind
    const includePreview = overrides.includePreview

    const projectId =
        overrides.projectIdOverride ?? identifiers.projectId ?? fallbackProjectId ?? null

    const explicitAppId = overrides.appId ?? null
    const scopedAppId = scope === "app" ? (routerAppId ?? explicitAppId ?? null) : null
    const effectiveAppIds = deriveAppIds(explicitAppId, scopedAppId, availableAppIds)

    let derivedPreviewFlags: RunFlagsFilter | undefined
    switch (evaluationKind) {
        case "online":
            derivedPreviewFlags = {is_live: true}
            break
        case "auto":
            derivedPreviewFlags = {has_auto: true}
            break
        case "human":
            derivedPreviewFlags = {has_human: true}
            break
        case "custom":
            derivedPreviewFlags = {has_custom: true}
            break
        default:
            derivedPreviewFlags = undefined
    }

    const isAutoOrHuman = evaluationKind === "auto" || evaluationKind === "human"
    const supportsPreviewMetrics =
        evaluationKind === "all" ||
        evaluationKind === "auto" ||
        evaluationKind === "human" ||
        evaluationKind === "online" ||
        evaluationKind === "custom"

    const projectSegment = projectId ?? "no-project"
    const appSegment =
        scope === "app" ? (routerAppId ?? explicitAppId ?? "app") : (explicitAppId ?? "all-apps")
    const scopeId = `${projectSegment}::${appSegment}::${evaluationKind}`
    const storageKey = `evaluation-runs:columns:${scopeId}`
    const standardCreateSupported = isAutoOrHuman || evaluationKind === "online"
    const createSupported = evaluationKind === "all" ? true : standardCreateSupported
    const createEvaluationType =
        evaluationKind === "human" ? "human" : evaluationKind === "online" ? "online" : "auto"

    const context: EvaluationRunsTableContext = {
        projectId,
        scopeId,
        scope,
        evaluationKind,
        includePreview,
        effectiveAppIds,
        derivedPreviewFlags,
        isAutoOrHuman,
        supportsPreviewMetrics,
        activeAppId: scope === "app" ? (routerAppId ?? explicitAppId ?? null) : null,
        storageKey,
        createSupported,
        createEvaluationType,
    }

    return context
})

export const evaluationRunsTableComponentSliceAtom = selectAtom(
    evaluationRunsTableContextAtom,
    (context) => ({
        projectId: context.projectId,
        scope: context.scope,
        scopeId: context.scopeId,
        isAutoOrHuman: context.isAutoOrHuman,
        supportsPreviewMetrics: context.supportsPreviewMetrics,
        activeAppId: context.activeAppId,
        storageKey: context.storageKey,
        createSupported: context.createSupported,
        createEvaluationType: context.createEvaluationType,
        evaluationKind: context.evaluationKind,
    }),
    (a, b) =>
        a.projectId === b.projectId &&
        a.scope === b.scope &&
        a.scopeId === b.scopeId &&
        a.isAutoOrHuman === b.isAutoOrHuman &&
        a.supportsPreviewMetrics === b.supportsPreviewMetrics &&
        a.activeAppId === b.activeAppId &&
        a.storageKey === b.storageKey &&
        a.createSupported === b.createSupported &&
        a.createEvaluationType === b.createEvaluationType &&
        a.evaluationKind === b.evaluationKind,
)

export const evaluationRunsTableContextSetterAtom = atom(
    null,
    (_get, set, overrides: Partial<EvaluationRunsTableOverrides>) => {
        set(evaluationRunsTableOverridesAtom, (prev) => {
            const next = {
                ...prev,
                ...overrides,
            }
            return next
        })
    },
)

export const evaluationRunsTableFetchEnabledAtom = atom(true)

export const evaluationRunsMetaContextSliceAtom = selectAtom(
    evaluationRunsTableContextAtom,
    (context) => ({
        projectId: context.projectId,
        scopeId: context.scopeId,
        effectiveAppIds: context.effectiveAppIds,
        scope: context.scope,
        activeAppId: context.activeAppId,
        includePreview: context.includePreview,
        evaluationKind: context.evaluationKind,
        derivedPreviewFlags: context.derivedPreviewFlags,
    }),
    (a, b) =>
        a.projectId === b.projectId &&
        a.scopeId === b.scopeId &&
        a.scope === b.scope &&
        a.activeAppId === b.activeAppId &&
        a.includePreview === b.includePreview &&
        a.evaluationKind === b.evaluationKind &&
        arrayEquals(a.effectiveAppIds, b.effectiveAppIds) &&
        shallowEqualFlags(a.derivedPreviewFlags, b.derivedPreviewFlags),
)

export const evaluationRunsProjectIdAtom = selectAtom(
    evaluationRunsTableContextAtom,
    (context) => context.projectId ?? null,
    (a, b) => a === b,
)

export const evaluationRunsScopeIdAtom = selectAtom(
    evaluationRunsTableContextAtom,
    (context) => context.scopeId,
    (a, b) => a === b,
)

export const evaluationRunsColumnVisibilityContextAtom = selectAtom(
    evaluationRunsTableContextAtom,
    (context) => ({
        projectId: context.projectId,
        scopeId: context.scopeId,
    }),
    (a, b) => a.projectId === b.projectId && a.scopeId === b.scopeId,
)

export const evaluationRunsFiltersContextAtom = selectAtom(
    evaluationRunsTableContextAtom,
    (context) => ({
        evaluationKind: context.evaluationKind,
        derivedPreviewFlags: context.derivedPreviewFlags,
        isAutoOrHuman: context.isAutoOrHuman,
    }),
    (a, b) =>
        a.evaluationKind === b.evaluationKind &&
        a.isAutoOrHuman === b.isAutoOrHuman &&
        shallowEqualFlags(a.derivedPreviewFlags, b.derivedPreviewFlags),
)

export const evaluationRunsDeleteContextAtom = selectAtom(
    evaluationRunsTableContextAtom,
    (context) => ({
        projectId: context.projectId ?? null,
        evaluationKind: context.evaluationKind,
    }),
    (a, b) => a.projectId === b.projectId && a.evaluationKind === b.evaluationKind,
)

const arrayEquals = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false
    }
    return true
}

const shallowEqualFlags = (a?: RunFlagsFilter, b?: RunFlagsFilter) => {
    if (!a && !b) return true
    if (!a || !b) return false
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) => a[key as keyof RunFlagsFilter] === b[key as keyof RunFlagsFilter])
}

export const computeContextSignature = ({
    projectId,
    scopeId,
    effectiveAppIds,
    includePreview,
    evaluationKind,
    derivedPreviewFlags,
}: {
    projectId: string | null
    scopeId: string | null
    effectiveAppIds: string[]
    includePreview: boolean
    evaluationKind: EvaluationRunKind
    derivedPreviewFlags?: RunFlagsFilter
}) =>
    [
        projectId ?? "null",
        scopeId ?? "null",
        includePreview ? "1" : "0",
        evaluationKind,
        effectiveAppIds.join("|"),
        JSON.stringify(derivedPreviewFlags ?? null),
    ].join("::")
