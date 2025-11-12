import {FilterConditions} from "@/oss/lib/Types"
import {FieldConfig} from "@/oss/components/pages/observability/assets/filters/fieldAdapter"
import {
    NUM_OPS,
    STRING_EQU_AND_CONTAINS_OPS,
    STRING_EQU_OPS,
} from "@/oss/components/pages/observability/assets/utils"

import {FilterItem} from "../types"
import {effectiveFieldForRow} from "./utils"

export type AnnotationFeedbackValueType = "string" | "number" | "boolean"

export type AnnotationFeedbackCondition = {
    field?: string | string[]
    operator?: FilterConditions
    value?: string | number | boolean
    valueType?: AnnotationFeedbackValueType
}

export type AnnotationFilterValue = {
    evaluator?: string
    feedback?: AnnotationFeedbackCondition
}

export type AnnotationFeedbackOption = {
    label: string
    value: string
    evaluatorSlug: string
    evaluatorLabel: string
    type: AnnotationFeedbackValueType
}

export const ALL_FEEDBACK_OPERATOR_OPTIONS = [...STRING_EQU_AND_CONTAINS_OPS, ...NUM_OPS]

export const ALL_FEEDBACK_OPERATOR_VALUES = new Set(
    ALL_FEEDBACK_OPERATOR_OPTIONS.map((opt) => opt.value),
)

export const NUMERIC_FEEDBACK_OPERATOR_VALUES = new Set(NUM_OPS.map((opt) => opt.value))

export const EMPTY_DISABLED_OPTIONS = new Set<string>()

export const collapseAnnotationAnyEvaluatorRowsFromProps = (
    items: FilterItem[],
    getField: (uiKey?: string) => FieldConfig | undefined,
): FilterItem[] => {
    type GroupKey = string
    const groups = new Map<GroupKey, FilterItem>()
    const order: GroupKey[] = []

    const makeKey = (it: FilterItem, ann: any) => {
        const uiKey = it.selectedField || it.field || ""
        const base = {
            uiKey,
            isCustomField: it.isCustomField,
            baseField: it.baseField,
            key: it.key ?? "",
            operator: it.operator ?? "",
            fbOperator: ann?.feedback?.operator ?? "",
            fbValueType: ann?.feedback?.valueType ?? "string",
            fbValue: ann?.feedback?.value ?? "",
            evaluator: ann?.evaluator ?? undefined,
        }
        return JSON.stringify(base)
    }

    const resultPush = (key: GroupKey, item: FilterItem) => {
        if (!groups.has(key)) {
            groups.set(key, item)
            order.push(key)
        }
    }

    for (const it of items) {
        const uiKey = it.selectedField || it.field || ""
        const baseFieldCfg = getField(uiKey)
        const field = effectiveFieldForRow(baseFieldCfg, it)

        const ann = extractAnnotationValue(it.value)
        const isAnnotation = field?.baseField?.includes("annotation") ?? false
        const anyEvaluator = isAnnotation && ann && !ann.evaluator
        const fbField = ann?.feedback?.field

        if (anyEvaluator && typeof fbField === "string" && fbField) {
            const key = makeKey(it, ann)
            const existing = groups.get(key)
            if (!existing) {
                const clone: FilterItem = JSON.parse(JSON.stringify(it))
                const cAnn = extractAnnotationValue(clone.value)!
                cAnn.feedback = {...(cAnn.feedback ?? {}), field: [fbField]}
                clone.value = [cAnn]
                resultPush(key, clone)
            } else {
                const eAnn = extractAnnotationValue(existing.value)!
                const arr = Array.isArray(eAnn.feedback?.field)
                    ? (eAnn.feedback!.field as string[])
                    : []
                if (!arr.includes(fbField)) arr.push(fbField)
                eAnn.feedback = {...(eAnn.feedback ?? {}), field: arr}
                existing.value = [eAnn]
            }
        } else {
            const passthroughKey = `__pt__${Math.random().toString(36).slice(2)}`
            resultPush(passthroughKey, it)
        }
    }

    return order.map((k) => groups.get(k)!)
}

export const extractAnnotationValue = (
    raw: FilterItem["value"],
): AnnotationFilterValue | undefined => {
    if (!Array.isArray(raw) || raw.length === 0) return undefined
    const candidate = raw[0]
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined
    const annotation = candidate as AnnotationFilterValue
    const next: AnnotationFilterValue = {}
    if ("evaluator" in annotation) next.evaluator = annotation.evaluator
    if (annotation.feedback && typeof annotation.feedback === "object")
        next.feedback = {...annotation.feedback}
    return Object.keys(next).length > 0 ? next : undefined
}

export const dedupeFeedbackOptions = (
    options: AnnotationFeedbackOption[],
): AnnotationFeedbackOption[] => {
    const byKey = new Map<string, AnnotationFeedbackOption>()
    for (const opt of options) {
        if (!byKey.has(opt.value)) byKey.set(opt.value, opt)
    }
    return Array.from(byKey.values())
}

export const explodeAnnotationAnyEvaluatorRows = (items: FilterItem[]): FilterItem[] => {
    const out: FilterItem[] = []
    for (const it of items) {
        const ann = extractAnnotationValue(it.value)
        const fields = ann?.feedback?.field
        if (!ann?.evaluator && Array.isArray(fields) && fields.length > 1) {
            for (const key of fields) {
                const clone: FilterItem = JSON.parse(JSON.stringify(it))
                const cAnn = extractAnnotationValue(clone.value)!
                cAnn.feedback = {...(cAnn.feedback ?? {}), field: key}
                clone.value = [cAnn]
                out.push(clone)
            }
        } else {
            out.push(it)
        }
    }
    return out
}

export const deriveFeedbackValueType = (schema: any): AnnotationFeedbackValueType => {
    const type = schema?.type
    if (type === "number" || type === "integer") return "number"
    if (type === "boolean") return "boolean"
    if (type === "array") {
        const itemType = schema?.items?.type
        if (itemType === "number" || itemType === "integer") return "number"
        if (itemType === "boolean") return "boolean"
    }
    return "string"
}

export const ensureFeedbackOperator = (
    type: AnnotationFeedbackValueType,
    current?: FilterConditions,
): FilterConditions => {
    if (current && ALL_FEEDBACK_OPERATOR_VALUES.has(current)) return current
    if (type === "number") {
        return NUM_OPS[0]?.value ?? ""
    }
    return STRING_EQU_OPS[0]?.value ?? ""
}

export const coerceNumericFeedbackValue = (input: unknown): string | number | undefined => {
    if (typeof input === "number") return Number.isFinite(input) ? input : undefined
    if (typeof input === "string") {
        const trimmed = input.trim()
        if (!trimmed) return ""
        const numericPattern = /^-?(?:\d+|\d*\.\d+)$/
        return numericPattern.test(trimmed) ? Number(trimmed) : input
    }
    return undefined
}

export const parseFeedbackArrayInput = (input: string): Array<any> | undefined => {
    const trimmed = input.trim()
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return undefined
    try {
        const parsed = JSON.parse(trimmed)
        return Array.isArray(parsed) ? parsed : undefined
    } catch {
        return undefined
    }
}
