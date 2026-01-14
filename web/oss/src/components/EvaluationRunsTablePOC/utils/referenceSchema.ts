import type {EvaluationRunKind, EvaluationRunTableRow, PreviewRunColumnMeta} from "../types"

export type ReferenceRole = "application" | "variant" | "testset" | "query" | "evaluator"

export interface ReferenceValue {
    id?: string | null
    slug?: string | null
    name?: string | null
    label?: string | null
    source?: string | null
    raw?: Record<string, any> | null
}

export interface ReferenceSlot {
    role: ReferenceRole
    stepIndex: number
    stepKey: string | null
    stepType?: string | null
    origin?: string | null
    values: ReferenceValue[]
}

export interface ReferenceColumnDescriptor {
    slotIndex: number
    role: ReferenceRole
    roleOrdinal: number
    label: string
    sampleStepType?: string | null
    sampleOrigin?: string | null
}

const ROLE_LABEL: Record<ReferenceRole, string> = {
    application: "Application",
    variant: "Variant",
    testset: "Testset",
    query: "Query",
    evaluator: "Evaluator",
}

export const REFERENCE_ROLE_LABELS = ROLE_LABEL

const ROLE_KEYS: Record<ReferenceRole, string[]> = {
    application: [
        "application",
        "app",
        "application_ref",
        "applicationRef",
        "application_revision",
        "applicationRevision",
        "agent",
        "agent_revision",
        "agentRevision",
    ],
    variant: [
        "application_variant",
        "applicationVariant",
        "variant",
        "variant_revision",
        "variantRevision",
        "agent_variant",
        "agentVariant",
    ],
    testset: [
        "testset",
        "test_set",
        "testsets",
        "testset_variant",
        "testsetVariant",
        "testset_revision",
        "testsetRevision",
    ],
    query: ["query", "query_variant", "queryVariant", "query_revision", "queryRevision"],
    evaluator: [
        "evaluator",
        "evaluator_variant",
        "evaluatorVariant",
        "evaluator_revision",
        "evaluatorRevision",
    ],
}

const ROLE_ORDER: ReferenceRole[] = ["testset", "query", "application", "variant", "evaluator"]

const ROLE_EVALUATION_FALLBACK: Record<EvaluationRunKind, ReferenceRole[]> = {
    auto: ["testset", "application", "variant", "evaluator"],
    human: ["testset", "application", "variant", "evaluator"],
    online: ["query", "evaluator"],
    custom: ["testset", "application", "variant", "evaluator"],
    all: ROLE_ORDER,
}

const normalizeString = (value: unknown): string | null => {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
}

const dedupeReferenceValues = (values: ReferenceValue[]): ReferenceValue[] => {
    const seen = new Set<string>()
    return values.filter((value) => {
        const dedupeKey = `${value.source ?? "unknown"}::${value.id ?? value.slug ?? value.name ?? ""}`
        if (seen.has(dedupeKey)) {
            return false
        }
        seen.add(dedupeKey)
        return true
    })
}

const collectReferenceValues = (
    references: Record<string, any>,
    role: ReferenceRole,
): ReferenceValue[] => {
    const values: ReferenceValue[] = []
    const keys = ROLE_KEYS[role]
    for (const key of keys) {
        const value = references?.[key]
        if (!value) continue
        const items = Array.isArray(value) ? value : [value]
        items.forEach((item) => {
            if (!item || typeof item !== "object") return
            const normalized: ReferenceValue = {
                id: normalizeString((item as any).id),
                slug:
                    normalizeString((item as any).slug) ??
                    normalizeString((item as any).key) ??
                    normalizeString((item as any).name) ??
                    normalizeString((item as any).displayName) ??
                    normalizeString((item as any).version),
                name:
                    normalizeString((item as any).name) ??
                    normalizeString((item as any).label) ??
                    normalizeString((item as any).displayName) ??
                    null,
                source: key,
                raw: item as Record<string, any>,
            }
            normalized.label =
                normalized.name ??
                normalized.slug ??
                normalized.id ??
                normalizeString((item as any).title) ??
                null
            values.push(normalized)
        })
    }
    return dedupeReferenceValues(values)
}

