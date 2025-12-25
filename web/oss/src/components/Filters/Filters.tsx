import {useMemo, useState} from "react"

import {
    ArrowClockwiseIcon,
    CaretDownIcon,
    FunnelIcon,
    PlusIcon,
    TrashIcon,
} from "@phosphor-icons/react"
import {
    Button,
    Divider,
    Dropdown,
    Input,
    MenuProps,
    Popover,
    Select,
    Space,
    TreeSelect,
    Typography,
} from "antd"
import isEqual from "lodash/isEqual"

import {
    FieldConfig,
    fieldConfigByOptionKey,
} from "@/oss/components/pages/observability/assets/filters/fieldAdapter"
import {
    getOperator,
    valueShapeFor,
} from "@/oss/components/pages/observability/assets/filters/operatorRegistry"
import {planInputs} from "@/oss/components/pages/observability/assets/filters/rulesEngine"
import {
    normalizeFilter,
    toUIValue,
} from "@/oss/components/pages/observability/assets/filters/valueCodec"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import {EvaluatorPreviewDto} from "@/oss/lib/hooks/useEvaluators/types"
import {Filter, FilterConditions} from "@/oss/lib/Types"

import CustomAntdBadge from "../CustomUIs/CustomAntdBadge"
import {
    NUM_OPS,
    STRING_EQU_AND_CONTAINS_OPS,
    STRING_EQU_OPS,
} from "../pages/observability/assets/utils"

import {useStyles} from "./assets/styles"
import {
    buildCustomTreeNode,
    collectOptionValues,
    collectTreeKeys,
    createEmptyFilter,
    CUSTOM_FIELD_VALUE,
    effectiveFieldForRow,
    getGroupDefaultValue,
    getOptionKey,
    isBooleanLike,
    isNumberLike,
    mapToTreeData,
    noopTreeExpand,
    normalizeAttributeSearch,
    operatorOptionsFromIds,
    valueToPathLabel,
} from "./helpers/utils"
import {
    FieldMenuItem,
    FilterGroup,
    FilterItem,
    FilterLeaf,
    FilterMenuNode,
    Props,
    RowValidation,
    SelectOption,
} from "./types"

type AnnotationFeedbackValueType = "string" | "number" | "boolean"

interface AnnotationFeedbackCondition {
    field?: string | string[]
    operator?: FilterConditions
    value?: string | number | boolean
    valueType?: AnnotationFeedbackValueType
}

interface AnnotationFilterValue {
    evaluator?: string
    feedback?: AnnotationFeedbackCondition
}

interface AnnotationFeedbackOption {
    label: string
    value: string
    evaluatorSlug: string
    evaluatorLabel: string
    type: AnnotationFeedbackValueType
}

const ALL_FEEDBACK_OPERATOR_OPTIONS = [...STRING_EQU_AND_CONTAINS_OPS, ...NUM_OPS]

const ALL_FEEDBACK_OPERATOR_VALUES = new Set(ALL_FEEDBACK_OPERATOR_OPTIONS.map((opt) => opt.value))

const NUMERIC_FEEDBACK_OPERATOR_VALUES = new Set(NUM_OPS.map((opt) => opt.value))

