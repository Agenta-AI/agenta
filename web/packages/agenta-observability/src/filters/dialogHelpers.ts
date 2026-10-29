/**
 * The pure half of the filter dialog.
 *
 * Everything the dialog does that is not rendering: the row model (props ↔ rows ↔ query
 * payload), row validation, the field-menu descriptor tree, the attribute-key tree data,
 * and the annotation collapse/explode pair. Kept free of React and of any UI library so
 * both the desktop dialog and the mobile sheet render the same decisions.
 *
 * `buildFieldMenuItems` returns a DESCRIPTOR tree, not menu elements — the renderer owns
 * the markup, this owns the shape, the keys and the disabled state.
 */
import type {Filter, FilterConditions, FilterValue} from "../core/types"

import type {FieldConfig} from "./fieldAdapter"
import {getOperator, valueShapeFor, type ScalarType} from "./operatorRegistry"
import type {
    CustomValueType,
    FilterGroup,
    FilterItem,
    FilterLeaf,
    FilterMenuNode,
    IconSlot,
    RowValidation,
    SelectOption,
} from "./types"
import {normalizeFilter, toUIValue} from "./valueCodec"

export type FilterFieldMap = Map<string, FieldConfig>

export const CUSTOM_FIELD_VALUE = "__custom__"

export const createEmptyFilter = (): FilterItem => ({
    field: "",
    key: "",
    operator: "",
    value: "",
    isPermanent: false,
    selectedField: undefined,
    fieldType: undefined,
    isCustomField: false,
    baseField: undefined,
    selectedLabel: undefined,
})

// ============================================================================
// SMALL PREDICATES AND LOOKUPS
// ============================================================================

export const toStringValue = (value: SelectOption["value"] | undefined): string | undefined =>
    typeof value === "string" || typeof value === "number" ? String(value) : undefined

export const collectOptionValues = (
    options: SelectOption[] | undefined,
    acc: Set<string> = new Set(),
): Set<string> => {
    if (!options) return acc
    options.forEach((option) => {
        const rawValue = option.value ?? option.label
        const stringified = toStringValue(rawValue)
        if (stringified && (option.value !== undefined || option.selectable)) {
            acc.add(stringified)
        }
        if (Array.isArray(option.children) && option.children.length) {
            collectOptionValues(option.children, acc)
        }
    })
    return acc
}

export const valueToPathLabel = (value: string | number): string => {
    const stringValue = String(value)
    return stringValue.startsWith("attributes.")
        ? stringValue.slice("attributes.".length)
        : stringValue
}

export const normalizeAttributeSearch = (
    value: string | undefined,
): {value: string; pathLabel: string} | undefined => {
    const trimmed = value?.trim()
    if (!trimmed) return undefined
    if (trimmed.startsWith("attributes.")) {
        return {value: trimmed, pathLabel: valueToPathLabel(trimmed)}
    }
    if (trimmed.startsWith("ag.")) {
        return {value: `attributes.${trimmed}`, pathLabel: trimmed}
    }
    return {value: trimmed, pathLabel: trimmed}
}

export const isNumberLike = (value: unknown): boolean => {
    if (typeof value === "number") return Number.isFinite(value)
    if (typeof value === "string") {
        const trimmed = value.trim()
        if (!trimmed) return false
        return !Number.isNaN(Number(trimmed))
    }
    return false
}

export const isBooleanLike = (value: unknown): boolean => {
    if (typeof value === "boolean") return true
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase()
        return normalized === "true" || normalized === "false"
    }
    return false
}

export const getOptionKey = (leaf: FilterLeaf): string => leaf.optionKey ?? leaf.value

export const findFirstLeafValue = (nodes: FilterMenuNode[]): string | undefined => {
    for (const child of nodes) {
        if (child.kind === "leaf") return getOptionKey(child)
        const nested = findFirstLeafValue(child.children)
        if (nested) return nested
    }
    return undefined
}

export const hasLeafWithValue = (nodes: FilterMenuNode[], v: string): boolean =>
    nodes.some((n) => (n.kind === "leaf" ? getOptionKey(n) === v : hasLeafWithValue(n.children, v)))

export const getGroupDefaultValue = (group: FilterGroup): string | undefined =>
    group.defaultValue && hasLeafWithValue(group.children, group.defaultValue)
        ? group.defaultValue
        : findFirstLeafValue(group.children)

