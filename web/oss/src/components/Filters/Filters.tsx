import {useMemo, useState} from "react"
import {ArrowClockwiseIcon, CaretDown, Funnel, Plus, Trash} from "@phosphor-icons/react"
import {
    Button,
    Divider,
    Input,
    Popover,
    Select,
    Space,
    Typography,
    Dropdown,
    MenuProps,
    TreeSelect,
} from "antd"
import type {TreeSelectProps} from "antd"
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
import {
    FilterMenuNode,
    FilterLeaf,
    FilterGroup,
    SelectOption,
    Props,
    FilterItem,
    FieldMenuItem,
    RowValidation,
} from "./types"
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

const buildFieldMenuItems = (
    nodes: FilterMenuNode[],
    onSelect: (value: string, displayLabel?: string) => void,
    parentKey = "root",
    ancestors: FilterGroup[] = [],
    submenuPopupClassName?: string,
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
                children: buildFieldMenuItems(
                    group.children,
                    onSelect,
                    groupKey,
                    [...ancestors, group],
                    submenuPopupClassName,
                ),
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
                popupClassName: submenuPopupClassName,
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
                            // Keep only parsed booleans; if none parsed, send undefined to fail validation upstream
                            valueToSend = mapped.filter((v) => v !== undefined)
                            if ((valueToSend as unknown[]).length === 0) valueToSend = undefined
                        } else {
                            valueToSend = toBool(value)
                        }
                    } else {
                        // string
                        if (shape === "list") {
                            valueToSend = Array.isArray(value) ? value : [value].filter(Boolean)
                        } else if (shape === "range") {
                            // Rare for strings; pass through as-is and let existing validation catch issues
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
        if (filterData && filterData.length > 0) setFilter(mapFilterData(filterData))
        else setFilter([])
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
    const applyFilter = () => {
        const out = sanitizeFilterItems(filter)
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
            overlayStyle={{maxWidth: "100vw"}}
            overlayInnerStyle={{maxHeight: "70vh"}}
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
                            const baseFieldCfg = getField(uiKey)
                            const field = effectiveFieldForRow(baseFieldCfg, item)

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

                            return (
                                <Space
                                    direction="vertical"
                                    className={`overflow-x-auto [&::-webkit-scrollbar]:!w-0 [&::-webkit-scrollbar]:!h-0`}
                                    size={0}
                                    key={idx}
                                >
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
                                                    "root",
                                                    [],
                                                    classes.fieldDropdownSubmenu,
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
                                                <CaretDown size={14} />
                                            </Button>
                                        </Dropdown>

                                        {showKey &&
                                            (field!.keyInput!.kind === "select" ? (
                                                (() => {
                                                    const options = field!.keyInput!
                                                        .options as SelectOption[]
                                                    const optionValues =
                                                        collectOptionValues(options)
                                                    const currentSearch = keySearchTerms[idx] ?? ""
                                                    const normalizedSearch =
                                                        normalizeAttributeSearch(currentSearch)
                                                    const additionalNodes: NonNullable<
                                                        TreeSelectProps["treeData"]
                                                    > = []
                                                    const keyValue =
                                                        item.key === undefined || item.key === null
                                                            ? undefined
                                                            : String(item.key)
                                                    if (
                                                        normalizedSearch &&
                                                        !optionValues.has(normalizedSearch.value)
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
                                                            ? [...additionalNodes, ...baseTreeData]
                                                            : baseTreeData
                                                    const expandedKeys = collectTreeKeys(treeData)
                                                    return (
                                                        <TreeSelect
                                                            className="w-[260px]"
                                                            treeData={treeData}
                                                            treeNodeLabelProp="pathLabel"
                                                            dropdownMatchSelectWidth={false}
                                                            dropdownStyle={{
                                                                minWidth: 260,
                                                                ...dropdownPanelStyle,
                                                            }}
                                                            getPopupContainer={(t) =>
                                                                getWithinPopover(t)
                                                            }
                                                            value={
                                                                item.key && item.key !== ""
                                                                    ? (item.key as string | number)
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
                                                                    return {...prev, [idx]: trimmed}
                                                                })
                                                            }
                                                            onDropdownVisibleChange={(open) => {
                                                                if (!open) {
                                                                    setKeySearchTerms((prev) => {
                                                                        if (!(idx in prev))
                                                                            return prev
                                                                        const next = {...prev}
                                                                        delete next[idx]
                                                                        return next
                                                                    })
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
                                                                    typeof node?.title === "string"
                                                                        ? node.title
                                                                        : String(node?.title ?? "")
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

                                        {!singleOperator && (
                                            <Select
                                                placeholder="Operator"
                                                labelRender={(label) =>
                                                    !label.value ? "Condition" : label.label
                                                }
                                                suffixIcon={<CaretDown size={14} />}
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
                                                dropdownStyle={dropdownPanelStyle}
                                            />
                                        )}

                                        {!showValue ? (
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
                                                suffixIcon={<CaretDown size={14} />}
                                                popupMatchSelectWidth
                                                disabled={item.isPermanent}
                                                status={valueHasError ? "error" : undefined}
                                                getPopupContainer={(t) => getWithinPopover(t)}
                                                dropdownStyle={dropdownPanelStyle}
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
                                                suffixIcon={<CaretDown size={14} />}
                                                popupMatchSelectWidth
                                                disabled={item.isPermanent}
                                                status={valueHasError ? "error" : undefined}
                                                getPopupContainer={(t) => getWithinPopover(t)}
                                                dropdownStyle={dropdownPanelStyle}
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
                                                onChange={(v: "string" | "number" | "boolean") =>
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
                                                suffixIcon={<CaretDown size={14} />}
                                                popupMatchSelectWidth
                                                disabled={item.isPermanent}
                                                getPopupContainer={(t) => getWithinPopover(t)}
                                                dropdownStyle={dropdownPanelStyle}
                                            />
                                        )}

                                        {!item.isPermanent && (
                                            <Button
                                                type="link"
                                                icon={<Trash size={14} />}
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
