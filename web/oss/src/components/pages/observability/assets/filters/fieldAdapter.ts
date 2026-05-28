import {FilterLeaf, FilterGroup, FilterMenuNode} from "@/oss/components/Filters/types"
import {FilterConditions} from "@/oss/lib/Types"

import {FILTER_COLUMNS} from "../constants"

import {ScalarType, getOperatorsForType} from "./operatorRegistry"

export interface FieldConfig {
    optionKey: string
    baseField: string
    label: string
    type: ScalarType
    operatorIds: FilterConditions[]
    operatorOptions?: {value: FilterConditions; label: string}[]
    keyInput?: {
        kind: "none" | "text" | "select"
        options?: any[]
        placeholder?: string
        usesAttributeKeyTree?: boolean
        treePath?: string
    }
    valueInput?: {kind: "none" | "text" | "select"; options?: any[]; placeholder?: string}
    defaultValue?: any
    disableValueInput?: boolean
    valueDisplayText?: string
    queryKey?: string
    referenceProperty?: string
    /**
     * Category for the `references` family (application / evaluator /
     * application_variant / environment). Used by `mapFilterData` to
     * disambiguate which sub-column an incoming filter row maps to when
     * multiple share `baseField: "references"` and `referenceProperty: "id"`.
     */
    referenceCategory?: string
    // reference/application/evaluator transforms
    toExternal?: (normalized: any) => any
    toUI?: (external: any) => any
}

const toScalar = (leaf: FilterLeaf): ScalarType => leaf.type as ScalarType
const getOptionKey = (leaf: FilterLeaf) => leaf.optionKey ?? leaf.value

const walk = (nodes: FilterMenuNode[], acc: FieldConfig[]) => {
    nodes.forEach((n) => {
        if (n.kind === "group") return walk((n as FilterGroup).children, acc)
        const leaf = n as FilterLeaf
        const t = toScalar(leaf)
        const optionKey = getOptionKey(leaf)
        const operatorOptions = leaf.operatorOptions?.map((o) => ({
            value: o.value as FilterConditions,
            label: o.label,
        }))
        const operatorIds = (operatorOptions?.map((o) => o.value) ??
            getOperatorsForType(t).map((o) => o.id)) as FilterConditions[]

        const cfg: FieldConfig = {
            optionKey,
            baseField: leaf.field,
            label: leaf.displayLabel ?? leaf.label,
            type: t,
            operatorIds,
            operatorOptions,
            keyInput: leaf.keyInput
                ? leaf.keyInput.kind === "select"
                    ? {
                          kind: "select",
                          options: (leaf as any).keyInput?.options,
                          placeholder: leaf.keyInput.placeholder,
                          usesAttributeKeyTree: (leaf as any).keyInput?.usesAttributeKeyTree,
                          treePath: (leaf as any).keyInput?.treePath,
                      }
                    : leaf.keyInput.kind === "text"
                      ? {
                            kind: "text",
                            placeholder: leaf.keyInput.placeholder,
                        }
                      : {kind: "none"}
                : {kind: "none"},
            valueInput: leaf.disableValueInput
                ? {kind: "none"}
                : leaf.valueInput
                  ? {
                        kind: leaf.valueInput.kind as any,
                        options: (leaf as any).valueInput?.options,
                        placeholder:
                            leaf.valueInput.kind === "text"
                                ? leaf.valueInput.placeholder
                                : undefined,
                    }
                  : {kind: "text"},
            defaultValue: leaf.defaultValue,
            disableValueInput: !!leaf.disableValueInput,
            valueDisplayText: leaf.valueDisplayText,
            queryKey: leaf.queryKey,
            referenceProperty: leaf.referenceProperty,
            referenceCategory: leaf.referenceCategory,
        }

        // references/application/evaluator → keep simple mapper
        if (leaf.referenceCategory && leaf.referenceProperty) {
            cfg.toExternal = (normalized: any) => {
                const entries = Array.isArray(normalized)
                    ? normalized
                    : normalized
                      ? [normalized]
                      : []
                const withKey =
                    leaf.referenceCategory === "application"
                        ? {"attributes.key": "application"}
                        : leaf.referenceCategory === "evaluator"
                          ? {"attributes.key": "evaluator"}
                          : leaf.referenceCategory === "application_variant"
                            ? {"attributes.key": "application_variant"}
                            : {}
                return entries.map((v) =>
                    typeof v === "object" && v
                        ? {...withKey, ...v}
                        : {...withKey, [leaf.referenceProperty!]: String(v)},
                )
            }
            cfg.toUI = (external: any) => {
                const arr = Array.isArray(external) ? external : external ? [external] : []
                // De-dup by extracted value. References can OR-match across
                // slots in a single condition (e.g.,
                // `[{id:X, key:eval}, {id:X, key:app}]` for "match this entity
                // in either slot"). Without de-dup the UI shows the same id
                // twice. The backend keeps the rich shape via `toExternal`.
                const mapped = arr.map((e: any) =>
                    e && typeof e === "object" ? (e[leaf.referenceProperty!] ?? "") : e,
                )
                const seen = new Set<string>()
                const out: any[] = []
                for (const v of mapped) {
                    const key = typeof v === "string" ? v : JSON.stringify(v)
                    if (seen.has(key)) continue
                    seen.add(key)
                    out.push(v)
                }
                return out
            }
        }

        acc.push(cfg)
    })
    return acc
}

export const buildFieldConfigs = (nodes: FilterMenuNode[] = FILTER_COLUMNS): FieldConfig[] =>
    walk(nodes, [])

export const fieldConfigByOptionKey = (nodes: FilterMenuNode[] = FILTER_COLUMNS) => {
    const map = new Map<string, FieldConfig>()
    buildFieldConfigs(nodes).forEach((fc) => map.set(fc.optionKey, fc))
    return map
}