export const customOperatorIdsForType = (t: CustomValueType): FilterConditions[] =>
    t === "number"
        ? ["eq", "neq", "gt", "lt", "gte", "lte"]
        : t === "boolean"
          ? ["is", "is_not"]
          : [
                "is",
                "is_not",
                "contains",
                "startswith",
                "endswith",
                "in",
                "not_in",
                "gt",
                "lt",
                "gte",
                "lte",
            ]

export const operatorOptionsFromIds = (
    ids: FilterConditions[],
): {value: FilterConditions; label: string}[] =>
    ids.map((id) => {
        const op = getOperator(id)
        if (!op) return {value: id, label: id}
        return {value: op.id, label: op.label}
    })

/**
 * The custom field's shape depends on the row's own `customValueType`, so its operator
 * list and value input are derived per row rather than read off the static column.
 */
export const effectiveFieldForRow = (
    field: FieldConfig | undefined,
    row: FilterItem,
): FieldConfig | undefined => {
    if (!field) return undefined
    if (field.optionKey !== "custom") return field
    const t = row.customValueType ?? "string"
    return {
        ...field,
        type: t === "number" ? "number" : "string",
        operatorIds: customOperatorIdsForType(t),
        operatorOptions: operatorOptionsFromIds(customOperatorIdsForType(t)),
        valueInput:
            t === "boolean"
                ? {
                      kind: "select",
                      options: [
                          {label: "true", value: "true"},
                          {label: "false", value: "false"},
                      ],
                  }
                : field.valueInput,
    }
}

// ============================================================================
// ATTRIBUTE-KEY TREE DATA
// ============================================================================

/** Structurally the `TreeSelectOption` the `@agenta/ui` tree input takes, minus its ReactNode slack. */
export interface FilterTreeOption {
    value: string
    label?: string
    children?: FilterTreeOption[]
    selectable?: boolean
    searchLabel?: string
    displayLabel?: string
}

export const mapToTreeData = (options: SelectOption[] | undefined): FilterTreeOption[] =>
    (options ?? []).map((option) => {
        const rawValue = option.value ?? option.label
        const normalizedValue = String(rawValue)
        const pathLabel =
            typeof option.pathLabel === "string" ? option.pathLabel : valueToPathLabel(rawValue)
        return {
            value: normalizedValue,
            label: option.label,
            searchLabel: pathLabel,
            displayLabel: pathLabel,
            selectable: option.selectable ?? option.value !== undefined,
            children:
                option.children && option.children.length > 0
                    ? mapToTreeData(option.children)
                    : undefined,
        }
    })

/** A node for a key the loaded traces never emitted, built from what the user typed. */
export const buildCustomTreeNode = (value: string, pathLabel: string): FilterTreeOption => ({
    value,
    label: pathLabel,
    searchLabel: pathLabel,
    displayLabel: pathLabel,
    selectable: true,
})

/**
 * The tree the key input renders: the field's own options plus, when needed, a synthetic
 * node for the live search term and one for a committed key that is not in the options.
 */
export const buildKeyTreeData = (
    options: SelectOption[] | undefined,
    searchTerm: string | undefined,
    currentKey: string | undefined,
): FilterTreeOption[] => {
    const optionValues = collectOptionValues(options)
    const additional: FilterTreeOption[] = []
    const normalizedSearch = normalizeAttributeSearch(searchTerm)
    if (normalizedSearch && !optionValues.has(normalizedSearch.value)) {
        additional.push(buildCustomTreeNode(normalizedSearch.value, normalizedSearch.pathLabel))
    }
    if (
        currentKey &&
        !optionValues.has(currentKey) &&
        !additional.some((node) => node.value === currentKey)
    ) {
        additional.push(buildCustomTreeNode(currentKey, valueToPathLabel(currentKey)))
    }
    const base = mapToTreeData(options)
    return additional.length > 0 ? [...additional, ...base] : base
}

// ============================================================================
// ANNOTATION ROW VALUE
// ============================================================================

export type AnnotationFeedbackValueType = "string" | "number" | "boolean"

export interface AnnotationFeedbackCondition {
    field?: string | string[]
    operator?: FilterConditions
    value?: FilterValue
    valueType?: AnnotationFeedbackValueType
}

