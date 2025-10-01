import {ComponentType, useMemo, useState} from "react"
import {ArrowClockwiseIcon, CaretDown, Funnel, Plus, Trash} from "@phosphor-icons/react"
import {
    Button,
    Divider,
    Input,
    Popover,
    Select,
    Space,
    Typography,
    ButtonProps,
    Dropdown,
    MenuProps,
} from "antd"
import isEqual from "lodash/isEqual"
import {createUseStyles} from "react-jss"

import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {Filter, FilterConditions, JSSTheme} from "@/oss/lib/Types"
import CustomAntdBadge from "../ui/CustomAntdBadge"
import {coerceNumericValue} from "@/oss/state/newObservability"

type FilterItem = Filter & {
    selectedField?: string
    fieldType?: string
    isCustomField?: boolean
    baseField?: string
    selectedLabel?: string
}

export type IconType = ComponentType<{size?: number}>

type InputKind = "text" | "select" | "none"
type InputConfig =
    | {kind: "text"; placeholder?: string}
    | {
          kind: "select"
          options: Array<{label: string; value: string | number}>
          placeholder?: string
      }
    | {kind: "none"; display?: string}

export type FilterLeaf = {
    kind: "leaf"
    field: string
    value: string
    label: string
    type: "string" | "number" | "exists"
    icon?: IconType
    operatorOptions?: Array<{value: FilterConditions; label: string}>
    defaultValue?: Filter["value"]
    keyInput?: InputConfig
    valueInput?: InputConfig
    disableValueInput?: boolean
    valueDisplayText?: string
    displayLabel?: string
}

export interface FilterGroup {
    kind: "group"
    label: string
    children: Array<FilterLeaf | FilterGroup>
    icon?: IconType
    defaultValue?: string
    titleClickDisplayLabel?: string
    leafDisplayLabel?: string
}

export type FilterMenuNode = FilterLeaf | FilterGroup

const CUSTOM_FIELD_VALUE = "__custom__"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    popover: {"& .ant-popover-inner": {minWidth: "400px !important", padding: 0}},
    filterHeading: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `${theme.paddingXS}px ${theme.paddingXS}px ${theme.paddingXS}px ${theme.padding}px`,
        gap: theme.marginSM,
        "& .ant-typography": {
            fontSize: theme.fontSizeHeading5,
            lineHeight: theme.lineHeightHeading5,
            fontWeight: theme.fontWeightMedium,
        },
    },
    filterContainer: {
        display: "flex",
        gap: theme.marginXS,
        flexDirection: "column",
        padding: theme.paddingXS,
    },
}))

interface Props {
    filterData?: Filter[]
    columns: FilterMenuNode[]
    onApplyFilter: (filters: Filter[]) => void
    onClearFilter: (filters: Filter[]) => void
    buttonProps?: ButtonProps
}

const isListOperator = (op?: string) => op === "in" || op === "not_in"
const isBetweenOperator = (op?: string) => op === "btwn"
const operatorHidesValue = (op?: string) => op === "exists" || op === "not_exists"

const toStringArray = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String)
    if (v === undefined || v === null) return []
    const s = String(v).trim()
    if (!s) return []
    if (s.startsWith("[") && s.endsWith("]")) {
        try {
            const parsed = JSON.parse(s)
            if (Array.isArray(parsed)) return parsed.map(String)
        } catch {}
    }
    return s
        .split(/[\s,;\n\r\t]+/g)
        .map((t) => t.trim())
        .filter(Boolean)
}

const toBetweenNumberPair = (v: unknown): number[] => {
    const nums: number[] = []
    const pushNum = (x: any) => {
        const n = coerceNumericValue(x) as any
        if (typeof n === "number" && Number.isFinite(n)) nums.push(n)
    }

    if (Array.isArray(v)) {
        v.slice(0, 2).forEach(pushNum)
        return nums.length === 2 ? nums : []
    }

    if (typeof v === "string") {
        const s = v.trim()
        if (!s) return []
        if (s.startsWith("[") && s.endsWith("]")) {
            try {
                const parsed = JSON.parse(s)
                if (Array.isArray(parsed)) {
                    parsed.slice(0, 2).forEach(pushNum)
                    return nums.length === 2 ? nums : []
                }
            } catch {}
        }
        s.split(/[\s,;,\n\r\t]+/g)
            .filter(Boolean)
            .slice(0, 2)
            .forEach(pushNum)
        return nums.length === 2 ? nums : []
    }

    return []
}

