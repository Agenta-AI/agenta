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

interface DraftEntry {
    slotIndex: number
    totals: number
    roleCounts: Partial<Record<ReferenceRole, number>>
    stepTypes: Set<string>
    origins: Set<string>
}

const pickDominantRole = (counts: Partial<Record<ReferenceRole, number>>): ReferenceRole | null => {
    let winner: ReferenceRole | null = null
    let max = 0
    ROLE_ORDER.forEach((role) => {
        const count = counts[role] ?? 0
        if (count > max) {
            winner = role
            max = count
        }
    })
    return winner
}

const buildFallbackBlueprint = (evaluationKind: EvaluationRunKind): ReferenceColumnDescriptor[] => {
    const fallbackRoles = ROLE_EVALUATION_FALLBACK[evaluationKind] ?? ROLE_ORDER
    const perRoleOrdinal: Record<ReferenceRole, number> = {
        application: 0,
        variant: 0,
        testset: 0,
        query: 0,
        evaluator: 0,
    }
    return fallbackRoles.map((role, index) => {
        const ordinal = ++perRoleOrdinal[role]
        return {
            slotIndex: index,
            role,
            roleOrdinal: ordinal,
            label: ordinal === 1 ? ROLE_LABEL[role] : `${ROLE_LABEL[role]} ${ordinal}`,
        }
    })
}

export const buildReferenceBlueprint = (
    rows: EvaluationRunTableRow[],
    evaluationKind: EvaluationRunKind,
): ReferenceColumnDescriptor[] => {
    const drafts: DraftEntry[] = []
    rows.forEach((row) => {
        if (row.__isSkeleton || !row.previewMeta) return
        const sequence = buildReferenceSequence(row.previewMeta)
        sequence.forEach((slot, index) => {
            const draft = drafts[index] ?? {
                slotIndex: index,
                totals: 0,
                roleCounts: {},
                stepTypes: new Set<string>(),
                origins: new Set<string>(),
            }
            draft.totals += 1
            draft.roleCounts[slot.role] = (draft.roleCounts[slot.role] ?? 0) + 1
            if (slot.stepType) draft.stepTypes.add(slot.stepType)
            if (slot.origin) draft.origins.add(slot.origin)
            drafts[index] = draft
        })
    })

    const effectiveDrafts = drafts.filter((draft) => draft.totals > 0)
    if (!effectiveDrafts.length) {
        return buildFallbackBlueprint(evaluationKind)
    }

    const perRoleOrdinal: Record<ReferenceRole, number> = {
        application: 0,
        variant: 0,
        testset: 0,
        query: 0,
        evaluator: 0,
    }

    return effectiveDrafts.map((draft) => {
        const role = pickDominantRole(draft.roleCounts) ?? "application"
        const ordinal = ++perRoleOrdinal[role]
        return {
            slotIndex: draft.slotIndex,
            role,
            roleOrdinal: ordinal,
            label: ordinal === 1 ? ROLE_LABEL[role] : `${ROLE_LABEL[role]} ${ordinal}`,
            sampleOrigin: draft.origins.values().next().value ?? null,
            sampleStepType: draft.stepTypes.values().next().value ?? null,
        }
    })
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