export interface AnnotationFilterValue {
    evaluator?: string
    feedback?: AnnotationFeedbackCondition
}

export const extractAnnotationValue = (
    raw: FilterItem["value"] | undefined,
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

const cloneItem = (item: FilterItem): FilterItem => JSON.parse(JSON.stringify(item)) as FilterItem

/**
 * Collapse the multiple "any evaluator" annotation rows the backend stores (one per
 * feedback key) back into a single UI row whose `feedback.field` is a string[].
 */
export const collapseAnnotationAnyEvaluatorRowsFromProps = (
    items: FilterItem[],
    getField: (uiKey?: string) => FieldConfig | undefined,
): FilterItem[] => {
    const groups = new Map<string, FilterItem>()
    const order: string[] = []

    const makeKey = (it: FilterItem, ann: AnnotationFilterValue | undefined) => {
        // Everything except feedback.field — that is what the group merges.
        const uiKey = it.selectedField || it.field || ""
        return JSON.stringify({
            uiKey,
            isCustomField: it.isCustomField,
            baseField: it.baseField,
            key: it.key ?? "",
            operator: it.operator ?? "",
            fbOperator: ann?.feedback?.operator ?? "",
            fbValueType: ann?.feedback?.valueType ?? "string",
            fbValue: ann?.feedback?.value ?? "",
            evaluator: ann?.evaluator ?? undefined,
        })
    }

    const resultPush = (key: string, item: FilterItem) => {
        if (!groups.has(key)) {
            groups.set(key, item)
            order.push(key)
        }
    }

    for (const it of items) {
        const uiKey = it.selectedField || it.field || ""
        const field = effectiveFieldForRow(getField(uiKey), it)

        const ann = extractAnnotationValue(it.value)
        const isAnnotation = field?.baseField?.includes("annotation") ?? false
        const anyEvaluator = isAnnotation && ann && !ann.evaluator
        const fbField = ann?.feedback?.field

        if (anyEvaluator && typeof fbField === "string" && fbField) {
            const key = makeKey(it, ann)
            const existing = groups.get(key)
            if (!existing) {
                const clone = cloneItem(it)
                const cloneAnn = extractAnnotationValue(clone.value)
                if (!cloneAnn) continue
                cloneAnn.feedback = {...(cloneAnn.feedback ?? {}), field: [fbField]}
                clone.value = [cloneAnn]
                resultPush(key, clone)
            } else {
                const existingAnn = extractAnnotationValue(existing.value)
                if (!existingAnn) continue
                const existingFeedback = existingAnn.feedback ?? {}
                const arr = Array.isArray(existingFeedback.field) ? [...existingFeedback.field] : []
                if (!arr.includes(fbField)) arr.push(fbField)
                existingAnn.feedback = {...existingFeedback, field: arr}
                existing.value = [existingAnn]
            }
        } else {
            resultPush(`__pt__${order.length}_${Math.random().toString(36).slice(2)}`, it)
        }
    }

    return order.map((k) => groups.get(k)).filter((it): it is FilterItem => Boolean(it))
}

/** Inverse of the collapse: one row per feedback key, so the backend ANDs them separately. */
export const explodeAnnotationAnyEvaluatorRows = (items: FilterItem[]): FilterItem[] => {
    const out: FilterItem[] = []
    for (const it of items) {
        const ann = extractAnnotationValue(it.value)
        const fields = ann?.feedback?.field
        if (!ann?.evaluator && Array.isArray(fields) && fields.length > 1) {
            for (const key of fields) {
                const clone = cloneItem(it)
                const cloneAnn = extractAnnotationValue(clone.value)
                if (!cloneAnn) continue
                cloneAnn.feedback = {...(cloneAnn.feedback ?? {}), field: key}
                clone.value = [cloneAnn]
                out.push(clone)
            }
        } else {
            out.push(it)
        }
    }
    return out
}

// ============================================================================
// FIELD MENU DESCRIPTOR
// ============================================================================

export interface FieldMenuLeafEntry {
    kind: "leaf"
    /** The option key the row commits when this entry is chosen. */
    key: string
    label: string
    icon?: IconSlot
    disabled: boolean
}

export interface FieldMenuGroupEntry {
    kind: "group"
    /** Render key only — a group commits `defaultValue`, not this. */
    key: string
    label: string
    icon?: IconSlot
    /** Choosing the group header itself commits this option key (antd `onTitleClick`). */
    defaultValue?: string
    /** Row label to show when the header rather than a leaf was chosen. */
    defaultDisplayLabel?: string
    defaultDisabled: boolean
    children: FieldMenuEntry[]
}

export type FieldMenuEntry = FieldMenuLeafEntry | FieldMenuGroupEntry

export interface BuildFieldMenuOptions {
    /** Option keys that must render disabled (e.g. a second `has_annotation` row). */
    disabledOptionKeys?: ReadonlySet<string>
    /** Host icon set keyed by node label — a fallback for columns built without icons. */
    icons?: Record<string, IconSlot>
    parentKey?: string
}

const EMPTY_DISABLED_OPTIONS: ReadonlySet<string> = new Set<string>()

export const buildFieldMenuItems = (
    nodes: FilterMenuNode[],
    options: BuildFieldMenuOptions = {},
): FieldMenuEntry[] => {
    const {disabledOptionKeys = EMPTY_DISABLED_OPTIONS, icons, parentKey = "root"} = options
    return nodes.map((node, index) => {
        const icon = node.icon ?? icons?.[node.label]
        if (node.kind === "group") {
            const groupKey = `group:${parentKey}:${index}`
            const defaultValue = getGroupDefaultValue(node)
            return {
                kind: "group",
                key: groupKey,
                label: node.label,
                icon,
                defaultValue,
                defaultDisplayLabel: node.titleClickDisplayLabel ?? node.leafDisplayLabel,
                defaultDisabled: defaultValue ? disabledOptionKeys.has(defaultValue) : false,
                children: buildFieldMenuItems(node.children, {
                    disabledOptionKeys,
                    icons,
                    parentKey: groupKey,
                }),
            }
        }
        const optionKey = getOptionKey(node)
        return {
            kind: "leaf",
            key: optionKey,
            label: node.label,
            icon,
            disabled: disabledOptionKeys.has(optionKey),
        }
    })
}

// ============================================================================
// ROW MODEL: props → rows → query payload
// ============================================================================

/**
 * Which column an incoming filter belongs to. Exact option-key match first, then the
 * `references` family disambiguation — application.id / evaluator.id / environment.id all
 * share `baseField: "references"`, so without the `attributes.key` check the first match
 * always wins and mislabels the row.
 */
export const resolveFieldForFilter = (
    item: Filter,
    fieldMap: FilterFieldMap,
): FieldConfig | undefined => {
    const byOptionKey = item.field ? fieldMap.get(item.field) : undefined
    if (byOptionKey) return byOptionKey

    if (item.key) {
        for (const fc of fieldMap.values()) if (fc.queryKey === item.key) return fc
    }

    const matches: FieldConfig[] = []
    for (const fc of fieldMap.values()) {
        if (fc.baseField === item.field || (item.key && fc.baseField === item.key)) matches.push(fc)
    }
    if (matches.length <= 1) return matches[0]

    const valuesArray: unknown[] = Array.isArray(item.value)
        ? item.value
        : item.value == null
          ? []
          : [item.value]

    const attributesKey = (() => {
        for (const entry of valuesArray) {
            if (entry && typeof entry === "object") {
                const ak = (entry as Record<string, unknown>)["attributes.key"]
                if (typeof ak === "string") return ak
            }
        }
        return undefined
    })()

    if (attributesKey) {
        for (const candidate of matches) {
            if (candidate.referenceCategory !== attributesKey) continue
            if (!candidate.referenceProperty) continue
            const refProp = candidate.referenceProperty
            const hasMatch = valuesArray.some(
                (entry) => entry && typeof entry === "object" && refProp in entry,
            )
            if (hasMatch) return candidate
        }
    }

    for (const candidate of matches) {
        if (!candidate.referenceProperty) continue
        const refProp = candidate.referenceProperty
        const hasMatch = valuesArray.some(
            (entry) => entry && typeof entry === "object" && refProp in entry,
        )
        if (hasMatch) return candidate
    }

    return matches[0]
}

export const mapFilterData = (data: Filter[], fieldMap: FilterFieldMap): FilterItem[] =>
    data.map((item) => {
        const field = resolveFieldForFilter(item, fieldMap)

        if (field) {
            const pre = field.toUI ? field.toUI(item.value) : item.value
            const shape = item.operator ? valueShapeFor(item.operator, field.type) : "single"
            return {
                ...item,
                field: field.optionKey,
                key: item.key ?? "",
                selectedField: field.optionKey,
                fieldType: field.type,
                isCustomField: false,
                baseField: field.baseField,
                selectedLabel: field.label,
                value: toUIValue(pre, shape) as FilterValue,
                customValueType: field.optionKey === "custom" ? "string" : undefined,
            }
        }

        const customKey = item.key || item.field || ""
        return {
            ...item,
            field: customKey,
            key: customKey,
            selectedField: customKey ? CUSTOM_FIELD_VALUE : undefined,
            fieldType: undefined,
            isCustomField: Boolean(customKey),
            baseField: item.field,
            selectedLabel: undefined,
        }
    })

const firstOf = (raw: unknown): unknown => (Array.isArray(raw) ? raw[0] : raw)

const toBooleanOrUndefined = (raw: unknown): boolean | undefined => {
    const s = String(firstOf(raw)).trim().toLowerCase()
    return s === "true" ? true : s === "false" ? false : undefined
}

const toNumberOrUndefined = (raw: unknown): number | undefined => {
    const n = Number(firstOf(raw))
    return Number.isFinite(n) ? n : undefined
}

/** The custom field carries its own value type, so its raw text is coerced before normalizing. */
const coerceCustomValue = (
    value: FilterValue | undefined,
    valueType: CustomValueType,
    operator: FilterConditions,
): FilterValue | undefined => {
    const effType: ScalarType = valueType === "number" ? "number" : "string"
    const shape = operator ? valueShapeFor(operator, effType) : "single"

    if (valueType === "number") {
        if (shape === "list") {
            const arr = Array.isArray(value) ? value : [value]
            return arr.map((v) => Number(v)).filter((n) => Number.isFinite(n))
        }
        if (shape === "range") {
            const arr = Array.isArray(value) ? value : []
            const a = Number(arr[0])
            const b = Number(arr[1])
            return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : undefined
        }
        return toNumberOrUndefined(value)
    }

    if (valueType === "boolean") {
        if (shape === "list") {
            const arr = Array.isArray(value) ? value : [value]
            const mapped = arr
                .map((v) => {
                    const s = String(v).trim().toLowerCase()
                    return s === "true" ? true : s === "false" ? false : undefined
                })
                .filter((v): v is boolean => v !== undefined)
            return mapped.length === 0 ? undefined : mapped
        }
        return toBooleanOrUndefined(value)
    }

    if (shape === "list") {
        if (Array.isArray(value)) return value
        return value ? [value] : []
    }
    if (shape === "range") return value
    return Array.isArray(value) ? ((value[0] ?? "") as FilterValue) : (value ?? "")
}

export const sanitizeFilterItems = (items: FilterItem[], fieldMap: FilterFieldMap): Filter[] =>
    items.map(
        ({field, key, operator, value, isPermanent, selectedField, customValueType}): Filter => {
            const fc = fieldMap.get(selectedField || field || "")
            if (!fc) {
                const raw: Filter = {field, key, operator, value}
                return isPermanent ? {...raw, isPermanent} : raw
            }

            const isException =
                fc.baseField === "events" && (operator === "exists" || operator === "not_exists")

            let valueToSend: FilterValue | undefined = value
            if (fc.optionKey === "custom") {
                valueToSend = coerceCustomValue(value, customValueType ?? "string", operator)
            }
            if (isException) valueToSend = fc.defaultValue ?? valueToSend

            const keyForFilter = key && key !== "" ? key : fc.queryKey
            const filterForNormalization: Filter = {
                field: fc.baseField,
                operator,
                value: valueToSend ?? "",
            }
            if (keyForFilter) filterForNormalization.key = keyForFilter

            const normalized = normalizeFilter(filterForNormalization, {
                fieldType:
                    fc.optionKey === "custom"
                        ? customValueType === "number"
                            ? "number"
                            : "string"
                        : fc.type,
                opId: operator,
                toExternal: fc.toExternal,
            })
            return isPermanent ? {...normalized, isPermanent} : normalized
        },
    )

/** Rows that are complete enough to send. Mirrors the dialog's pre-sanitize filter. */
export const selectSendableRows = (items: FilterItem[]): FilterItem[] =>
    items.filter(({field, operator, isPermanent, isCustomField}) => {
        if (isPermanent) return true
        if (!operator) return false
        if (isCustomField) return !!field
        return !!field
    })

export const validateFilterRow = (item: FilterItem, fieldMap: FilterFieldMap): RowValidation => {
    if (item.isPermanent) return {isValid: true}

    const uiKey = item.selectedField || item.field || ""
    const field = effectiveFieldForRow(fieldMap.get(uiKey), item)
    if (!field) return {isValid: false}

    const operatorValue =
        item.operator || (field.operatorIds.length === 1 ? field.operatorIds[0] : "")
    if (!operatorValue) return {isValid: false}

    const needsKey = !!field.keyInput && field.keyInput.kind !== "none"
    if (needsKey && (!item.key || item.key === "")) return {isValid: false}

    // `getOperator` returns undefined for an operator in the union but absent from OPERATORS;
    // dereferencing it threw during validation and took the dialog's render with it.
    const hidesValue = getOperator(operatorValue)?.hidesValue || field.valueInput?.kind === "none"
    if (hidesValue) return {isValid: true}

    const effType: ScalarType =
        field.optionKey === "custom"
            ? item.customValueType === "number"
                ? "number"
                : "string"
            : field.type
    const wantsBooleanValidation =
        field.optionKey === "custom" && item.customValueType === "boolean"
    const wantsNumberValidation = effType === "number"

    const shape = valueShapeFor(operatorValue, effType)
    const value = item.value

    if (shape === "range") {
        let parsed: unknown[] | null = null
        if (Array.isArray(value)) parsed = value
        else if (typeof value === "string") {
            const trimmed = value.trim()
            if (!trimmed) return {isValid: false}
            try {
                const json: unknown = JSON.parse(value)
                if (Array.isArray(json)) parsed = json
            } catch {
                parsed = null
            }
        } else if (value == null) {
            return {isValid: false}
        }

        if (!parsed || parsed.length !== 2) return {isValid: false, valueInvalid: true}
        if (wantsNumberValidation && parsed.some((entry) => !isNumberLike(entry)))
            return {isValid: false, valueInvalid: true}
        return {isValid: true}
    }

    if (shape === "list") {
        if (Array.isArray(value)) {
            if (value.length === 0) return {isValid: false}
            if (wantsBooleanValidation && value.some((entry) => !isBooleanLike(entry)))
                return {isValid: false, valueInvalid: true}
            if (wantsNumberValidation && value.some((entry) => !isNumberLike(entry)))
                return {isValid: false, valueInvalid: true}
            return {isValid: true}
        }
        const trimmed = String(value ?? "").trim()
        if (!trimmed) return {isValid: false}
        return {isValid: true}
    }

    const normalized = Array.isArray(value) ? value[0] : value
    if (normalized == null) return {isValid: false}
    const asString = typeof normalized === "string" ? normalized.trim() : String(normalized)
    if (!asString) return {isValid: false}
    if (wantsBooleanValidation && !isBooleanLike(normalized))
        return {isValid: false, valueInvalid: true}
    if (wantsNumberValidation && !isNumberLike(normalized))
        return {isValid: false, valueInvalid: true}
    return {isValid: true}
}

// ============================================================================
// EQUALITY
// ============================================================================

const deepEqual = (a: unknown, b: unknown): boolean => {
    if (a === b) return true
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
        return a.every((entry, index) => deepEqual(entry, b[index]))
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
        const left = a as Record<string, unknown>
        const right = b as Record<string, unknown>
        const leftKeys = Object.keys(left)
        if (leftKeys.length !== Object.keys(right).length) return false
        return leftKeys.every(
            (key) =>
                Object.prototype.hasOwnProperty.call(right, key) &&
                deepEqual(left[key], right[key]),
        )
    }
    return false
}

/** Structural equality over filter payloads. Replaces `lodash/isEqual` (same undefined semantics). */
export const filtersEqual = (a: Filter[] | undefined, b: Filter[] | undefined): boolean =>
    deepEqual(a, b)
