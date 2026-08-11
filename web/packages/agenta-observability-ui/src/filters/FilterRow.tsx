import {useMemo, type ReactNode} from "react"

import type {FilterConditions, FilterValue} from "@agenta/observability"
import {
    buildFieldMenuItems,
    buildKeyTreeData,
    extractAnnotationValue,
    operatorOptionsFromIds,
    planInputs,
    type AnnotationFilterValue,
    type FieldConfig,
    type FieldMenuEntry,
    type FilterColumnIcons,
    type FilterItem,
    type FilterMenuNode,
    type RowValidation,
} from "@agenta/observability/filters"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    TreeSelect,
} from "@agenta/ui/ui"
import {CaretDownIcon, TrashIcon} from "@phosphor-icons/react"

import {FilterTagsInput} from "./FilterTagsInput"

/** The columns of a row the dialog knows how to patch. */
export type FilterRowColumn = "key" | "operator" | "value" | "customValueType"

/**
 * What the annotation sub-row (owned by `AnnotationFilterRow`) is handed. The row never
 * looks inside the annotation value beyond parsing it — everything else is the slot's.
 */
export interface AnnotationRowContext {
    /** Row index. The dialog mutates state by index, so the slot must echo it back. */
    index: number
    item: FilterItem
    /** Parsed annotation value, or `undefined` when the row carries none yet. */
    value: AnnotationFilterValue | undefined
    /** Commit a new annotation value. `undefined` clears the row's value. */
    onChange: (next: AnnotationFilterValue | undefined) => void
    /** Delete the whole filter row. */
    onRemoveRow: () => void
    /** Portal target so the slot's overlays stay inside the dialog popover. */
    container: HTMLElement | null
    disabled: boolean
}

/**
 * The annotation slot. Two render points because the original occupies both the tail of the
 * main line and a second line beneath it; keeping them separate lets the row own the layout
 * without knowing what the slot renders.
 */
export interface AnnotationRowSlot {
    /** Tail of the main line, where the generic value input would otherwise sit. */
    renderInline: (ctx: AnnotationRowContext) => ReactNode
    /** Second line under the main row. Return null when there is nothing to show. */
    renderBelow?: (ctx: AnnotationRowContext) => ReactNode
    /** Hide the generic delete button while the slot owns its own removal affordances. */
    hidesRowDelete?: (ctx: AnnotationRowContext) => boolean
}

export interface FilterRowProps {
    index: number
    item: FilterItem
    /** Effective field config for this row (custom rows are derived from their value type). */
    field?: FieldConfig
    /** The full field menu tree, icons already applied by `getFilterColumns`. */
    columns: FilterMenuNode[]
    validation: RowValidation
    /** Option keys the field menu must render disabled for this row. */
    disabledFieldOptionKeys?: ReadonlySet<string>
    /** Fallback icon set, by node label, for columns built without icons. */
    icons?: FilterColumnIcons
    fieldMenuOpen: boolean
    onFieldMenuOpenChange: (open: boolean) => void
    onSelectField: (optionKey: string, displayLabel?: string) => void
    onChange: (column: FilterRowColumn, value: FilterValue | undefined) => void
    onRemove: () => void
    showRemove: boolean
    keySearchTerm?: string
    onKeySearch: (term: string) => void
    container: HTMLElement | null
    annotationRow?: AnnotationRowSlot
}

const EMPTY_VALUE_OPTIONS: {label: string; value: string | number}[] = []

const asTagValues = (value: FilterValue | undefined): (string | number)[] => {
    if (Array.isArray(value))
        return value.filter(
            (entry): entry is string | number =>
                typeof entry === "string" || typeof entry === "number",
        )
    if (typeof value === "string" || typeof value === "number") return value === "" ? [] : [value]
    return []
}

const asText = (value: FilterValue | undefined): string => {
    if (value == null) return ""
    if (typeof value === "object") return JSON.stringify(value)
    return String(value)
}

function FieldMenuEntries({
    entries,
    onSelect,
    container,
}: {
    entries: FieldMenuEntry[]
    onSelect: (optionKey: string, displayLabel?: string) => void
    container: HTMLElement | null
}) {
    return (
        <>
            {entries.map((entry) => {
                const Icon = entry.icon
                if (entry.kind === "group") {
                    const {defaultValue, defaultDisabled, defaultDisplayLabel} = entry
                    return (
                        <DropdownMenuSub key={entry.key}>
                            <DropdownMenuSubTrigger
                                onClick={(event) => {
                                    if (!defaultValue) return
                                    // antd `onTitleClick`: the header commits, it does not expand.
                                    event.preventDefault()
                                    event.stopPropagation()
                                    if (defaultDisabled) return
                                    onSelect(defaultValue, defaultDisplayLabel)
                                }}
                            >
                                <span className="flex items-center gap-2">
                                    {Icon ? <Icon size={16} /> : null}
                                    <span>{entry.label}</span>
                                </span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent
                                container={container}
                                className="max-h-[60vh] w-full max-w-[min(560px,calc(100vw-32px))] overflow-auto"
                            >
                                <FieldMenuEntries
                                    entries={entry.children}
                                    onSelect={onSelect}
                                    container={container}
                                />
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    )
                }
                return (
                    <DropdownMenuItem
                        key={entry.key}
                        disabled={entry.disabled}
                        onSelect={() => onSelect(entry.key)}
                    >
                        <span className="flex items-center gap-2">
                            {Icon ? <Icon size={16} /> : null}
                            <span>{entry.label}</span>
                        </span>
                    </DropdownMenuItem>
                )
            })}
        </>
    )
}

