import {TreeSelectProps} from "antd"

import {getOperator} from "@/oss/components/pages/observability/assets/filters/operatorRegistry"
import {FilterConditions} from "@/oss/lib/Types"

import {FieldConfig} from "../../pages/observability/assets/filters/fieldAdapter"
import {FilterItem} from "../types"
import {CustomValueType, FilterGroup, FilterLeaf, FilterMenuNode, SelectOption} from "../types"

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

export const toStringValue = (value: SelectOption["value"]) =>
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
            collectOptionValues(option.children as SelectOption[], acc)
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

export const mapToTreeData = (
    options: SelectOption[] | undefined,
    searchTerm?: string,
): NonNullable<TreeSelectProps["treeData"]> =>
    (options ?? []).map((option) => {
        const children =
            option.children && option.children.length > 0
                ? mapToTreeData(option.children as SelectOption[], searchTerm)
                : undefined
        const rawValue = option.value ?? option.label
        const explicitPathLabel = (option as any).pathLabel
        const pathLabel =
            typeof explicitPathLabel === "string"
                ? explicitPathLabel
                : typeof rawValue === "string" || typeof rawValue === "number"
                  ? valueToPathLabel(rawValue)
                  : option.label
        const normalizedValue =
            typeof rawValue === "string" || typeof rawValue === "number" ? rawValue : option.label
        return {
            title: option.label,
            value: normalizedValue,
            key: String(normalizedValue),
            selectable: option.selectable ?? option.value !== undefined,
            children,
            pathLabel,
        }
    })

export const buildCustomTreeNode = (value: string, pathLabel: string) => ({
    title: pathLabel,
    value,
    key: `custom:${value}`,
    selectable: true,
    pathLabel,
})

export const collectTreeKeys = (
    nodes: NonNullable<TreeSelectProps["treeData"]>,
    acc: string[] = [],
): string[] => {
    nodes.forEach((node) => {
        if (node.key !== undefined) {
            acc.push(String(node.key))
        }
        if (Array.isArray(node.children) && node.children.length) {
            collectTreeKeys(node.children as NonNullable<TreeSelectProps["treeData"]>, acc)
        }
    })
    return acc
}

export const noopTreeExpand: TreeSelectProps["onTreeExpand"] = () => {}

export const normalizeAttributeSearch = (value: string | undefined) => {
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

export const getOptionKey = (leaf: FilterLeaf) => leaf.optionKey ?? leaf.value

export const findFirstLeafValue = (nodes: FilterMenuNode[]): string | undefined => {
    for (const child of nodes) {
        if (child.kind === "leaf") return getOptionKey(child as FilterLeaf)
        const nested = findFirstLeafValue((child as FilterGroup).children)
        if (nested) return nested
    }
    return undefined
}
export const hasLeafWithValue = (nodes: FilterMenuNode[], v: string): boolean =>
    nodes.some((n) =>
        n.kind === "leaf"
            ? getOptionKey(n as FilterLeaf) === v
            : hasLeafWithValue((n as FilterGroup).children, v),
    )
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

export const operatorOptionsFromIds = (ids: FilterConditions[]) =>
    ids.map((id) => {
        const op = getOperator(id as any)!
        if (!op) return {value: id, label: id}
        return {value: op.id, label: op.label}
    })

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
