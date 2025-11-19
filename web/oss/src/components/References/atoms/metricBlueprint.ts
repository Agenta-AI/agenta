import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {RunMetricDescriptor} from "../types/runMetrics"

export interface EvaluatorMetricGroupBlueprint {
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

const EMPTY_BLUEPRINT: EvaluatorMetricGroupBlueprint[] = []
const DEFAULT_SCOPE_KEY = "__global__"

const normalizeScopeKey = (scopeId: string | null | undefined) =>
    scopeId && scopeId.length ? scopeId : DEFAULT_SCOPE_KEY

export const evaluatorMetricBlueprintAtomFamily = atomFamily(
    (scopeId: string | null | undefined) => atom<EvaluatorMetricGroupBlueprint[]>(EMPTY_BLUEPRINT),
    (a, b) => normalizeScopeKey(a) === normalizeScopeKey(b),
)

export const getEvaluatorMetricBlueprintAtom = (scopeId: string | null | undefined) =>
    evaluatorMetricBlueprintAtomFamily(normalizeScopeKey(scopeId))