export const buildReferenceSequence = (meta?: PreviewRunColumnMeta | null): ReferenceSlot[] => {
    if (!meta?.steps?.length) return []
    const slots: ReferenceSlot[] = []
    meta.steps.forEach((step, stepIndex) => {
        const references = (step?.references as Record<string, any> | undefined) ?? {}
        if (!references || typeof references !== "object") {
            return
        }
        ROLE_ORDER.forEach((role) => {
            const values = collectReferenceValues(references, role)
            if (!values.length) return
            slots.push({
                role,
                stepIndex,
                stepKey: normalizeString(step?.key) ?? null,
                stepType: normalizeString(step?.type),
                origin: normalizeString(step?.origin),
                values,
            })
        })
    })
    return slots
}

interface RoleStats {
    count: number
    stepTypes: Set<string>
    origins: Set<string>
}

const buildFallbackBlueprint = (evaluationKind: EvaluationRunKind): ReferenceColumnDescriptor[] => {
    const fallbackRoles = ROLE_EVALUATION_FALLBACK[evaluationKind] ?? ROLE_ORDER
    return fallbackRoles.map((role, index) => ({
        slotIndex: index,
        role,
        roleOrdinal: 1,
        label: ROLE_LABEL[role],
    }))
}

export const buildReferenceBlueprint = (
    rows: EvaluationRunTableRow[],
    evaluationKind: EvaluationRunKind,
): ReferenceColumnDescriptor[] => {
    // Collect which roles appear across all rows
    const roleStats: Record<ReferenceRole, RoleStats> = {
        testset: {count: 0, stepTypes: new Set(), origins: new Set()},
        query: {count: 0, stepTypes: new Set(), origins: new Set()},
        application: {count: 0, stepTypes: new Set(), origins: new Set()},
        variant: {count: 0, stepTypes: new Set(), origins: new Set()},
        evaluator: {count: 0, stepTypes: new Set(), origins: new Set()},
    }

    let hasAnyData = false

    rows.forEach((row) => {
        if (row.__isSkeleton || !row.previewMeta) return
        hasAnyData = true
        const sequence = buildReferenceSequence(row.previewMeta)
        sequence.forEach((slot) => {
            const stats = roleStats[slot.role]
            stats.count += 1
            if (slot.stepType) stats.stepTypes.add(slot.stepType)
            if (slot.origin) stats.origins.add(slot.origin)
        })
    })

    if (!hasAnyData) {
        return buildFallbackBlueprint(evaluationKind)
    }

    // Build columns for roles that appear in the data, ordered by ROLE_ORDER
    const result: ReferenceColumnDescriptor[] = []
    ROLE_ORDER.forEach((role) => {
        const stats = roleStats[role]
        if (stats.count === 0) return
        result.push({
            slotIndex: result.length,
            role,
            roleOrdinal: 1,
            label: ROLE_LABEL[role],
            sampleStepType: stats.stepTypes.values().next().value ?? null,
            sampleOrigin: stats.origins.values().next().value ?? null,
        })
    })

    return result.length > 0 ? result : buildFallbackBlueprint(evaluationKind)
}

export const getSlotByRoleOrdinal = (
    sequence: ReferenceSlot[] | null | undefined,
    role: ReferenceRole,
    ordinal: number,
): ReferenceSlot | undefined => {
    if (!sequence?.length) return undefined
    let count = 0
    for (const slot of sequence) {
        if (slot.role !== role) continue
        count += 1
        if (count === ordinal) {
            return slot
        }
    }
    return undefined
}

export const buildReferenceColumnKey = (descriptor: ReferenceColumnDescriptor) =>
    `reference:${descriptor.role}:${descriptor.roleOrdinal}`
