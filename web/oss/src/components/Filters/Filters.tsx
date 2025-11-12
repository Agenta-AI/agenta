import {useMemo, useState} from "react"
import {ArrowClockwiseIcon, Funnel, Plus} from "@phosphor-icons/react"
import {Button, Divider, Popover, Space, Typography} from "antd"
import isEqual from "lodash/isEqual"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {Filter} from "@/oss/lib/Types"
import CustomAntdBadge from "../ui/CustomAntdBadge"
import {
    fieldConfigByOptionKey,
    FieldConfig,
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
import {Props, FilterItem, RowValidation} from "./types"
import {useStyles} from "./assets/styles"
import {
    createEmptyFilter,
    CUSTOM_FIELD_VALUE,
    effectiveFieldForRow,
    isBooleanLike,
    isNumberLike,
} from "./helpers/utils"
import {
    AnnotationFeedbackOption,
    collapseAnnotationAnyEvaluatorRowsFromProps,
    deriveFeedbackValueType,
    explodeAnnotationAnyEvaluatorRows,
    extractAnnotationValue,
} from "./helpers/annotation"
import FilterRowsList from "./components/FilterRowsList"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import {EvaluatorPreviewDto} from "@/oss/lib/hooks/useEvaluators/types"

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
                            const hasMatch = valuesArray.some(
                                (entry) =>
                                    entry &&
                                    typeof entry === "object" &&
                                    candidate.referenceProperty! in entry,
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

    const applyFilter = () => {
        const expanded = explodeAnnotationAnyEvaluatorRows(filter)
        const out = sanitizeFilterItems(expanded)
        if (!isEqual(out, filterData)) onApplyFilter(out)
        setActiveFieldDropdown(null)
        setIsFilterOpen(false)
    }

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
                        <FilterRowsList
                            filter={filter}
                            getField={getField}
                            effectiveFieldForRow={effectiveFieldForRow}
                            extractAnnotationValue={extractAnnotationValue}
                            rowValidations={rowValidations}
                            hasAnnotationIndices={hasAnnotationIndices}
                            annotationFeedbackOptions={annotationFeedbackOptions}
                            onFilterChange={onFilterChange}
                            onDeleteFilter={onDeleteFilter}
                            activeFieldDropdown={activeFieldDropdown}
                            setActiveFieldDropdown={setActiveFieldDropdown}
                            handleFieldSelection={handleFieldSelection}
                            annotationEvaluatorOptions={annotationEvaluatorOptions}
                            columns={columns}
                            keySearchTerms={keySearchTerms}
                            setKeySearchTerms={setKeySearchTerms}
                            annotationDisabledOptions={annotationDisabledOptions}
                        />

                        <Button
                            type="dashed"
                            icon={<Plus size={14} />}
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
                icon={<Funnel size={14} />}
                onClick={() => setIsFilterOpen(true)}
                className="flex items-center gap-2"
                {...buttonProps}
            >
                Filters
                {sanitizedFilters.filter(({field, operator}) => field && operator).length > 0 && (
                    <CustomAntdBadge
                        count={
                            sanitizedFilters.filter(({field, operator}) => field && operator).length
                        }
                    />
                )}
            </Button>
        </Popover>
    )
}

export default Filters