/**
 * One filter row: field menu, optional key input, operator, value input.
 *
 * Every "which inputs does this row show" decision comes from `planInputs` in
 * `@agenta/observability/filters` — this file renders the plan, it does not re-derive it.
 * Annotation rows hand their tail to `annotationRow`.
 */
export function FilterRow({
    index,
    item,
    field,
    columns,
    validation,
    disabledFieldOptionKeys,
    icons,
    fieldMenuOpen,
    onFieldMenuOpenChange,
    onSelectField,
    onChange,
    onRemove,
    showRemove,
    keySearchTerm,
    onKeySearch,
    container,
    annotationRow,
}: FilterRowProps) {
    const disabled = Boolean(item.isPermanent)

    const menuEntries = useMemo(
        () => buildFieldMenuItems(columns, {disabledOptionKeys: disabledFieldOptionKeys, icons}),
        [columns, disabledFieldOptionKeys, icons],
    )

    const operatorOptions = useMemo(
        () => (field ? (field.operatorOptions ?? operatorOptionsFromIds(field.operatorIds)) : []),
        [field],
    )
    const singleOperator = operatorOptions.length === 1
    const operatorValue = item.operator || (singleOperator ? operatorOptions[0]?.value : undefined)

    const plan = field && operatorValue ? planInputs(field, operatorValue) : undefined
    const showKey = Boolean(plan?.needsKey)
    const showValue = Boolean(plan?.showValue)
    const keyPlaceholder = plan?.placeholders?.key ?? "Key"
    const valuePlaceholder = plan?.placeholders?.value ?? "Value"
    const valueOptions = plan?.valueOptions ?? EMPTY_VALUE_OPTIONS
    const valueHasError = Boolean(validation.valueInvalid)

    const isAnnotationField = field?.baseField?.includes("annotation") ?? false
    const annotationValue = extractAnnotationValue(item.value)

    // The value select speaks strings (Radix), the model may hold numbers.
    const valueOptionByString = useMemo(() => {
        const map = new Map<string, string | number>()
        valueOptions.forEach((option) => map.set(String(option.value), option.value))
        return map
    }, [valueOptions])

    const keyTreeData = useMemo(() => {
        if (!showKey || field?.keyInput?.kind !== "select") return []
        const keyValue = item.key == null ? undefined : String(item.key)
        return buildKeyTreeData(field.keyInput.options, keySearchTerm, keyValue)
    }, [showKey, field, item.key, keySearchTerm])

    const annotationContext: AnnotationRowContext = {
        index,
        item,
        value: annotationValue,
        onChange: (next) => {
            if (!next || Object.keys(next).length === 0) {
                onChange("value", [])
                return
            }
            const valueToStore: AnnotationFilterValue = {...next}
            if (valueToStore.feedback) {
                const cleanedFeedback = {...valueToStore.feedback}
                if (cleanedFeedback.valueType === undefined) cleanedFeedback.valueType = "string"
                valueToStore.feedback = cleanedFeedback
            }
            onChange("value", [valueToStore])
        },
        onRemoveRow: onRemove,
        container,
        disabled,
    }

    const annotationActive =
        isAnnotationField && annotationRow
            ? (annotationRow.hidesRowDelete?.(annotationContext) ?? false)
            : false

    const renderValueInput = () => {
        if (!showValue) {
            return (
                <Input
                    className="w-full min-w-[120px] flex-1"
                    placeholder="Value"
                    value={
                        field?.valueDisplayText ||
                        (Array.isArray(item.value) ? "" : asText(item.value))
                    }
                    disabled
                    readOnly
                />
            )
        }
        if (plan?.valueAs === "tags") {
            return (
                <FilterTagsInput
                    className="w-full min-w-[160px] flex-1"
                    value={asTagValues(item.value)}
                    onChange={(next) => onChange("value", next)}
                    options={valueOptions}
                    placeholder={valuePlaceholder}
                    disabled={disabled}
                    invalid={valueHasError}
                    container={container}
                    aria-label={valuePlaceholder}
                />
            )
        }
        if (plan?.valueAs === "select") {
            const current = Array.isArray(item.value) ? item.value[0] : item.value
            return (
                <Select
                    value={current == null || current === "" ? undefined : String(current)}
                    onValueChange={(next) =>
                        onChange("value", valueOptionByString.get(next) ?? next)
                    }
                    disabled={disabled}
                >
                    <SelectTrigger
                        className="w-full min-w-[160px] flex-1"
                        aria-invalid={valueHasError || undefined}
                        aria-label={valuePlaceholder}
                    >
                        <SelectValue placeholder={valuePlaceholder} />
                    </SelectTrigger>
                    <SelectContent container={container} className="max-h-[60vh]">
                        {valueOptions.map((option) => (
                            <SelectItem key={String(option.value)} value={String(option.value)}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )
        }
        // `range` and `text` are both free text; range shows the JSON pair it parses back.
        return (
            <Input
                className="w-full min-w-[160px] flex-1"
                placeholder={valuePlaceholder}
                value={asText(item.value)}
                onChange={(event) => onChange("value", event.target.value)}
                disabled={disabled}
                aria-invalid={valueHasError || undefined}
            />
        )
    }

    return (
        <div className="flex flex-col overflow-x-auto [&::-webkit-scrollbar]:!h-0 [&::-webkit-scrollbar]:!w-0">
            <span className="text-field-md text-colorTextSecondary">
                {index === 0 ? "Where" : "And"}
            </span>

            <div className="flex w-full flex-col gap-2">
                <div className="flex w-full items-center gap-2">
                    <DropdownMenu open={fieldMenuOpen} onOpenChange={onFieldMenuOpenChange}>
                        <DropdownMenuTrigger asChild>
                            <EnhancedButton
                                className="flex w-[180px] items-center justify-between"
                                disabled={disabled}
                            >
                                <span className="truncate">
                                    {item.isCustomField
                                        ? "Custom"
                                        : (item.selectedLabel ?? field?.label ?? "Field")}
                                </span>
                                <CaretDownIcon size={14} />
                            </EnhancedButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            container={container}
                            align="start"
                            className="max-h-[60vh] max-w-[min(560px,calc(100vw-32px))] overflow-auto"
                        >
                            <FieldMenuEntries
                                entries={menuEntries}
                                onSelect={onSelectField}
                                container={container}
                            />
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {showKey &&
                        (field?.keyInput?.kind === "select" ? (
                            <TreeSelect
                                className="w-[260px]"
                                treeData={keyTreeData}
                                value={item.key && item.key !== "" ? String(item.key) : undefined}
                                onChange={(next) => onChange("key", next ?? "")}
                                onSearch={onKeySearch}
                                placeholder={keyPlaceholder}
                                defaultExpandAll
                                panelMinWidth={260}
                                panelMaxHeight="60vh"
                                container={container}
                                disabled={disabled}
                                aria-label={keyPlaceholder}
                            />
                        ) : (
                            <Input
                                className="w-[200px]"
                                placeholder={keyPlaceholder}
                                value={typeof item.key === "string" ? item.key : ""}
                                onChange={(event) => onChange("key", event.target.value)}
                                disabled={disabled}
                            />
                        ))}

                    {isAnnotationField && (
                        <span className="whitespace-nowrap text-field-md text-colorTextSecondary">
                            That
                        </span>
                    )}

                    {!singleOperator && (
                        <Select
                            value={operatorValue || undefined}
                            onValueChange={(next) => onChange("operator", next as FilterConditions)}
                            disabled={disabled}
                        >
                            <SelectTrigger className="w-[140px]" aria-label="Operator">
                                <SelectValue placeholder="Condition" />
                            </SelectTrigger>
                            <SelectContent container={container} className="max-h-[60vh]">
                                {operatorOptions.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}

                    {isAnnotationField && annotationRow
                        ? annotationRow.renderInline(annotationContext)
                        : renderValueInput()}

                    {field?.optionKey === "custom" && (
                        <Select
                            value={item.customValueType ?? "string"}
                            onValueChange={(next) => onChange("customValueType", next)}
                            disabled={disabled}
                        >
                            <SelectTrigger className="w-[130px]" aria-label="Value type">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent container={container}>
                                <SelectItem value="string">String</SelectItem>
                                <SelectItem value="number">Number</SelectItem>
                                <SelectItem value="boolean">Boolean</SelectItem>
                            </SelectContent>
                        </Select>
                    )}

                    {!disabled && showRemove && !annotationActive && (
                        <EnhancedButton
                            type="link"
                            icon={<TrashIcon size={14} />}
                            aria-label="Remove filter"
                            onClick={onRemove}
                        />
                    )}
                </div>

                {isAnnotationField && annotationRow?.renderBelow
                    ? annotationRow.renderBelow(annotationContext)
                    : null}
            </div>
        </div>
    )
}

export default FilterRow
