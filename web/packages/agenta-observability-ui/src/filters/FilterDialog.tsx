import {useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import type {Filter, FilterValue} from "@agenta/observability"
import {
    collapseAnnotationAnyEvaluatorRowsFromProps,
    createEmptyFilter,
    CUSTOM_FIELD_VALUE,
    effectiveFieldForRow,
    explodeAnnotationAnyEvaluatorRows,
    fieldConfigByOptionKey,
    filtersEqual,
    mapFilterData,
    planInputs,
    sanitizeFilterItems,
    selectSendableRows,
    toUIValue,
    validateFilterRow,
    valueShapeFor,
    type FilterColumnIcons,
    type FilterItem,
    type FilterMenuNode,
} from "@agenta/observability/filters"
import {EnhancedButton, type EnhancedButtonProps} from "@agenta/ui/components/presentational"
import {Divider, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {ArrowClockwiseIcon, FunnelIcon, PlusIcon} from "@phosphor-icons/react"

import {FilterRow, type AnnotationRowSlot, type FilterRowColumn} from "./FilterRow"

export interface FilterDialogProps {
    /** Applied filters, owned by the host. The dialog edits a local copy until Apply. */
    filterData?: Filter[]
    /** Field menu tree — build it with `getFilterColumns(attributeKeyOptions, icons)`. */
    columns: FilterMenuNode[]
    onApplyFilter: (filters: Filter[]) => void
    onClearFilter: (filters: Filter[]) => void
    /**
     * Display-only projection of the local rows (observability flips the references row's
     * label as `trace_type` changes). MUST preserve array length and per-index order — the
     * dialog mutates rows by index. `reconcileFilterRows` from `@agenta/observability`
     * satisfies that contract; bind its `workflowKind` / field map in the host.
     */
    reconcileFilterRows?: (rows: FilterItem[]) => FilterItem[]
    /** Fallback icon set by node label, for columns built without icons. */
    icons?: FilterColumnIcons
    /** The annotation evaluator + feedback sub-row. Omit and annotation rows fall back to the generic value input. */
    annotationRow?: AnnotationRowSlot
    /** Props for the default funnel trigger. Ignored when `trigger` is given. */
    buttonProps?: EnhancedButtonProps
    /** Replace the default trigger entirely. */
    trigger?: ReactNode
    className?: string
}

/** Runs the effect on updates only — the initial rows already come from `useState`. */
const useLazyEffect = (run: () => void, deps: unknown[]) => {
    const mounted = useRef(false)
    const latest = useRef(run)
    latest.current = run
    useEffect(() => {
        if (!mounted.current) {
            mounted.current = true
            return
        }
        latest.current()
    }, deps)
}

/** Applied-filter count badge. Black-on-white in antd; here it follows the theme. */
function FilterCountBadge({count}: {count: number}) {
    return (
        <span className="box-border flex h-[14px] min-w-[14px] items-center justify-center rounded-[4px] bg-foreground px-[3px] text-[12px] leading-none text-background">
            {count}
        </span>
    )
}

/**
 * The filter dialog: a popover holding one `FilterRow` per condition, plus Add / Clear /
 * Cancel / Apply.
 *
 * All row logic lives in `@agenta/observability/filters` (`planInputs`, `normalizeFilter`,
 * `toUIValue`, `mapFilterData`, `sanitizeFilterItems`, `validateFilterRow`). This file owns
 * the local row array, the open state, and the layout.
 */
export function FilterDialog({
    filterData,
    columns,
    onApplyFilter,
    onClearFilter,
    reconcileFilterRows,
    icons,
    annotationRow,
    buttonProps,
    trigger,
    className,
}: FilterDialogProps) {
    const fieldMap = useMemo(() => fieldConfigByOptionKey(columns), [columns])
    const getField = (uiKey?: string) => (uiKey ? fieldMap.get(uiKey) : undefined)

    const [filter, setFilter] = useState<FilterItem[]>(() =>
        !filterData?.length ? [createEmptyFilter()] : mapFilterData(filterData, fieldMap),
    )
    const [isFilterOpen, setIsFilterOpen] = useState(false)
    const [activeFieldDropdown, setActiveFieldDropdown] = useState<number | null>(null)
    const [keySearchTerms, setKeySearchTerms] = useState<Record<number, string>>({})
    const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null)

    useLazyEffect(() => {
        if (filterData && filterData.length > 0) {
            const mapped = mapFilterData(filterData, fieldMap)
            setFilter(collapseAnnotationAnyEvaluatorRowsFromProps(mapped, getField))
        } else {
            setFilter([])
        }
    }, [filterData, columns])

    /** Display-only projection; mutations still target `filter` by index. */
    const displayedFilter = useMemo(
        () => (reconcileFilterRows ? reconcileFilterRows(filter) : filter),
        [filter, reconcileFilterRows],
    )

    const rowValidations = useMemo(
        () => filter.map((item) => validateFilterRow(item, fieldMap)),
        [filter, fieldMap],
    )
    const isApplyDisabled = rowValidations.some(({isValid}) => !isValid)

    const sanitizedFilters = useMemo(
        () => sanitizeFilterItems(selectSendableRows(filter), fieldMap),
        [filter, fieldMap],
    )
    const appliedCount = sanitizedFilters.filter(({field, operator}) => field && operator).length

    const nonPermanentFilterCount = useMemo(
        () => filter.filter((f) => !f.isPermanent).length,
        [filter],
    )

    // Only one row may carry `has_annotation`; the rest render it disabled.
    const hasAnnotationIndices = useMemo(
        () =>
            filter.reduce<number[]>((acc, current, index) => {
                const optionKey =
                    current.selectedField ||
                    (typeof current.field === "string" && current.field
                        ? current.field
                        : undefined) ||
                    current.baseField ||
                    ""
                if (optionKey === "has_annotation") acc.push(index)
                return acc
            }, []),
        [filter],
    )
    const annotationDisabledOptions = useMemo(() => new Set<string>(["has_annotation"]), [])

    const clearKeySearch = (idx: number) =>
        setKeySearchTerms((prev) => {
            if (!(idx in prev)) return prev
            const next = {...prev}
            delete next[idx]
            return next
        })

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
                const field = fieldMap.get(uiValue)
                if (!field) return prev
                current.selectedField = field.optionKey
                current.field = field.optionKey
                current.key = field.keyInput?.kind === "none" ? (field.queryKey ?? "") : ""
                current.operator = field.operatorIds[0] ?? ""
                const effType = field.optionKey === "custom" ? "string" : field.type
                const shape = current.operator ? valueShapeFor(current.operator, effType) : "single"
                let defaultValue = toUIValue(field.defaultValue, shape) as FilterValue
                if (
                    shape === "list" &&
                    current.operator &&
                    planInputs(field, current.operator).valueAs === "text" &&
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
        clearKeySearch(idx)
        setActiveFieldDropdown(null)
    }

    const onFilterChange = (
        column: FilterRowColumn,
        value: FilterValue | undefined,
        idx: number,
    ) => {
        setFilter((prev) => {
            const next = [...prev]
            const current = {...next[idx]}
            const field = getField(current.selectedField || current.field || "")

            if (column === "operator" && field) {
                const effType =
                    field.optionKey === "custom"
                        ? current.customValueType === "number"
                            ? "number"
                            : "string"
                        : field.type
                const operator = value as FilterItem["operator"]
                current.value = toUIValue(
                    current.value,
                    valueShapeFor(operator, effType),
                ) as FilterValue
                current.operator = operator
                next[idx] = current
                return next
            }

            if (column === "operator") {
                next[idx] = {...current, operator: value as FilterItem["operator"]}
                return next
            }
            if (column === "customValueType") {
                next[idx] = {...current, customValueType: value as FilterItem["customValueType"]}
                return next
            }
            if (column === "key") {
                next[idx] = {...current, key: value == null ? "" : String(value)}
                return next
            }
            next[idx] = {...current, value: value as FilterValue}
            return next
        })
        if (column === "key") clearKeySearch(idx)
    }

    const onDeleteFilter = (index: number) =>
        setFilter((prev) => prev.filter((_, idx) => idx !== index))

    const clearFilter = () => {
        const kept = filter.filter((f) => f.isPermanent)
        const sanitizedKept = sanitizeFilterItems(kept, fieldMap)
        if (!filtersEqual(sanitizedKept, filterData)) onClearFilter(sanitizedKept)
        setActiveFieldDropdown(null)
        setFilter(kept.length ? kept : [])
    }

    const applyFilter = () => {
        const out = sanitizeFilterItems(explodeAnnotationAnyEvaluatorRows(filter), fieldMap)
        if (!filtersEqual(out, filterData)) onApplyFilter(out)
        setActiveFieldDropdown(null)
        setIsFilterOpen(false)
    }

    const closeDialog = () => {
        setActiveFieldDropdown(null)
        setIsFilterOpen(false)
    }

    const defaultTrigger = (
        <EnhancedButton
            className="flex items-center gap-2 px-2"
            aria-label="Filter"
            {...buttonProps}
        >
            <span className="flex min-w-[18px] items-center gap-1">
                <FunnelIcon size={14} />
                <span className="flex w-[14px] items-center justify-center">
                    {appliedCount > 0 && <FilterCountBadge count={appliedCount} />}
                </span>
            </span>
        </EnhancedButton>
    )

    return (
        <Popover
            open={isFilterOpen}
            onOpenChange={(open) => {
                setIsFilterOpen(open)
                if (!open) setActiveFieldDropdown(null)
            }}
        >
            <PopoverTrigger asChild>{trigger ?? defaultTrigger}</PopoverTrigger>
            <PopoverContent
                ref={setContentEl}
                align="start"
                className={`w-[clamp(320px,60vw,700px)] max-w-[calc(100vw-24px)] p-0 ${className ?? ""}`}
            >
                <section className="flex max-h-[min(70vh,640px)] flex-col">
                    <div className="flex items-center justify-between gap-3 py-2 pl-4 pr-2">
                        <span className="text-sm font-medium leading-[1.5714285714285714] text-colorText">
                            Filter
                        </span>
                    </div>
                    <Divider className="m-0" />

                    <div className="flex flex-col gap-2 overflow-y-auto p-2">
                        {displayedFilter.map((item, idx) => {
                            const uiKey = item.selectedField || item.field || ""
                            const field = effectiveFieldForRow(getField(uiKey), item)
                            const disableHasAnnotation = hasAnnotationIndices.some(
                                (annotationIdx) => annotationIdx !== idx,
                            )
                            return (
                                <FilterRow
                                    key={idx}
                                    index={idx}
                                    item={item}
                                    field={field}
                                    columns={columns}
                                    validation={rowValidations[idx] ?? {isValid: true}}
                                    disabledFieldOptionKeys={
                                        disableHasAnnotation ? annotationDisabledOptions : undefined
                                    }
                                    icons={icons}
                                    fieldMenuOpen={activeFieldDropdown === idx}
                                    onFieldMenuOpenChange={(open) =>
                                        setActiveFieldDropdown(open ? idx : null)
                                    }
                                    onSelectField={(optionKey, displayLabel) =>
                                        handleFieldSelection(optionKey, idx, displayLabel)
                                    }
                                    onChange={(column, value) => onFilterChange(column, value, idx)}
                                    onRemove={() => onDeleteFilter(idx)}
                                    showRemove={nonPermanentFilterCount > 1}
                                    keySearchTerm={keySearchTerms[idx]}
                                    onKeySearch={(term) => {
                                        const trimmed = term.trim()
                                        if (!trimmed) {
                                            clearKeySearch(idx)
                                            return
                                        }
                                        setKeySearchTerms((prev) => ({...prev, [idx]: trimmed}))
                                    }}
                                    container={contentEl}
                                    annotationRow={annotationRow}
                                />
                            )
                        })}

                        <EnhancedButton
                            type="dashed"
                            icon={<PlusIcon size={14} />}
                            className="mt-2 self-start"
                            onClick={() => setFilter((prev) => [...prev, createEmptyFilter()])}
                        >
                            Add
                        </EnhancedButton>
                    </div>

                    <Divider className="m-0" />

                    <div className="flex items-center justify-between gap-2 p-2">
                        <EnhancedButton
                            size="small"
                            icon={<ArrowClockwiseIcon size={14} className="mt-0.5" />}
                            onClick={clearFilter}
                        >
                            Clear
                        </EnhancedButton>
                        <div className="flex items-center gap-2">
                            <EnhancedButton size="small" onClick={closeDialog}>
                                Cancel
                            </EnhancedButton>
                            <EnhancedButton
                                size="small"
                                type="primary"
                                disabled={isApplyDisabled}
                                onClick={applyFilter}
                            >
                                Apply
                            </EnhancedButton>
                        </div>
                    </div>
                </section>
            </PopoverContent>
        </Popover>
    )
}

export default FilterDialog