// Collapse multiple "any evaluator" annotation rows that differ only by feedback.key
// back into a single UI row with feedback.field: string[]
const collapseAnnotationAnyEvaluatorRowsFromProps = (
    items: FilterItem[],
    getField: (uiKey?: string) => FieldConfig | undefined,
): FilterItem[] => {
    type GroupKey = string
    const groups = new Map<GroupKey, FilterItem>()
    const order: GroupKey[] = []

    const makeKey = (it: FilterItem, ann: any) => {
        // Build a key that ignores feedback.field but includes everything else
        const uiKey = it.selectedField || it.field || ""
        const base = {
            uiKey,
            isCustomField: it.isCustomField,
            baseField: it.baseField,
            key: it.key ?? "",
            operator: it.operator ?? "",
            // Feedback parts that must match to be considered the same group
            fbOperator: ann?.feedback?.operator ?? "",
            fbValueType: ann?.feedback?.valueType ?? "string",
            fbValue: ann?.feedback?.value ?? "",
            evaluator: ann?.evaluator ?? undefined, // must be undefined for “any evaluator”
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

        // Only collapse when it’s “any evaluator” and the feedback field is a single key
        if (anyEvaluator && typeof fbField === "string" && fbField) {
            const key = makeKey(it, ann)
            const existing = groups.get(key)
            if (!existing) {
                // First in group → convert feedback.field into array
                const clone: FilterItem = JSON.parse(JSON.stringify(it))
                const cAnn = extractAnnotationValue(clone.value)!
                cAnn.feedback = {...(cAnn.feedback ?? {}), field: [fbField]}
                clone.value = [cAnn]
                resultPush(key, clone)
            } else {
                // Append to array (dedupe)
                const eAnn = extractAnnotationValue(existing.value)!
                const arr = Array.isArray(eAnn.feedback?.field)
                    ? (eAnn.feedback!.field as string[])
                    : []
                if (!arr.includes(fbField)) arr.push(fbField)
                eAnn.feedback = {...(eAnn.feedback ?? {}), field: arr}
                existing.value = [eAnn]
            }
        } else {
            // Pass-through rows that aren’t “any evaluator” singles
            const passthroughKey = `__pt__${Math.random().toString(36).slice(2)}`
            resultPush(passthroughKey, it)
        }
    }

    return order.map((k) => groups.get(k)!)
}

const extractAnnotationValue = (raw: FilterItem["value"]): AnnotationFilterValue | undefined => {
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

const EMPTY_DISABLED_OPTIONS = new Set<string>()

const buildFieldMenuItems = (
    nodes: FilterMenuNode[],
    onSelect: (value: string, displayLabel?: string) => void,
    parentKey = "root",
    ancestors: FilterGroup[] = [],
    submenuPopupClassName?: string,
    disabledOptionKeys: Set<string> = EMPTY_DISABLED_OPTIONS,
): MenuProps["items"] => {
    const items: MenuProps["items"] = []
    nodes.forEach((node, index) => {
        if (node.kind === "group") {
            const group = node as FilterGroup
            const groupKey = `group:${parentKey}:${index}`
            const defaultValue = getGroupDefaultValue(group)
            const isDefaultDisabled = defaultValue ? disabledOptionKeys.has(defaultValue) : false
            items.push({
                key: groupKey,
                label: (
                    <div
                        className={
                            defaultValue
                                ? "flex items-center gap-2 cursor-pointer"
                                : "flex items-center gap-2"
                        }
                    >
                        {group.icon ? <group.icon size={16} /> : null}
                        <span>{group.label}</span>
                    </div>
                ),
                children: buildFieldMenuItems(
                    group.children,
                    onSelect,
                    groupKey,
                    [...ancestors, group],
                    submenuPopupClassName,
                    disabledOptionKeys,
                ),
                onTitleClick: defaultValue
                    ? ({domEvent}: {domEvent: MouseEvent}) => {
                          if (isDefaultDisabled) {
                              domEvent.preventDefault()
                              domEvent.stopPropagation()
                              return
                          }
                          domEvent.preventDefault()
                          domEvent.stopPropagation()
                          onSelect(
                              defaultValue,
                              group.titleClickDisplayLabel ?? group.leafDisplayLabel,
                          )
                      }
                    : undefined,
                // popupClassName: submenuPopupClassName,
                classNames: {
                    popup: {
                        root: submenuPopupClassName,
                    },
                },
            } as FieldMenuItem)
        } else {
            const leaf = node as FilterLeaf
            const optionKey = getOptionKey(leaf)
            items.push({
                key: optionKey,
                label: (
                    <div className="flex items-center gap-2">
                        {leaf.icon ? <leaf.icon size={16} /> : null}
                        <span>{leaf.label}</span>
                    </div>
                ),
                disabled: disabledOptionKeys.has(optionKey),
            } as FieldMenuItem)
        }
    })
    return items
}

const Filters: React.FC<Props> = ({
    filterData,
    columns,
    onApplyFilter,
    onClearFilter,
    buttonProps,
}) => {
    const classes = useStyles()

    const {data: evaluatorPreviews} = useEvaluators({preview: true})

    const annotationEvaluatorOptions = useMemo(
        () =>
            (evaluatorPreviews ?? []).map((evaluator) => ({
                label: evaluator.name || evaluator.slug,
                value: evaluator.slug,
            })),
        [evaluatorPreviews],
    )

    const deriveFeedbackValueType = (schema: any): AnnotationFeedbackValueType => {
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

    const annotationFeedbackOptions = useMemo(() => {
        if (!evaluatorPreviews) return [] as AnnotationFeedbackOption[]
        const options: AnnotationFeedbackOption[] = []
        evaluatorPreviews.forEach((evaluator: EvaluatorPreviewDto) => {
            const metrics = evaluator.metrics ?? {}
            Object.entries(metrics).forEach(([key, schema]) => {
                const typedSchema = schema as any
                options.push({
                    label: typedSchema?.title ?? key,
                    value: key,
                    evaluatorSlug: evaluator.slug,
                    evaluatorLabel: evaluator.name || evaluator.slug,
                    type: deriveFeedbackValueType(typedSchema),
                })
            })
        })
        return options
    }, [evaluatorPreviews])

    // Dedupe feedback options by feedback key across evaluators
    const dedupeFeedbackOptions = (options: AnnotationFeedbackOption[]) => {
        const byKey = new Map<string, AnnotationFeedbackOption>()
        for (const opt of options) {
            if (!byKey.has(opt.value)) byKey.set(opt.value, opt)
        }
        return Array.from(byKey.values())
    }

    const fieldMap = useMemo(() => fieldConfigByOptionKey(columns), [columns])
    const getField = (uiKey?: string): FieldConfig | undefined =>
        uiKey ? fieldMap.get(uiKey) : undefined

    const mapFilterData = (data: Filter[]): FilterItem[] =>
        data.map((item) => {
            const byOptionKey = getField(item.field)
            const field =
                byOptionKey ??
                (() => {
                    if (item.key) {
                        for (const fc of fieldMap.values()) if (fc.queryKey === item.key) return fc
                    }
                    const matches: FieldConfig[] = []
                    for (const fc of fieldMap.values())
                        if (fc.baseField === item.field || (item.key && fc.baseField === item.key))
                            matches.push(fc)
                    if (matches.length > 1) {
                        const valuesArray = Array.isArray(item.value)
                            ? item.value
                            : item.value == null
                              ? []
                              : [item.value]
                        for (const candidate of matches) {
                            if (!candidate.referenceProperty) continue
                            const refProp = candidate.referenceProperty
                            const hasMatch = valuesArray.some(
                                (entry) => entry && typeof entry === "object" && refProp in entry,
                            )
                            if (hasMatch) return candidate
                        }
                    }
                    return matches[0]
                })()

            if (field) {
                const pre = field.toUI ? field.toUI(item.value) : item.value
                const shape = item.operator
                    ? valueShapeFor(item.operator as any, field.type)
                    : "single"
                const valueUI = toUIValue(pre, shape)
                return {
                    ...item,
                    field: field.optionKey,
                    key: item.key ?? "",
                    selectedField: field.optionKey,
                    fieldType: field.type,
                    isCustomField: false,
                    baseField: field.baseField,
                    selectedLabel: field.label,
                    value: valueUI,
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

    const sanitizeFilterItems = (items: FilterItem[]): Filter[] =>
        items.map(
            ({
                field,
                key,
                operator,
                value,
                isPermanent,
                baseField,
                selectedField,
                customValueType,
            }) => {
                const fc = getField(selectedField || field || "")
                if (!fc) {
                    const raw: Filter = {field, key, operator, value}
                    return isPermanent ? {...raw, isPermanent} : raw
                }

                const isException =
                    fc.baseField === "events" &&
                    (operator === "exists" || operator === "not_exists")

                let valueToSend = value
                if (fc.optionKey === "custom") {
                    const vt = customValueType ?? "string"
                    const effType = vt === "number" ? "number" : "string"
                    const shape = operator
                        ? valueShapeFor(operator as any, effType as any)
                        : "single"

                    const toBool = (raw: unknown) => {
                        const s = String(Array.isArray(raw) ? raw[0] : raw)
                            .trim()
                            .toLowerCase()
                        return s === "true" ? true : s === "false" ? false : undefined
                    }
                    const toNum = (raw: unknown) => {
                        const n = Number(Array.isArray(raw) ? raw[0] : (raw as any))
                        return Number.isFinite(n) ? n : undefined
                    }

                    if (vt === "number") {
                        if (shape === "list") {
                            const arr = Array.isArray(value) ? value : [value]
                            valueToSend = arr
                                .map((v) => Number(v))
                                .filter((n) => Number.isFinite(n))
                        } else if (shape === "range") {
                            const arr = Array.isArray(value) ? value : []
                            const a = Number(arr[0]),
                                b = Number(arr[1])
                            valueToSend =
                                Number.isFinite(a) && Number.isFinite(b) ? [a, b] : undefined
                        } else {
                            valueToSend = toNum(value)
                        }
                    } else if (vt === "boolean") {
                        if (shape === "list") {
                            const arr = Array.isArray(value) ? value : [value]
                            const mapped = arr.map((v) => {
                                const s = String(v).trim().toLowerCase()
                                return s === "true" ? true : s === "false" ? false : undefined
                            })
                            valueToSend = mapped.filter((v) => v !== undefined)
                            if ((valueToSend as unknown[]).length === 0) valueToSend = undefined
                        } else {
                            valueToSend = toBool(value)
                        }
                    } else {
                        if (shape === "list") {
                            valueToSend = Array.isArray(value) ? value : [value].filter(Boolean)
                        } else if (shape === "range") {
                            valueToSend = Array.isArray(value) ? value : value
                        } else {
                            valueToSend = Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
                        }
                    }
                }

                if (isException) valueToSend = fc.defaultValue ?? valueToSend

                const keyForFilter = key && key !== "" ? key : fc.queryKey
                const filterForNormalization: Filter = {
                    field: fc.baseField,
                    operator,
                    value: valueToSend,
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

    const [filter, setFilter] = useState<FilterItem[]>(() =>
        !filterData?.length ? [createEmptyFilter()] : mapFilterData(filterData),
    )
    const [activeFieldDropdown, setActiveFieldDropdown] = useState<number | null>(null)
    const [isFilterOpen, setIsFilterOpen] = useState(false)
    const [keySearchTerms, setKeySearchTerms] = useState<Record<number, string>>({})

    const sanitizedFilters = useMemo(() => {
        return sanitizeFilterItems(
            filter.filter(({field, operator, isPermanent, isCustomField}) => {
                if (isPermanent) return true
                if (!operator) return false
                if (isCustomField) return !!field
                return !!field
            }),
        )
    }, [filter])

    useLazyEffect(() => {
        if (filterData && filterData.length > 0) {
            const mapped = mapFilterData(filterData)
            // NEW: collapse expanded any-evaluator annotation rows back into one UI row
            const collapsed = collapseAnnotationAnyEvaluatorRowsFromProps(mapped, getField)
            setFilter(collapsed)
        } else {
            setFilter([])
        }
    }, [filterData, columns])

    const handleFieldSelection = (uiValue: string, idx: number, selectedLabel?: string) => {
        setFilter((prev) => {
            const next = [...prev]
            const current = {...next[idx]}
            if (uiValue === CUSTOM_FIELD_VALUE) {
                Object.assign(current, {
                    selectedField: undefined,
                    field: "",
                    key: "",
                    operator: "",
                    value: "",
                    fieldType: undefined,
                    isCustomField: true,
                    baseField: undefined,
                    selectedLabel: undefined,
                    customValueType: undefined,
                })
            } else {
                const field = getField(uiValue)!
                current.selectedField = field.optionKey
                current.field = field.optionKey
                current.key = field.keyInput?.kind === "none" ? (field.queryKey ?? "") : ""
                current.operator = field.operatorIds[0] ?? ""
                const effType = field.optionKey === "custom" ? "string" : field.type
                const shape = current.operator
                    ? valueShapeFor(current.operator as any, effType as any)
                    : "single"
                let defaultValue = toUIValue(field.defaultValue, shape)
                if (
                    shape === "list" &&
                    current.operator &&
                    planInputs(field, current.operator as any).valueAs === "text" &&
                    (defaultValue == null ||
                        (Array.isArray(defaultValue) && defaultValue.length === 0))
                ) {
                    defaultValue = ""
                }
                current.value = defaultValue
                current.fieldType = field.type
                current.isCustomField = false
                current.baseField = field.baseField
                current.selectedLabel = selectedLabel ?? field.label
                current.customValueType = field.optionKey === "custom" ? "string" : undefined
            }
            next[idx] = current
            return next
        })
        setKeySearchTerms((prev) => {
            if (!(idx in prev)) return prev
            const next = {...prev}
            delete next[idx]
            return next
        })
        setActiveFieldDropdown(null)
    }

    const onFilterChange = ({
        columnName,
        value,
        idx,
    }: {
        columnName: keyof FilterItem
        value: any
        idx: number
    }) => {
        setFilter((prev) => {
            const next = [...prev]
            const current = {...next[idx]}
            const field = getField(current.selectedField || current.field || "")

            if (columnName === "operator" && field) {
                const effType =
                    field.optionKey === "custom"
                        ? current.customValueType === "number"
                            ? "number"
                            : "string"
                        : field.type
                const shape = valueShapeFor(value as any, effType as any)
                current.value = toUIValue(current.value, shape)
                current.operator = value
                next[idx] = current
                return next
            }

            next[idx] = {...current, [columnName]: value}
            return next
        })
        if (columnName === "key") {
            setKeySearchTerms((prev) => {
                if (!(idx in prev)) return prev
                const next = {...prev}
                delete next[idx]
                return next
            })
        }
    }

    const rowValidations: RowValidation[] = filter.map((item) => {
        if (item.isPermanent) return {isValid: true}

        const uiKey = item.selectedField || item.field || ""
        const baseFieldCfg = getField(uiKey)
        const field = effectiveFieldForRow(baseFieldCfg, item)

        if (!field) return {isValid: false}

        const operatorValue =
            item.operator || (field.operatorIds.length === 1 ? field.operatorIds[0] : "")
        if (!operatorValue) return {isValid: false}

        const needsKey = !!field.keyInput && field.keyInput.kind !== "none"
        if (needsKey && (!item.key || item.key === "")) return {isValid: false}

        const hidesValue =
            getOperator(operatorValue as any).hidesValue || field.valueInput?.kind === "none"
        if (hidesValue) return {isValid: true}

        const effType =
            field.optionKey === "custom"
                ? item.customValueType === "number"
                    ? "number"
                    : "string"
                : field.type
        const wantsBooleanValidation =
            field.optionKey === "custom" && item.customValueType === "boolean"
        const wantsNumberValidation = effType === "number"

        const shape = valueShapeFor(operatorValue as any, effType as any)
        const value = item.value

        if (shape === "range") {
            let parsed: unknown[] | null = null
            if (Array.isArray(value)) parsed = value
            else if (typeof value === "string") {
                const trimmed = value.trim()
                if (!trimmed) return {isValid: false}
                try {
                    const json = JSON.parse(value)
                    if (Array.isArray(json)) parsed = json
                } catch {
                    parsed = null
                }
            } else if (value == null) {
                return {isValid: false}
            }

            if (!parsed || parsed.length !== 2) {
                return {isValid: false, valueInvalid: true}
            }

            if (wantsNumberValidation && parsed.some((entry) => !isNumberLike(entry))) {
                return {isValid: false, valueInvalid: true}
            }

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
    })

    const isApplyDisabled = rowValidations.some(({isValid}) => !isValid)

    const onDeleteFilter = (index: number) =>
        setFilter((prev) => prev.filter((_, idx) => idx !== index))
    const clearFilter = () => {
        const kept = filter.filter((f) => f.isPermanent)
        const sanitizedKept = sanitizeFilterItems(kept)
        if (!isEqual(sanitizedKept, filterData)) onClearFilter(sanitizedKept)
        setActiveFieldDropdown(null)
        setFilter(kept.length ? kept : [])
    }

    const getFilterOptionKey = (item: FilterItem) =>
        item.selectedField ||
        (typeof item.field === "string" && item.field ? item.field : undefined) ||
        item.baseField ||
        ""

    const annotationDisabledOptions = useMemo(() => new Set<string>(["has_annotation"]), [])

    const hasAnnotationIndices = useMemo(
        () =>
            filter.reduce<number[]>((acc, current, index) => {
                if (getFilterOptionKey(current) === "has_annotation") acc.push(index)
                return acc
            }, []),
        [filter],
    )

    // Explode "any evaluator + multi feedback" rows into multiple rows so the backend can treat each feedback separately
    const explodeAnnotationAnyEvaluatorRows = (items: FilterItem[]): FilterItem[] => {
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

    const applyFilter = () => {
        const expanded = explodeAnnotationAnyEvaluatorRows(filter)
        const out = sanitizeFilterItems(expanded)
        if (!isEqual(out, filterData)) onApplyFilter(out)
        setActiveFieldDropdown(null)
        setIsFilterOpen(false)
    }

    const getWithinPopover = (trigger: HTMLElement | null) =>
        (trigger && (trigger.closest(".ant-popover") as HTMLElement)) || document.body

    const dropdownPanelStyle = {
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "60vh",
        overflow: "auto",
    } as const

    return (
        <Popover
            title={null}
            trigger="click"
            overlayClassName={classes.popover}
            arrow={false}
            onOpenChange={(open) => {
                setIsFilterOpen(open)
                if (!open) setActiveFieldDropdown(null)
            }}
            open={isFilterOpen}
            placement="bottomLeft"
            autoAdjustOverflow
            styles={{body: {maxHeight: "70vh"}, root: {maxWidth: "100vw"}}}
            destroyOnHidden
            content={
                <section>
                    <div className={classes.filterHeading}>
                        <Typography.Text>Filter</Typography.Text>
                    </div>
                    <div className="-ml-4 -mr-2">
                        <Divider className="!m-0" />
                    </div>

                    <div className={classes.filterContainer}>
                        {filter.map((item, idx) => {
                            const uiKey = item.selectedField || item.field || ""
                            const baseFieldCfg = getField(uiKey)
                            const field = effectiveFieldForRow(baseFieldCfg, item)

                            const isAnnotationFieldSelected =
                                field?.baseField?.includes("annotation") ?? false

                            const operatorOptions = field
                                ? (field.operatorOptions ??
                                  operatorOptionsFromIds(field.operatorIds))
                                : []

                            const singleOperator = operatorOptions.length === 1
                            const operatorValue =
                                item.operator ||
                                (singleOperator ? operatorOptions[0]?.value : undefined)

                            const plan =
                                field && operatorValue
                                    ? planInputs(field, operatorValue as any)
                                    : undefined
                            const showKey = Boolean(plan?.needsKey)
                            const showValue = Boolean(plan?.showValue)
                            const valueAs = plan?.valueAs
                            const valueOptions = plan?.valueOptions
                            const keyPlaceholder = plan?.placeholders?.key ?? "Key"
                            const valuePlaceholder = plan?.placeholders?.value ?? "Value"

                            const rawValue = Array.isArray(item.value) ? "" : (item.value as any)
                            const displayValue = (field as any)?.valueDisplayText || rawValue
                            const validation = rowValidations[idx] ?? {isValid: true}
                            const valueHasError = Boolean(validation.valueInvalid)

                            const annotationValue = extractAnnotationValue(item.value)

                            const disableHasAnnotationForRow = hasAnnotationIndices.some(
                                (annotationIdx) => annotationIdx !== idx,
                            )
                            const disabledFieldOptionsForMenu = disableHasAnnotationForRow
                                ? annotationDisabledOptions
                                : undefined

                            const setAnnotationValue = (
                                updater: (
                                    prev: AnnotationFilterValue | undefined,
                                ) => AnnotationFilterValue | undefined,
                            ) => {
                                const next = updater(
                                    annotationValue ? {...annotationValue} : undefined,
                                )
                                if (!next || Object.keys(next).length === 0) {
                                    onFilterChange({columnName: "value", value: [], idx})
                                    return
                                }

                                const valueToStore: AnnotationFilterValue = {...next}
                                if (valueToStore.feedback) {
                                    const cleanedFeedback = {...valueToStore.feedback}
                                    if (cleanedFeedback.valueType === undefined)
                                        cleanedFeedback.valueType = "string"
                                    valueToStore.feedback = cleanedFeedback
                                }

                                onFilterChange({columnName: "value", value: [valueToStore], idx})
                            }

                            const currentFeedback = annotationValue?.feedback

                            // Build available feedback options
                            const availableFeedbackOptions = (() => {
                                if (annotationValue?.evaluator) {
                                    const filtered = annotationFeedbackOptions.filter(
                                        (option) =>
                                            option.evaluatorSlug === annotationValue.evaluator,
                                    )
                                    // Keep currently selected key if it exists and is not part of filtered
                                    const selectedKey = Array.isArray(currentFeedback?.field)
                                        ? currentFeedback?.field[0]
                                        : currentFeedback?.field
                                    const selected = selectedKey
                                        ? annotationFeedbackOptions.find(
                                              (option) => option.value === selectedKey,
                                          )
                                        : undefined
                                    if (
                                        selected &&
                                        !filtered.some((o) => o.value === selected.value)
                                    )
                                        return [selected, ...filtered]
                                    return filtered
                                }
                                // No evaluator. Show deduped feedback names across all evaluators
                                return dedupeFeedbackOptions(annotationFeedbackOptions)
                            })()

                            // Pick a type from the first selected key if present
                            const selectedFeedbackKey = Array.isArray(currentFeedback?.field)
                                ? currentFeedback?.field[0]
                                : currentFeedback?.field
                            const selectedFeedbackOption = selectedFeedbackKey
                                ? availableFeedbackOptions.find(
                                      (option) => option.value === selectedFeedbackKey,
                                  )
                                : undefined

                            const feedbackValueType =
                                currentFeedback?.valueType ??
                                selectedFeedbackOption?.type ??
                                "string"

                            const isEvaluatorActive = annotationValue
                                ? "evaluator" in annotationValue
                                : false
                            const isFeedbackActive = annotationValue
                                ? "feedback" in annotationValue
                                : false

                            const feedbackOperatorOptions = ALL_FEEDBACK_OPERATOR_OPTIONS

                            const coerceNumericFeedbackValue = (
                                input: unknown,
                            ): string | number | undefined => {
                                if (typeof input === "number")
                                    return Number.isFinite(input) ? input : undefined
                                if (typeof input === "string") {
                                    const trimmed = input.trim()
                                    if (!trimmed) return ""
                                    const numericPattern = /^-?(?:\d+|\d*\.\d+)$/
                                    return numericPattern.test(trimmed) ? Number(trimmed) : input
                                }
                                return undefined
                            }

                            const parseFeedbackArrayInput = (input: string): any[] | undefined => {
                                const trimmed = input.trim()
                                if (!trimmed.startsWith("[") || !trimmed.endsWith("]"))
                                    return undefined
                                try {
                                    const parsed = JSON.parse(trimmed)
                                    return Array.isArray(parsed) ? parsed : undefined
                                } catch {
                                    return undefined
                                }
                            }

                            const ensureFeedbackOperator = (
                                type: AnnotationFeedbackValueType,
                                current?: FilterConditions,
                            ): FilterConditions => {
                                if (current && ALL_FEEDBACK_OPERATOR_VALUES.has(current))
                                    return current
                                if (type === "number") {
                                    return NUM_OPS[0]?.value ?? ""
                                }
                                return STRING_EQU_OPS[0]?.value ?? ""
                            }

                            const handleEvaluatorChange = (value?: string) => {
                                setAnnotationValue((prev) => {
                                    const base: AnnotationFilterValue = {...(prev ?? {})}

                                    if (!value) {
                                        // Removing evaluator. Keep feedback as is. Now it means across any evaluator
                                        delete base.evaluator
                                        return Object.keys(base).length ? base : undefined
                                    }

                                    base.evaluator = value

                                    if (base.feedback?.field) {
                                        const allowed = new Set(
                                            annotationFeedbackOptions
                                                .filter((o) => o.evaluatorSlug === value)
                                                .map((o) => o.value),
                                        )
                                        if (Array.isArray(base.feedback.field)) {
                                            const kept = base.feedback.field.filter((k) =>
                                                allowed.has(k),
                                            )
                                            base.feedback.field = kept[0] ?? undefined
                                        } else if (
                                            base.feedback.field &&
                                            !allowed.has(base.feedback.field)
                                        ) {
                                            base.feedback.field = undefined
                                        }
                                    }

                                    return base
                                })
                            }

                            const handleFeedbackFieldChange = (value: string | string[]) => {
                                setAnnotationValue((prev) => {
                                    const base: AnnotationFilterValue = {...(prev ?? {})}
                                    const feedback = {...(base.feedback ?? {})}

                                    const nextField: string | string[] = annotationValue?.evaluator
                                        ? Array.isArray(value)
                                            ? value[0]
                                            : value
                                        : value

                                    const sampleKey = Array.isArray(nextField)
                                        ? nextField[0]
                                        : nextField
                                    const option = availableFeedbackOptions.find(
                                        (opt) => opt.value === sampleKey,
                                    )
                                    const nextType = option
                                        ? option.type
                                        : (feedback.valueType ?? "string")

                                    feedback.field = nextField
                                    feedback.valueType = nextType
                                    feedback.operator = ensureFeedbackOperator(
                                        nextType,
                                        feedback.operator,
                                    )
                                    feedback.value = nextType === "boolean" ? true : ""

                                    base.feedback = feedback
                                    return base
                                })
                            }

                            const handleFeedbackOperatorChange = (operator: FilterConditions) => {
                                setAnnotationValue((prev) => {
                                    const base: AnnotationFilterValue = {...(prev ?? {})}
                                    const feedback = {...(base.feedback ?? {}), operator}

                                    if (NUMERIC_FEEDBACK_OPERATOR_VALUES.has(operator)) {
                                        feedback.valueType = "number"
                                        const currentValue = feedback.value
                                        const coerced = coerceNumericFeedbackValue(currentValue)
                                        feedback.value = coerced === undefined ? "" : coerced
                                    }

                                    base.feedback = feedback
                                    return base
                                })
                            }

                            const handleFeedbackTypeChange = (
                                type: AnnotationFeedbackValueType,
                            ) => {
                                setAnnotationValue((prev) => {
                                    const base: AnnotationFilterValue = {...(prev ?? {})}
                                    const feedback = {...(base.feedback ?? {})}
                                    feedback.valueType = type
                                    feedback.operator = ensureFeedbackOperator(
                                        type,
                                        feedback.operator,
                                    )
                                    feedback.value = type === "boolean" ? true : ""
                                    base.feedback = feedback
                                    return base
                                })
                            }

                            const handleFeedbackValueChange = (raw: string | number | boolean) => {
                                setAnnotationValue((prev) => {
                                    const base: AnnotationFilterValue = {...(prev ?? {})}
                                    const fb = {...(base.feedback ?? {})}

                                    const type = fb.valueType ?? "string"
                                    let value: any = raw as any

                                    if (typeof raw === "string") {
                                        const parsedArray = parseFeedbackArrayInput(raw)
                                        if (parsedArray !== undefined) {
                                            value = parsedArray
                                        }
                                    }

                                    if (!Array.isArray(value)) {
                                        if (type === "number") {
                                            if (typeof raw === "number") {
                                                value = Number.isFinite(raw) ? raw : fb.value
                                            } else {
                                                const coerced = coerceNumericFeedbackValue(raw)
                                                value = coerced === undefined ? "" : coerced
                                            }
                                        } else if (type === "boolean") {
                                            if (typeof raw === "boolean") {
                                                value = raw
                                            } else {
                                                const s = String(raw).trim().toLowerCase()
                                                value =
                                                    s === "true"
                                                        ? true
                                                        : s === "false"
                                                          ? false
                                                          : undefined
                                            }
                                        } else if (typeof raw === "string") {
                                            value = raw
                                        } else {
                                            value = String(raw)
                                        }
                                    }

                                    base.feedback = {...fb, value}
                                    return base
                                })
                            }

                            const removeEvaluator = () => {
                                setAnnotationValue((prev) => {
                                    if (!prev?.feedback) {
                                        onDeleteFilter(idx)
                                        return undefined
                                    }
                                    const next = {...(prev ?? {})}
                                    delete next.evaluator
                                    return Object.keys(next).length ? next : undefined
                                })
                            }

                            const removeFeedback = () => {
                                setAnnotationValue((prev) => {
                                    if (!prev?.feedback) return prev

                                    if (!prev.evaluator) {
                                        onDeleteFilter(idx)
                                        return undefined
                                    }
                                    const next = {...(prev ?? {})}
                                    delete next.feedback
                                    return Object.keys(next).length ? next : undefined
                                })
                            }

                            const feedbackValueRaw = (() => {
                                const raw = currentFeedback?.value
                                if (Array.isArray(raw)) {
                                    try {
                                        return JSON.stringify(raw)
                                    } catch {
                                        return ""
                                    }
                                }
                                if (raw && typeof raw === "object") {
                                    try {
                                        return JSON.stringify(raw)
                                    } catch {
                                        return ""
                                    }
                                }
                                if (raw === undefined || raw === null) return ""
                                if (typeof raw === "string") return raw
                                if (typeof raw === "number") return String(raw)
                                if (typeof raw === "boolean") return raw ? "true" : "false"
                                return ""
                            })()

                            const renderAddFeedbackButton = () => (
                                <Button
                                    type="text"
                                    icon={<PlusIcon size={14} />}
                                    onClick={() =>
                                        setAnnotationValue((prev) => ({
                                            ...(prev ?? {}),
                                            feedback: {
                                                field: undefined,
                                                operator: ensureFeedbackOperator("string"),
                                                value: "",
                                                valueType: "string",
                                            },
                                        }))
                                    }
                                >
                                    Add Feedback
                                </Button>
                            )

                            const feedbackFieldValueForSelect: string | string[] | undefined =
                                (() => {
                                    const f = currentFeedback?.field
                                    if (Array.isArray(f)) return f
                                    return f ?? undefined
                                })()

                            const feedbackOptionsForSelect = availableFeedbackOptions.map(
                                (option) => ({
                                    label: annotationValue?.evaluator ? option.label : option.label,
                                    value: option.value,
                                }),
                            )

                            return (
                                <Space
                                    orientation="vertical"
                                    className={`overflow-x-auto [&::-webkit-scrollbar]:!w-0 [&::-webkit-scrollbar]:!h-0`}
                                    size={0}
                                    key={idx}
                                >
                                    <Typography.Text type="secondary">
                                        {idx === 0 ? "Where" : "And"}
                                    </Typography.Text>

                                    <Space orientation="vertical" className="w-full">
                                        <div className="flex items-center gap-2 w-full">
                                            <Dropdown
                                                trigger={["click"]}
                                                placement="bottomLeft"
                                                open={activeFieldDropdown === idx}
                                                onOpenChange={(open) =>
                                                    setActiveFieldDropdown(open ? idx : null)
                                                }
                                                menu={{
                                                    items: buildFieldMenuItems(
                                                        columns,
                                                        (value, labelFromGroup) =>
                                                            handleFieldSelection(
                                                                value,
                                                                idx,
                                                                labelFromGroup,
                                                            ),
                                                        "root",
                                                        [],
                                                        classes.fieldDropdownSubmenu,
                                                        disabledFieldOptionsForMenu ??
                                                            EMPTY_DISABLED_OPTIONS,
                                                    ),
                                                    onClick: ({key}) =>
                                                        handleFieldSelection(String(key), idx),
                                                }}
                                                getPopupContainer={(t) => getWithinPopover(t)}
                                            >
                                                <Button
                                                    className="w-[180px] flex items-center justify-between"
                                                    disabled={item.isPermanent}
                                                >
                                                    <span className="truncate">
                                                        {item.isCustomField
                                                            ? "Custom"
                                                            : (item.selectedLabel ??
                                                              field?.label ??
                                                              "Field")}
                                                    </span>
                                                    <CaretDownIcon size={14} />
                                                </Button>
                                            </Dropdown>

                                            {showKey &&
                                                (field!.keyInput!.kind === "select" ? (
                                                    (() => {
                                                        const options = field!.keyInput!
                                                            .options as SelectOption[]
                                                        const optionValues =
                                                            collectOptionValues(options)
                                                        const currentSearch =
                                                            keySearchTerms[idx] ?? ""
                                                        const normalizedSearch =
                                                            normalizeAttributeSearch(currentSearch)
                                                        const additionalNodes: NonNullable<
                                                            TreeSelectProps["treeData"]
                                                        > = []
                                                        const keyValue =
                                                            item.key === undefined ||
                                                            item.key === null
                                                                ? undefined
                                                                : String(item.key)
                                                        if (
                                                            normalizedSearch &&
                                                            !optionValues.has(
                                                                normalizedSearch.value,
                                                            )
                                                        ) {
                                                            additionalNodes.push(
                                                                buildCustomTreeNode(
                                                                    normalizedSearch.value,
                                                                    normalizedSearch.pathLabel,
                                                                ),
                                                            )
                                                        }
                                                        if (
                                                            keyValue &&
                                                            !optionValues.has(keyValue) &&
                                                            !additionalNodes.some(
                                                                (node) => node.value === keyValue,
                                                            )
                                                        ) {
                                                            additionalNodes.push(
                                                                buildCustomTreeNode(
                                                                    keyValue,
                                                                    valueToPathLabel(keyValue),
                                                                ),
                                                            )
                                                        }
                                                        const baseTreeData = mapToTreeData(options)
                                                        const treeData =
                                                            additionalNodes.length > 0
                                                                ? [
                                                                      ...additionalNodes,
                                                                      ...baseTreeData,
                                                                  ]
                                                                : baseTreeData
                                                        const expandedKeys =
                                                            collectTreeKeys(treeData)
                                                        return (
                                                            <TreeSelect
                                                                className="w-[260px]"
                                                                treeData={treeData}
                                                                treeNodeLabelProp="pathLabel"
                                                                dropdownMatchSelectWidth={false}
                                                                styles={{
                                                                    popup: {
                                                                        root: {
                                                                            minWidth: 260,
                                                                            ...dropdownPanelStyle,
                                                                        },
                                                                    },
                                                                }}
                                                                getPopupContainer={(t) =>
                                                                    getWithinPopover(t)
                                                                }
                                                                value={
                                                                    item.key && item.key !== ""
                                                                        ? (item.key as
                                                                              | string
                                                                              | number)
                                                                        : undefined
                                                                }
                                                                onChange={(v) =>
                                                                    onFilterChange({
                                                                        columnName: "key",
                                                                        value: v == null ? "" : v,
                                                                        idx,
                                                                    })
                                                                }
                                                                onSearch={(searchValue) =>
                                                                    setKeySearchTerms((prev) => {
                                                                        const trimmed =
                                                                            searchValue.trim()
                                                                        if (!trimmed) {
                                                                            if (!(idx in prev))
                                                                                return prev
                                                                            const next = {...prev}
                                                                            delete next[idx]
                                                                            return next
                                                                        }
                                                                        return {
                                                                            ...prev,
                                                                            [idx]: trimmed,
                                                                        }
                                                                    })
                                                                }
                                                                onDropdownVisibleChange={(open) => {
                                                                    if (!open) {
                                                                        setKeySearchTerms(
                                                                            (prev) => {
                                                                                if (!(idx in prev))
                                                                                    return prev
                                                                                const next = {
                                                                                    ...prev,
                                                                                }
                                                                                delete next[idx]
                                                                                return next
                                                                            },
                                                                        )
                                                                    }
                                                                }}
                                                                placeholder={keyPlaceholder}
                                                                showSearch
                                                                treeNodeFilterProp="title"
                                                                treeDefaultExpandAll
                                                                treeExpandedKeys={expandedKeys}
                                                                onTreeExpand={noopTreeExpand}
                                                                treeLine={{showLeafIcon: false}}
                                                                disabled={item.isPermanent}
                                                                filterTreeNode={(input, node) => {
                                                                    const title =
                                                                        typeof node?.title ===
                                                                        "string"
                                                                            ? node.title
                                                                            : String(
                                                                                  node?.title ?? "",
                                                                              )
                                                                    const value = String(
                                                                        node?.value ?? "",
                                                                    )
                                                                    const pathLabel =
                                                                        typeof (node as any)
                                                                            ?.pathLabel === "string"
                                                                            ? ((node as any)
                                                                                  .pathLabel as string)
                                                                            : ""
                                                                    const search = input
                                                                        .trim()
                                                                        .toLowerCase()
                                                                    return (
                                                                        title
                                                                            .toLowerCase()
                                                                            .includes(search) ||
                                                                        value
                                                                            .toLowerCase()
                                                                            .includes(search) ||
                                                                        pathLabel
                                                                            .toLowerCase()
                                                                            .includes(search)
                                                                    )
                                                                }}
                                                            />
                                                        )
                                                    })()
                                                ) : (
                                                    <Input
                                                        className="w-[200px]"
                                                        placeholder={keyPlaceholder}
                                                        value={
                                                            typeof item.key === "string" ||
                                                            item.key === undefined
                                                                ? (item.key as string)
                                                                : ""
                                                        }
                                                        onChange={(e) =>
                                                            onFilterChange({
                                                                columnName: "key",
                                                                value: e.target.value,
                                                                idx,
                                                            })
                                                        }
                                                        disabled={item.isPermanent}
                                                    />
                                                ))}

                                            {isAnnotationFieldSelected && (
                                                <Typography.Text
                                                    type="secondary"
                                                    className="whitespace-nowrap"
                                                >
                                                    That
                                                </Typography.Text>
                                            )}

                                            {!singleOperator && (
                                                <Select
                                                    placeholder="Operator"
                                                    labelRender={(label) =>
                                                        !label.value ? "Condition" : label.label
                                                    }
                                                    suffixIcon={<CaretDownIcon size={14} />}
                                                    onChange={(value) =>
                                                        onFilterChange({
                                                            columnName: "operator",
                                                            value,
                                                            idx,
                                                        })
                                                    }
                                                    className="w-[140px]"
                                                    popupMatchSelectWidth={140}
                                                    value={operatorValue}
                                                    options={operatorOptions}
                                                    disabled={item.isPermanent}
                                                    getPopupContainer={(t) => getWithinPopover(t)}
                                                    styles={{
                                                        popup: {
                                                            root: {
                                                                ...dropdownPanelStyle,
                                                            },
                                                        },
                                                    }}
                                                />
                                            )}

                                            {isAnnotationFieldSelected ? (
                                                isEvaluatorActive ? (
                                                    <div className="flex items-center gap-2 w-full">
                                                        <Select
                                                            className="w-[220px] flex-1"
                                                            showSearch
                                                            placeholder="Evaluator"
                                                            value={annotationValue?.evaluator}
                                                            options={annotationEvaluatorOptions}
                                                            onChange={(value) =>
                                                                handleEvaluatorChange(value)
                                                            }
                                                            allowClear
                                                            suffixIcon={<CaretDownIcon size={14} />}
                                                            optionFilterProp="label"
                                                            getPopupContainer={(t) =>
                                                                getWithinPopover(t)
                                                            }
                                                            styles={{
                                                                popup: {
                                                                    root: {
                                                                        ...(dropdownPanelStyle ||
                                                                            {}),
                                                                    },
                                                                },
                                                            }}
                                                        />

                                                        <Button
                                                            type="link"
                                                            icon={<TrashIcon size={14} />}
                                                            onClick={removeEvaluator}
                                                        />
                                                    </div>
                                                ) : (
                                                    <Space>
                                                        <Button
                                                            type="text"
                                                            icon={<PlusIcon size={14} />}
                                                            onClick={() =>
                                                                setAnnotationValue((prev) => ({
                                                                    ...(prev ?? {}),
                                                                    evaluator: "",
                                                                }))
                                                            }
                                                        >
                                                            Add Evaluator
                                                        </Button>
                                                        {!isFeedbackActive &&
                                                            renderAddFeedbackButton()}
                                                    </Space>
                                                )
                                            ) : !showValue ? (
                                                <Input
                                                    placeholder="Value"
                                                    value={displayValue}
                                                    disabled
                                                    readOnly
                                                    className="flex-1 min-w-[120px] w-full"
                                                />
                                            ) : valueAs === "tags" ? (
                                                <Select
                                                    mode="tags"
                                                    className="flex-1 min-w-[160px] w-full"
                                                    options={valueOptions}
                                                    tokenSeparators={[",", " ", "\n", "\t", ";"]}
                                                    value={
                                                        Array.isArray(item.value)
                                                            ? (item.value as any)
                                                            : [item.value as any].filter(Boolean)
                                                    }
                                                    onChange={(vals) =>
                                                        onFilterChange({
                                                            columnName: "value",
                                                            value: vals,
                                                            idx,
                                                        })
                                                    }
                                                    placeholder={valuePlaceholder}
                                                    suffixIcon={<CaretDownIcon size={14} />}
                                                    popupMatchSelectWidth
                                                    disabled={item.isPermanent}
                                                    status={valueHasError ? "error" : undefined}
                                                    getPopupContainer={(t) => getWithinPopover(t)}
                                                    styles={{
                                                        popup: {
                                                            root: {
                                                                ...(dropdownPanelStyle || {}),
                                                            },
                                                        },
                                                    }}
                                                />
                                            ) : valueAs === "select" ? (
                                                <Select
                                                    className="flex-1 min-w-[160px] w-full"
                                                    options={valueOptions}
                                                    value={item.value as any}
                                                    onChange={(v) =>
                                                        onFilterChange({
                                                            columnName: "value",
                                                            value: v,
                                                            idx,
                                                        })
                                                    }
                                                    placeholder={valuePlaceholder}
                                                    suffixIcon={<CaretDownIcon size={14} />}
                                                    popupMatchSelectWidth
                                                    disabled={item.isPermanent}
                                                    status={valueHasError ? "error" : undefined}
                                                    getPopupContainer={(t) => getWithinPopover(t)}
                                                    styles={{
                                                        popup: {
                                                            root: {
                                                                ...(dropdownPanelStyle || {}),
                                                            },
                                                        },
                                                    }}
                                                />
                                            ) : valueAs === "range" ? (
                                                <Input
                                                    placeholder={valuePlaceholder}
                                                    value={
                                                        Array.isArray(item.value)
                                                            ? JSON.stringify(item.value)
                                                            : (item.value as any)
                                                    }
                                                    onChange={(e) =>
                                                        onFilterChange({
                                                            columnName: "value",
                                                            value: e.target.value,
                                                            idx,
                                                        })
                                                    }
                                                    disabled={item.isPermanent}
                                                    className="flex-1 min-w-[160px] w-full"
                                                    status={valueHasError ? "error" : undefined}
                                                />
                                            ) : (
                                                <Input
                                                    placeholder={valuePlaceholder}
                                                    value={
                                                        typeof item.value === "object"
                                                            ? JSON.stringify(item.value)
                                                            : (item.value as any)
                                                    }
                                                    onChange={(e) =>
                                                        onFilterChange({
                                                            columnName: "value",
                                                            value: e.target.value,
                                                            idx,
                                                        })
                                                    }
                                                    disabled={item.isPermanent}
                                                    className="flex-1 min-w-[160px] w-full"
                                                    status={valueHasError ? "error" : undefined}
                                                />
                                            )}

                                            {field?.optionKey === "custom" && (
                                                <Select
                                                    className="w-[130px]"
                                                    value={item.customValueType ?? "string"}
                                                    onChange={(
                                                        v: "string" | "number" | "boolean",
                                                    ) =>
                                                        onFilterChange({
                                                            columnName: "customValueType" as any,
                                                            value: v,
                                                            idx,
                                                        })
                                                    }
                                                    options={[
                                                        {label: "String", value: "string"},
                                                        {label: "Number", value: "number"},
                                                        {label: "Boolean", value: "boolean"},
                                                    ]}
                                                    suffixIcon={<CaretDownIcon size={14} />}
                                                    popupMatchSelectWidth
                                                    disabled={item.isPermanent}
                                                    getPopupContainer={(t) => getWithinPopover(t)}
                                                    styles={{
                                                        popup: {
                                                            root: {
                                                                ...(dropdownPanelStyle || {}),
                                                            },
                                                        },
                                                    }}
                                                />
                                            )}

                                            {!item.isPermanent &&
                                                !(
                                                    isAnnotationFieldSelected &&
                                                    (isEvaluatorActive || isFeedbackActive)
                                                ) && (
                                                    <Button
                                                        type="link"
                                                        icon={<TrashIcon size={14} />}
                                                        onClick={() => onDeleteFilter(idx)}
                                                    />
                                                )}
                                        </div>
                                        {(isEvaluatorActive || isFeedbackActive) &&
                                            (isFeedbackActive ? (
                                                <div className="w-full flex items-center gap-2">
                                                    <Typography.Text
                                                        type="secondary"
                                                        className="whitespace-nowrap"
                                                    >
                                                        Feedback
                                                    </Typography.Text>
                                                    <Select
                                                        className="w-[180px]"
                                                        showSearch
                                                        mode={
                                                            annotationValue?.evaluator
                                                                ? undefined
                                                                : "multiple"
                                                        }
                                                        placeholder={
                                                            annotationValue?.evaluator
                                                                ? "Feedback"
                                                                : "Select one or more"
                                                        }
                                                        value={feedbackFieldValueForSelect}
                                                        options={feedbackOptionsForSelect}
                                                        onChange={(val) => {
                                                            handleFeedbackFieldChange(
                                                                val as string | string[],
                                                            )
                                                        }}
                                                        suffixIcon={<CaretDownIcon size={14} />}
                                                        optionFilterProp="label"
                                                        getPopupContainer={(t) =>
                                                            getWithinPopover(t)
                                                        }
                                                        styles={{
                                                            popup: {
                                                                root: {
                                                                    ...(dropdownPanelStyle || {}),
                                                                },
                                                            },
                                                        }}
                                                    />
                                                    <Select
                                                        className="w-[80px]"
                                                        value={currentFeedback?.operator}
                                                        options={feedbackOperatorOptions}
                                                        onChange={handleFeedbackOperatorChange}
                                                        suffixIcon={<CaretDownIcon size={14} />}
                                                        getPopupContainer={(t) =>
                                                            getWithinPopover(t)
                                                        }
                                                        styles={{
                                                            popup: {
                                                                root: {
                                                                    ...(dropdownPanelStyle || {}),
                                                                },
                                                            },
                                                        }}
                                                    />
                                                    {feedbackValueType === "boolean" ? (
                                                        <Select
                                                            className="flex-1"
                                                            value={currentFeedback?.value ?? true}
                                                            options={[
                                                                {label: "true", value: true},
                                                                {label: "false", value: false},
                                                            ]}
                                                            onChange={handleFeedbackValueChange}
                                                            suffixIcon={<CaretDownIcon size={14} />}
                                                            getPopupContainer={(t) =>
                                                                getWithinPopover(t)
                                                            }
                                                            styles={{
                                                                popup: {
                                                                    root: {
                                                                        ...(dropdownPanelStyle ||
                                                                            {}),
                                                                    },
                                                                },
                                                            }}
                                                        />
                                                    ) : (
                                                        <Input
                                                            className="flex-1"
                                                            placeholder="Value"
                                                            value={feedbackValueRaw}
                                                            onChange={(e) =>
                                                                handleFeedbackValueChange(
                                                                    e.target.value,
                                                                )
                                                            }
                                                        />
                                                    )}
                                                    <Select
                                                        className="w-[100px]"
                                                        value={feedbackValueType}
                                                        options={[
                                                            {label: "Text", value: "string"},
                                                            {label: "Number", value: "number"},
                                                            {label: "Boolean", value: "boolean"},
                                                        ]}
                                                        onChange={(value) =>
                                                            handleFeedbackTypeChange(
                                                                value as AnnotationFeedbackValueType,
                                                            )
                                                        }
                                                        suffixIcon={<CaretDownIcon size={14} />}
                                                        getPopupContainer={(t) =>
                                                            getWithinPopover(t)
                                                        }
                                                        styles={{
                                                            popup: {
                                                                root: {
                                                                    ...(dropdownPanelStyle || {}),
                                                                },
                                                            },
                                                        }}
                                                    />

                                                    <Button
                                                        type="link"
                                                        icon={<TrashIcon size={14} />}
                                                        onClick={removeFeedback}
                                                    />
                                                </div>
                                            ) : (
                                                renderAddFeedbackButton()
                                            ))}
                                    </Space>
                                </Space>
                            )
                        })}

                        <Button
                            type="dashed"
                            icon={<PlusIcon size={14} />}
                            onClick={() => setFilter([...filter, createEmptyFilter()])}
                            className="mt-2"
                        >
                            Add
                        </Button>
                    </div>

                    <div className="-ml-4 -mr-2">
                        <Divider className="!m-0" />
                    </div>

                    <Space className="flex items-center justify-between p-2">
                        <Button
                            icon={<ArrowClockwiseIcon size={14} className="mt-0.5" />}
                            onClick={clearFilter}
                            size="small"
                        >
                            Clear
                        </Button>
                        <Space>
                            <Button
                                size="small"
                                onClick={() => {
                                    setActiveFieldDropdown(null)
                                    setIsFilterOpen(false)
                                }}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="primary"
                                disabled={isApplyDisabled}
                                onClick={applyFilter}
                                size="small"
                            >
                                Apply
                            </Button>
                        </Space>
                    </Space>
                </section>
            }
        >
            <Button
                onClick={() => setIsFilterOpen(true)}
                className="flex items-center gap-2 px-2"
                {...buttonProps}
            >
                <div className="flex items-center gap-1 min-w-[18px]">
                    <FunnelIcon size={14} />
                    <div className="w-[14px] flex items-center justify-center">
                        {sanitizedFilters.filter(({field, operator}) => field && operator).length >
                            0 && (
                            <CustomAntdBadge
                                count={
                                    sanitizedFilters.filter(({field, operator}) => field && operator)
                                        .length
                                }
                            />
                        )}
                    </div>
                </div>
            </Button>
        </Popover>
    )
}

export default Filters