const Filters: React.FC<Props> = ({
    filterData,
    columns,
    onApplyFilter,
    onClearFilter,
    buttonProps,
}) => {
    const classes = useStyles()

    const cloneFilterValue = (value?: Filter["value"]): Filter["value"] => {
        if (value === undefined) return ""
        if (typeof value === "object" && value !== null) return JSON.parse(JSON.stringify(value))
        return value
    }

    const createEmptyFilter = (): FilterItem => ({
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

    type ValueShape = "string" | "string[]" | "object[]"

    type OptionMeta = {
        label: string
        type?: string
        baseField?: string
        displayLabel?: string
        operatorOptions?: Array<{value: FilterConditions; label: string}>
        defaultValue?: Filter["value"]
        keyInputType?: InputKind
        keyOptions?: Array<{label: string; value: string | number}>
        keyPlaceholder?: string
        valueInputType?: InputKind
        valueOptions?: Array<{label: string; value: string | number}>
        valuePlaceholder?: string
        disableValueInput?: boolean
        valueDisplayText?: string
        valueShape?: ValueShape
    }

    const optionMetaByValue = useMemo(() => {
        const metaByValue = new Map<string, OptionMeta>()
        const walk = (nodes: FilterMenuNode[], ancestors: FilterGroup[] = []) => {
            nodes.forEach((node) => {
                if (node.kind === "group") {
                    walk((node as FilterGroup).children, [...ancestors, node as FilterGroup])
                    return
                }
                const leaf = node as FilterLeaf
                const controlling = [...ancestors].reverse().find((g) => g.leafDisplayLabel)

                const keyCfg = leaf.keyInput
                const valCfg = leaf.valueInput
                const legacyNone = leaf.disableValueInput ? "none" : undefined

                let valueShape: ValueShape
                if (
                    leaf.disableValueInput &&
                    Array.isArray(leaf.defaultValue) &&
                    leaf.defaultValue.length > 0 &&
                    typeof (leaf.defaultValue as any[])[0] === "object"
                ) {
                    valueShape = "object[]"
                } else if (valCfg?.kind === "select") {
                    valueShape = "string"
                } else {
                    valueShape = "string"
                }

                metaByValue.set(leaf.value, {
                    label: leaf.displayLabel ?? leaf.label,
                    type: leaf.type,
                    baseField: leaf.field,
                    displayLabel: leaf.displayLabel ?? controlling?.leafDisplayLabel,
                    operatorOptions: leaf.operatorOptions,
                    defaultValue: leaf.defaultValue,
                    keyInputType: keyCfg?.kind,
                    keyOptions: keyCfg && "options" in keyCfg ? (keyCfg as any).options : undefined,
                    keyPlaceholder: keyCfg?.kind === "text" ? keyCfg.placeholder : undefined,
                    valueInputType: valCfg?.kind ?? (legacyNone as InputKind | undefined) ?? "text",
                    valueOptions:
                        valCfg && "options" in valCfg ? (valCfg as any).options : undefined,
                    valuePlaceholder: valCfg?.kind === "text" ? valCfg.placeholder : undefined,
                    disableValueInput: leaf.disableValueInput,
                    valueDisplayText: leaf.valueDisplayText,
                    valueShape,
                })
            })
        }
        walk(columns)
        return metaByValue
    }, [columns])

    const normalizeFilterValue = (
        value: FilterItem["value"],
        operator: FilterConditions,
        fieldType: string | undefined,
        meta?: OptionMeta,
    ): Filter["value"] => {
        if (isBetweenOperator(operator)) {
            return toBetweenNumberPair(value)
        }
        if (isListOperator(operator)) {
            if (meta?.valueShape === "object[]") {
                if (Array.isArray(value)) return value as any
                if (value === "" || value === undefined || value === null)
                    return (meta?.defaultValue as any) ?? []
                if (typeof value === "string" && value.trim().startsWith("[")) {
                    try {
                        const parsed = JSON.parse(value)
                        if (Array.isArray(parsed)) return parsed as any
                    } catch {}
                }
                return (meta?.defaultValue as any) ?? []
            }
            const arr = toStringArray(value)
            if (fieldType === "number") return arr.map((v) => coerceNumericValue(v)) as any
            return arr
        }
        if (Array.isArray(value)) return (value[0] ?? "") as any
        if (fieldType === "number") return coerceNumericValue(value as any) as any
        return value as any
    }

    const findFirstLeafValue = (nodes: FilterMenuNode[]): string | undefined => {
        for (const child of nodes) {
            if (child.kind === "leaf") return (child as FilterLeaf).value
            const nested = findFirstLeafValue((child as FilterGroup).children)
            if (nested) return nested
        }
        return undefined
    }

    const hasLeafWithValue = (nodes: FilterMenuNode[], v: string): boolean =>
        nodes.some((n) =>
            n.kind === "leaf"
                ? (n as FilterLeaf).value === v
                : hasLeafWithValue((n as FilterGroup).children, v),
        )

    const getGroupDefaultValue = (group: FilterGroup): string | undefined =>
        group.defaultValue && hasLeafWithValue(group.children, group.defaultValue)
            ? group.defaultValue
            : findFirstLeafValue(group.children)

    type FieldMenuItem = Required<MenuProps>["items"][number]

    const buildFieldMenuItems = (
        nodes: FilterMenuNode[],
        onSelect: (value: string, displayLabel?: string) => void,
        parentKey = "root",
    ): MenuProps["items"] => {
        const items: MenuProps["items"] = []
        nodes.forEach((node, index) => {
            if (node.kind === "group") {
                const group = node as FilterGroup
                const groupKey = `group:${parentKey}:${index}`
                const defaultValue = getGroupDefaultValue(group)
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
                    children: buildFieldMenuItems(group.children, onSelect, groupKey),
                    onTitleClick: defaultValue
                        ? ({domEvent}) => {
                              domEvent.preventDefault()
                              domEvent.stopPropagation()
                              onSelect(
                                  defaultValue,
                                  group.titleClickDisplayLabel ?? group.leafDisplayLabel,
                              )
                          }
                        : undefined,
                } as FieldMenuItem)
            } else {
                const leaf = node as FilterLeaf
                items.push({
                    key: leaf.value,
                    label: (
                        <div className="flex items-center gap-2">
                            {leaf.icon ? <leaf.icon size={16} /> : null}
                            <span>{leaf.label}</span>
                        </div>
                    ),
                } as FieldMenuItem)
            }
        })
        return items
    }

    const mapFilterData = (data: Filter[]): FilterItem[] =>
        data.map((item) => {
            const lookupCandidates = [item.field, item.key].filter(Boolean) as string[]
            let meta: OptionMeta | undefined
            let uiKey: string | undefined

            for (const cand of lookupCandidates) {
                const hit = optionMetaByValue.get(cand)
                if (hit) {
                    meta = hit
                    uiKey = cand
                    break
                }
            }
            if (!meta) {
                for (const [candidateUIKey, m] of optionMetaByValue.entries()) {
                    if (lookupCandidates.includes(m.baseField || "")) {
                        meta = m
                        uiKey = candidateUIKey
                        break
                    }
                }
            }

            if (meta && uiKey) {
                return {
                    ...item,
                    field: uiKey,
                    key: item.key || "",
                    selectedField: uiKey,
                    fieldType: meta.type,
                    isCustomField: false,
                    baseField: meta.baseField || item.field,
                    selectedLabel: meta.displayLabel,
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

    const [filter, setFilter] = useState<FilterItem[]>(() =>
        !filterData?.length ? [createEmptyFilter()] : mapFilterData(filterData),
    )
    const [activeFieldDropdown, setActiveFieldDropdown] = useState<number | null>(null)

    const sanitizeFilterItems = (items: FilterItem[]): Filter[] =>
        items.map(
            ({field, key, operator, value, isPermanent, fieldType, baseField, selectedField}) => {
                const meta = optionMetaByValue.get(selectedField || field || "")
                const normalizedValue = normalizeFilterValue(value, operator, fieldType, meta)
                const sanitizedField = baseField || field
                const out: Filter = {
                    field: sanitizedField,
                    operator,
                    value: normalizedValue,
                    ...(isPermanent ? {isPermanent} : {}),
                }
                if (key !== undefined && key !== "") out.key = key
                return out
            },
        )

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

    const isApplyDisabled = useMemo(() => {
        return filter.some((f) => {
            if (f.isPermanent) return false
            if (!f.operator) return true

            const meta = optionMetaByValue.get(f.selectedField || f.field || "")
            const needsKey = Boolean(meta?.keyInputType && meta.keyInputType !== "none")
            const hideVal = operatorHidesValue(f.operator) || meta?.valueInputType === "none"

            if (needsKey && (!f.key || f.key === "")) return true

            if (!hideVal) {
                if (isBetweenOperator(f.operator)) {
                    const pair = toBetweenNumberPair(f.value)
                    if (pair.length !== 2) return true
                } else {
                    const hasValue =
                        (Array.isArray(f.value) && f.value.length > 0) ||
                        (!!f.value && String(f.value).length > 0)
                    if (!hasValue) return true
                }
            }
            return false
        })
    }, [filter, optionMetaByValue])

    const activeFilterCount = useMemo(
        () => sanitizedFilters.filter(({field, operator}) => field && operator).length,
        [sanitizedFilters],
    )

    const [isFilterOpen, setIsFilterOpen] = useState(false)

    useLazyEffect(() => {
        if (filterData && filterData.length > 0) setFilter(mapFilterData(filterData))
        else setFilter([createEmptyFilter()])
    }, [filterData, columns])

    const operators = [
        {type: "string", value: "contains", label: "contains"},
        {type: "string", value: "matches", label: "matches"},
        {type: "string", value: "like", label: "like"},
        {type: "string", value: "startswith", label: "startswith"},
        {type: "string", value: "endswith", label: "endswith"},
        {type: "exists", value: "exists", label: "exists"},
        {type: "exists", value: "not_exists", label: "not exists"},
        {type: "exists", value: "in", label: "in"},
        {type: "exists", value: "not_in", label: "not in"},
        {type: "exists", value: "is", label: "is"},
        {type: "exists", value: "is_not", label: "is not"},
        {type: "number", value: "eq", label: "="},
        {type: "number", value: "neq", label: "!="},
        {type: "number", value: "gt", label: ">"},
        {type: "number", value: "lt", label: "<"},
        {type: "number", value: "gte", label: ">="},
        {type: "number", value: "lte", label: "<="},
        {type: "number", value: "btwn", label: "between"},
    ]

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
                })
            } else {
                const meta = optionMetaByValue.get(uiValue)
                current.selectedField = uiValue
                current.field = uiValue
                const usesKey = Boolean(meta?.keyInputType && meta.keyInputType !== "none")
                if (usesKey) current.key = ""
                current.operator = meta?.operatorOptions?.[0]?.value ?? ""
                current.value = cloneFilterValue(meta?.defaultValue)
                current.fieldType = meta?.type
                current.isCustomField = false
                current.baseField = meta?.baseField
                current.selectedLabel = selectedLabel ?? meta?.displayLabel
            }
            next[idx] = current
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

            if (columnName === "operator") {
                const prevOp = current.operator
                const willMulti = isListOperator(value) || isBetweenOperator(value)
                const wasMulti = isListOperator(prevOp) || isBetweenOperator(prevOp)

                const uiKey = current.selectedField || current.field || ""
                const meta = optionMetaByValue.get(uiKey)
                const hasSelectOptions =
                    meta?.valueInputType === "select" &&
                    !!meta?.valueOptions &&
                    meta.valueOptions.length > 0

                if (willMulti && !wasMulti) {
                    if (hasSelectOptions) current.value = toStringArray(current.value)
                } else if (!willMulti && wasMulti) {
                    if (Array.isArray(current.value)) current.value = current.value[0] ?? ""
                }

                current.operator = value
                next[idx] = current
                return next
            }

            next[idx] = {...current, [columnName]: value}
            return next
        })
    }

    const onDeleteFilter = (index: number) => setFilter(filter.filter((_, idx) => idx !== index))
    const addNestedFilter = () => setFilter([...filter, createEmptyFilter()])

    const clearFilter = () => {
        const kept = filter.filter((f) => f.isPermanent)
        const sanitizedKept = sanitizeFilterItems(kept)
        if (!isEqual(sanitizedKept, filterData)) onClearFilter(sanitizedKept)
        setActiveFieldDropdown(null)
        setFilter(!kept.length ? [createEmptyFilter()] : kept)
    }

    const applyFilter = () => {
        const out = sanitizeFilterItems(filter)
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
            destroyTooltipOnHide
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
                            const meta = optionMetaByValue.get(uiKey)

                            const operatorOptions = meta?.operatorOptions
                                ? meta.operatorOptions
                                : item.isCustomField || !item.fieldType
                                  ? operators
                                  : operators.filter((op) => op.type === item.fieldType)

                            const rawValue = Array.isArray(item.value) ? "" : (item.value as any)
                            const displayValue = meta?.valueDisplayText || rawValue

                            const keyInputType: InputKind | undefined = meta?.keyInputType
                            const keyOptions = meta?.keyOptions
                            const keyPlaceholder = meta?.keyPlaceholder ?? "Key"

                            const valueInputType: InputKind =
                                meta?.valueInputType ?? (meta?.disableValueInput ? "none" : "text")
                            const valueOptions = meta?.valueOptions
                            const valuePlaceholder = isBetweenOperator(item.operator)
                                ? "[min, max]"
                                : (meta?.valuePlaceholder ?? "Value")

                            const hideValue =
                                operatorHidesValue(item.operator) || valueInputType === "none"
                            const listOp = isListOperator(item.operator)
                            const hasSelectOptions =
                                valueInputType === "select" &&
                                !!valueOptions &&
                                valueOptions.length > 0

                            return (
                                <Space direction="vertical" size={0} key={idx}>
                                    <Typography.Text type="secondary">
                                        {idx === 0 ? "Where" : "And"}
                                    </Typography.Text>

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
                                                ),
                                                onClick: ({key}) =>
                                                    handleFieldSelection(String(key), idx),
                                            }}
                                            getPopupContainer={(trigger) =>
                                                (trigger &&
                                                    (trigger.closest(
                                                        ".ant-popover",
                                                    ) as HTMLElement)) ||
                                                document.body
                                            }
                                        >
                                            <Button
                                                className="w-[180px] flex items-center justify-between"
                                                disabled={item.isPermanent}
                                            >
                                                <span className="truncate">
                                                    {item.isCustomField
                                                        ? "Custom"
                                                        : (item.selectedLabel ??
                                                          optionMetaByValue.get(uiKey)?.label ??
                                                          "Field")}
                                                </span>
                                                <CaretDown size={14} />
                                            </Button>
                                        </Dropdown>

                                        {keyInputType &&
                                            keyInputType !== "none" &&
                                            (keyInputType === "select" ? (
                                                <Select
                                                    className="w-[160px]"
                                                    options={keyOptions}
                                                    value={item.key || undefined}
                                                    onChange={(v) =>
                                                        onFilterChange({
                                                            columnName: "key",
                                                            value: v,
                                                            idx,
                                                        })
                                                    }
                                                    placeholder={keyPlaceholder}
                                                    suffixIcon={<CaretDown size={14} />}
                                                    popupMatchSelectWidth
                                                    disabled={item.isPermanent}
                                                />
                                            ) : (
                                                <Input
                                                    placeholder={keyPlaceholder}
                                                    value={
                                                        typeof item.key === "string" ||
                                                        item.key === undefined
                                                            ? (item.key as string)
                                                            : ""
                                                    }
                                                    disabled={item.isPermanent}
                                                    className="w-[160px]"
                                                    onChange={(e) =>
                                                        onFilterChange({
                                                            columnName: "key",
                                                            value: e.target.value,
                                                            idx,
                                                        })
                                                    }
                                                />
                                            ))}

                                        <Select
                                            placeholder="Operator"
                                            labelRender={(label) =>
                                                !label.value ? "Condition" : label.label
                                            }
                                            suffixIcon={<CaretDown size={14} />}
                                            onChange={(value) =>
                                                onFilterChange({columnName: "operator", value, idx})
                                            }
                                            className={
                                                !item.isCustomField ? "w-[120px]" : "w-[90px]"
                                            }
                                            popupMatchSelectWidth={120}
                                            value={item.operator || undefined}
                                            options={operatorOptions}
                                            disabled={item.isPermanent}
                                        />

                                        {hideValue ? (
                                            <Input
                                                placeholder="Value"
                                                value={displayValue}
                                                disabled
                                                readOnly
                                                className="flex-1 min-w-[120px] w-full"
                                            />
                                        ) : listOp && hasSelectOptions ? (
                                            <Select
                                                mode="tags"
                                                className="flex-1 min-w-[120px] w-full"
                                                options={valueOptions}
                                                tokenSeparators={[",", " ", "\n", "\t", ";"]}
                                                value={
                                                    Array.isArray(item.value)
                                                        ? (item.value as any)
                                                        : (toStringArray(item.value) as any)
                                                }
                                                onChange={(vals) =>
                                                    onFilterChange({
                                                        columnName: "value",
                                                        value: vals,
                                                        idx,
                                                    })
                                                }
                                                placeholder={valuePlaceholder}
                                                suffixIcon={<CaretDown size={14} />}
                                                popupMatchSelectWidth
                                                disabled={item.isPermanent}
                                            />
                                        ) : listOp ? (
                                            <Input
                                                placeholder={valuePlaceholder}
                                                value={
                                                    typeof item.value === "object"
                                                        ? JSON.stringify(item.value)
                                                        : (item.value as any)
                                                }
                                                disabled={item.isPermanent}
                                                className="flex-1 min-w-[120px] w-full"
                                                onChange={(e) =>
                                                    onFilterChange({
                                                        columnName: "value",
                                                        value: e.target.value,
                                                        idx,
                                                    })
                                                }
                                            />
                                        ) : valueInputType === "select" ? (
                                            <Select
                                                className="flex-1 min-w-[120px] w-full"
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
                                                suffixIcon={<CaretDown size={14} />}
                                                popupMatchSelectWidth
                                                disabled={item.isPermanent}
                                            />
                                        ) : (
                                            <Input
                                                placeholder={valuePlaceholder}
                                                value={
                                                    typeof item.value === "object"
                                                        ? JSON.stringify(item.value)
                                                        : (item.value as any)
                                                }
                                                disabled={item.isPermanent}
                                                className="flex-1 min-w-[120px] w-full"
                                                onChange={(e) =>
                                                    onFilterChange({
                                                        columnName: "value",
                                                        value: e.target.value,
                                                        idx,
                                                    })
                                                }
                                            />
                                        )}

                                        {filter.length > 1 && (
                                            <Button
                                                type="link"
                                                icon={<Trash size={14} />}
                                                disabled={item.isPermanent}
                                                onClick={() => onDeleteFilter(idx)}
                                            />
                                        )}
                                    </div>
                                </Space>
                            )
                        })}

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
                {activeFilterCount > 0 && <CustomAntdBadge count={activeFilterCount} />}
            </Button>
        </Popover>
    )
}

export default Filters
