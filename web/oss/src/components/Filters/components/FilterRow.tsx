import React from "react"
import {CaretDown, Plus, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Input, Select, Space, TreeSelect, TreeSelectProps, Typography} from "antd"

import {FilterItem, FilterMenuNode, RowValidation, SelectOption} from "../types"
import {FieldConfig} from "@/oss/components/pages/observability/assets/filters/fieldAdapter"
import {FilterConditions} from "@/oss/lib/Types"

import {
    ALL_FEEDBACK_OPERATOR_OPTIONS,
    AnnotationFeedbackOption,
    AnnotationFeedbackValueType,
    AnnotationFilterValue,
    coerceNumericFeedbackValue,
    dedupeFeedbackOptions,
    EMPTY_DISABLED_OPTIONS,
    ensureFeedbackOperator,
    NUMERIC_FEEDBACK_OPERATOR_VALUES,
    parseFeedbackArrayInput,
} from "../helpers/annotation"

import {
    buildCustomTreeNode,
    collectOptionValues,
    collectTreeKeys,
    mapToTreeData,
    noopTreeExpand,
    normalizeAttributeSearch,
    operatorOptionsFromIds,
    valueToPathLabel,
} from "../helpers/utils"

import {planInputs} from "../../pages/observability/assets/filters/rulesEngine"
import {buildFieldMenuItems} from "../helpers/menu"
import {useStyles} from "../assets/styles"

interface FilterRowProps {
    item: FilterItem
    idx: number
    getField: (uiKey?: string) => FieldConfig | undefined
    effectiveFieldForRow: (
        field: FieldConfig | undefined,
        item: FilterItem,
    ) => FieldConfig | undefined
    extractAnnotationValue: (raw: FilterItem["value"]) => AnnotationFilterValue | undefined
    rowValidations: RowValidation[]
    hasAnnotationIndices: number[]
    annotationDisabledOptions: Set<string>
    annotationFeedbackOptions: AnnotationFeedbackOption[]
    onFilterChangeIdx: (columnName: keyof FilterItem, value: any) => void
    onDeleteFilter: (index: number) => void
    activeFieldDropdown: number | null
    setActiveFieldDropdown: (index: number | null) => void
    handleFieldSelection: (uiValue: string, idx: number, selectedLabel?: string) => void
    annotationEvaluatorOptions: {label: string; value: string}[]
    keySearchTerms: Record<number, string>
    setKeySearchTerms: React.Dispatch<React.SetStateAction<Record<number, string>>>
    columns: FilterMenuNode[]
}

/* ------------------------------ Shared UI bits ------------------------------ */

const dropdownPanelStyle = {
    maxWidth: "calc(100vw - 32px)",
    maxHeight: "60vh",
    overflow: "auto",
} as const

const getWithinPopover = (trigger: HTMLElement | null) =>
    (trigger && (trigger.closest(".ant-popover") as HTMLElement)) || document.body

const S: React.FC<React.ComponentProps<typeof Select>> = (props) => (
    <Select
        suffixIcon={<CaretDown size={14} />}
        getPopupContainer={(t) => getWithinPopover(t)}
        dropdownStyle={dropdownPanelStyle}
        {...props}
    />
)

const FilterRow = ({
    item,
    idx,
    getField,
    effectiveFieldForRow,
    extractAnnotationValue,
    rowValidations,
    hasAnnotationIndices,
    annotationDisabledOptions,
    annotationFeedbackOptions,
    onFilterChangeIdx,
    onDeleteFilter,
    activeFieldDropdown,
    setActiveFieldDropdown,
    handleFieldSelection,
    annotationEvaluatorOptions,
    columns,
    keySearchTerms,
    setKeySearchTerms,
}: FilterRowProps) => {
    const classes = useStyles()

    const uiKey = item.selectedField || item.field || ""
    const baseFieldCfg = getField(uiKey)
    const field = effectiveFieldForRow(baseFieldCfg, item)

    const isAnnotationFieldSelected = !!field?.baseField?.includes("annotation")

    const operatorOptions = field
        ? (field.operatorOptions ?? operatorOptionsFromIds(field.operatorIds))
        : []
    const singleOperator = operatorOptions.length === 1
    const operatorValue = item.operator || (singleOperator ? operatorOptions[0]?.value : undefined)

    const plan = field && operatorValue ? planInputs(field, operatorValue as any) : undefined
    const showKey = !!plan?.needsKey
    const showValue = !!plan?.showValue
    const valueAs = plan?.valueAs
    const valueOptions = plan?.valueOptions
    const keyPlaceholder = plan?.placeholders?.key ?? "Key"
    const valuePlaceholder = plan?.placeholders?.value ?? "Value"

    const rawValue = Array.isArray(item.value) ? "" : (item.value as any)
    const displayValue = (field as any)?.valueDisplayText || rawValue
    const validation = rowValidations[idx] ?? {isValid: true}
    const valueHasError = !!validation.valueInvalid

    const annotationValue = extractAnnotationValue(item.value)

    const disableHasAnnotationForRow = hasAnnotationIndices.some(
        (annotationIdx) => annotationIdx !== idx,
    )
    const disabledFieldOptionsForMenu = disableHasAnnotationForRow
        ? annotationDisabledOptions
        : undefined

    const setAnnotationValue = (
        updater: (prev: AnnotationFilterValue | undefined) => AnnotationFilterValue | undefined,
    ) => {
        const next = updater(annotationValue ? {...annotationValue} : undefined)
        if (!next || Object.keys(next).length === 0) {
            onFilterChangeIdx("value", [])
            return
        }
        const valueToStore: AnnotationFilterValue = {...next}
        if (valueToStore.feedback) {
            const cleaned = {...valueToStore.feedback}
            if (cleaned.valueType === undefined) cleaned.valueType = "string"
            valueToStore.feedback = cleaned
        }
        onFilterChangeIdx("value", [valueToStore])
    }

    const currentFeedback = annotationValue?.feedback

    const availableFeedbackOptions = (() => {
        if (annotationValue?.evaluator) {
            const filtered = annotationFeedbackOptions.filter(
                (o) => o.evaluatorSlug === annotationValue.evaluator,
            )
            const selectedKey = Array.isArray(currentFeedback?.field)
                ? currentFeedback?.field[0]
                : currentFeedback?.field
            const selected = selectedKey
                ? annotationFeedbackOptions.find((o) => o.value === selectedKey)
                : undefined
            if (selected && !filtered.some((o) => o.value === selected.value))
                return [selected, ...filtered]
            return filtered
        }
        return dedupeFeedbackOptions(annotationFeedbackOptions)
    })()

    const selectedFeedbackKey = Array.isArray(currentFeedback?.field)
        ? currentFeedback?.field[0]
        : currentFeedback?.field
    const selectedFeedbackOption = selectedFeedbackKey
        ? availableFeedbackOptions.find((option) => option.value === selectedFeedbackKey)
        : undefined

    const feedbackValueType = currentFeedback?.valueType ?? selectedFeedbackOption?.type ?? "string"

    const isEvaluatorActive = !!(annotationValue && "evaluator" in annotationValue)
    const isFeedbackActive = !!(annotationValue && "feedback" in annotationValue)

    const feedbackOperatorOptions = ALL_FEEDBACK_OPERATOR_OPTIONS

    const handleEvaluatorChange = (value?: string) => {
        setAnnotationValue((prev) => {
            const base: AnnotationFilterValue = {...(prev ?? {})}
            if (!value) {
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
                    const kept = base.feedback.field.filter((k) => allowed.has(k))
                    base.feedback.field = kept[0] ?? undefined
                } else if (base.feedback.field && !allowed.has(base.feedback.field)) {
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

            const sampleKey = Array.isArray(nextField) ? nextField[0] : nextField
            const option = availableFeedbackOptions.find((opt) => opt.value === sampleKey)
            const nextType = option ? option.type : (feedback.valueType ?? "string")

            feedback.field = nextField
            feedback.valueType = nextType
            feedback.operator = ensureFeedbackOperator(nextType, feedback.operator)
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
                const coerced = coerceNumericFeedbackValue(feedback.value)
                feedback.value = coerced === undefined ? "" : coerced
            }

            base.feedback = feedback
            return base
        })
    }

    const handleFeedbackTypeChange = (type: AnnotationFeedbackValueType) => {
        setAnnotationValue((prev) => {
            const base: AnnotationFilterValue = {...(prev ?? {})}
            const feedback = {...(base.feedback ?? {})}
            feedback.valueType = type
            feedback.operator = ensureFeedbackOperator(type, feedback.operator)
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
                if (parsedArray !== undefined) value = parsedArray
            }

            if (!Array.isArray(value)) {
                if (type === "number") {
                    if (typeof raw === "number") value = Number.isFinite(raw) ? raw : fb.value
                    else {
                        const coerced = coerceNumericFeedbackValue(raw)
                        value = coerced === undefined ? "" : coerced
                    }
                } else if (type === "boolean") {
                    if (typeof raw === "boolean") value = raw
                    else {
                        const s = String(raw).trim().toLowerCase()
                        value = s === "true" ? true : s === "false" ? false : undefined
                    }
                } else if (typeof raw === "string") value = raw
                else value = String(raw)
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
            icon={<Plus size={14} />}
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

    const feedbackFieldValueForSelect: string | string[] | undefined = Array.isArray(
        currentFeedback?.field,
    )
        ? currentFeedback?.field
        : (currentFeedback?.field ?? undefined)

    const feedbackOptionsForSelect = availableFeedbackOptions.map((option) => ({
        label: option.label,
        value: option.value,
    }))

    /* ------------------------------ Render ------------------------------ */

    return (
        <Space
            direction="vertical"
            className={`overflow-x-auto [&::-webkit-scrollbar]:!w-0 [&::-webkit-scrollbar]:!h-0`}
            size={0}
            key={idx}
        >
            <Typography.Text type="secondary">{idx === 0 ? "Where" : "And"}</Typography.Text>

            <Space direction="vertical" className="w-full">
                <div className="flex items-center gap-2 w-full">
                    <Dropdown
                        trigger={["click"]}
                        placement="bottomLeft"
                        open={activeFieldDropdown === idx}
                        onOpenChange={(open) => setActiveFieldDropdown(open ? idx : null)}
                        menu={{
                            items: buildFieldMenuItems(
                                columns,
                                (value, labelFromGroup) =>
                                    handleFieldSelection(value, idx, labelFromGroup),
                                "root",
                                [],
                                classes.fieldDropdownSubmenu,
                                disabledFieldOptionsForMenu ?? EMPTY_DISABLED_OPTIONS,
                            ),
                            onClick: ({key}) => handleFieldSelection(String(key), idx),
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
                                    : (item.selectedLabel ?? field?.label ?? "Field")}
                            </span>
                            <CaretDown size={14} />
                        </Button>
                    </Dropdown>

                    {showKey &&
                        (field!.keyInput!.kind === "select" ? (
                            (() => {
                                const options = field!.keyInput!.options as SelectOption[]
                                const optionValues = collectOptionValues(options)
                                const currentSearch = keySearchTerms[idx] ?? ""
                                const normalizedSearch = normalizeAttributeSearch(currentSearch)
                                const additionalNodes: NonNullable<TreeSelectProps["treeData"]> = []
                                const keyValue =
                                    item.key === undefined || item.key === null
                                        ? undefined
                                        : String(item.key)
                                if (normalizedSearch && !optionValues.has(normalizedSearch.value)) {
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
                                    !additionalNodes.some((node) => node.value === keyValue)
                                ) {
                                    additionalNodes.push(
                                        buildCustomTreeNode(keyValue, valueToPathLabel(keyValue)),
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
                                        styles={{
                                            popup: {
                                                root: {
                                                    minWidth: 260,
                                                    ...dropdownPanelStyle,
                                                },
                                            },
                                        }}
                                        getPopupContainer={(t) => getWithinPopover(t)}
                                        value={
                                            item.key && item.key !== ""
                                                ? (item.key as string | number)
                                                : undefined
                                        }
                                        onChange={(v) =>
                                            onFilterChangeIdx("key", v == null ? "" : v)
                                        }
                                        onSearch={(searchValue) =>
                                            setKeySearchTerms((prev) => {
                                                const trimmed = searchValue.trim()
                                                if (!trimmed) {
                                                    if (!(idx in prev)) return prev
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
                                                    if (!(idx in prev)) return prev
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
                                            const value = String(node?.value ?? "")
                                            const pathLabel =
                                                typeof (node as any)?.pathLabel === "string"
                                                    ? ((node as any).pathLabel as string)
                                                    : ""
                                            const search = input.trim().toLowerCase()
                                            return (
                                                title.toLowerCase().includes(search) ||
                                                value.toLowerCase().includes(search) ||
                                                pathLabel.toLowerCase().includes(search)
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
                                    typeof item.key === "string" || item.key === undefined
                                        ? (item.key as string)
                                        : ""
                                }
                                onChange={(e) => onFilterChangeIdx("key", e.target.value)}
                                disabled={item.isPermanent}
                            />
                        ))}

                    {isAnnotationFieldSelected && (
                        <Typography.Text type="secondary" className="whitespace-nowrap">
                            That
                        </Typography.Text>
                    )}

                    {!singleOperator && (
                        <S
                            placeholder="Operator"
                            labelRender={(label) => (!label.value ? "Condition" : label.label)}
                            onChange={(value) => onFilterChangeIdx("operator", value)}
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
                        // Evaluator / Feedback blocks
                        isEvaluatorActive ? (
                            <div className="flex items-center gap-2 w-full">
                                <S
                                    className="w-[220px] flex-1"
                                    showSearch
                                    placeholder="Evaluator"
                                    value={annotationValue?.evaluator}
                                    options={annotationEvaluatorOptions}
                                    onChange={(value) => handleEvaluatorChange(value as string)}
                                    allowClear
                                    suffixIcon={<CaretDown size={14} />}
                                    optionFilterProp="label"
                                    getPopupContainer={(t) => getWithinPopover(t)}
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
                                    icon={<Trash size={14} />}
                                    onClick={removeEvaluator}
                                />
                            </div>
                        ) : (
                            <Space>
                                <Button
                                    type="text"
                                    icon={<Plus size={14} />}
                                    onClick={() =>
                                        setAnnotationValue((prev) => ({
                                            ...(prev ?? {}),
                                            evaluator: "",
                                        }))
                                    }
                                >
                                    Add Evaluator
                                </Button>
                                {!isFeedbackActive && renderAddFeedbackButton()}
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
                        <S
                            mode="tags"
                            className="flex-1 min-w-[160px] w-full"
                            options={valueOptions}
                            tokenSeparators={[",", " ", "\n", "\t", ";"]}
                            value={
                                Array.isArray(item.value)
                                    ? (item.value as any)
                                    : [item.value as any].filter(Boolean)
                            }
                            onChange={(vals) => onFilterChangeIdx("value", vals)}
                            placeholder={valuePlaceholder}
                            suffixIcon={<CaretDown size={14} />}
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
                        <S
                            className="flex-1 min-w-[160px] w-full"
                            options={valueOptions}
                            value={item.value as any}
                            onChange={(v) => onFilterChangeIdx("value", v)}
                            placeholder={valuePlaceholder}
                            suffixIcon={<CaretDown size={14} />}
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
                            onChange={(e) => onFilterChangeIdx("value", e.target.value)}
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
                            onChange={(e) => onFilterChangeIdx("value", e.target.value)}
                            disabled={item.isPermanent}
                            className="flex-1 min-w-[160px] w-full"
                            status={valueHasError ? "error" : undefined}
                        />
                    )}

                    {field?.optionKey === "custom" && (
                        <S
                            className="w-[130px]"
                            value={item.customValueType ?? "string"}
                            onChange={(value) =>
                                onFilterChangeIdx(
                                    "customValueType" as any,
                                    value as "string" | "number" | "boolean",
                                )
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
                        !(isAnnotationFieldSelected && (isEvaluatorActive || isFeedbackActive)) && (
                            <Button
                                type="link"
                                icon={<Trash size={14} />}
                                onClick={() => onDeleteFilter(idx)}
                            />
                        )}
                </div>

                {(isEvaluatorActive || isFeedbackActive) &&
                    (isFeedbackActive ? (
                        <div className="w-full flex items-center gap-2">
                            <Typography.Text type="secondary" className="whitespace-nowrap">
                                Feedback
                            </Typography.Text>
                            <S
                                className="w-[180px]"
                                showSearch
                                mode={annotationValue?.evaluator ? undefined : "multiple"}
                                placeholder={
                                    annotationValue?.evaluator ? "Feedback" : "Select one or more"
                                }
                                value={feedbackFieldValueForSelect}
                                options={feedbackOptionsForSelect}
                                onChange={(val) => {
                                    handleFeedbackFieldChange(val as string | string[])
                                }}
                                suffixIcon={<CaretDown size={14} />}
                                optionFilterProp="label"
                                getPopupContainer={(t) => getWithinPopover(t)}
                                styles={{
                                    popup: {
                                        root: {
                                            ...(dropdownPanelStyle || {}),
                                        },
                                    },
                                }}
                            />
                            <S
                                className="w-[80px]"
                                value={currentFeedback?.operator}
                                options={feedbackOperatorOptions}
                                onChange={(value) =>
                                    handleFeedbackOperatorChange(value as FilterConditions)
                                }
                                suffixIcon={<CaretDown size={14} />}
                                getPopupContainer={(t) => getWithinPopover(t)}
                                styles={{
                                    popup: {
                                        root: {
                                            ...(dropdownPanelStyle || {}),
                                        },
                                    },
                                }}
                            />
                            {feedbackValueType === "boolean" ? (
                                <S
                                    className="flex-1"
                                    value={currentFeedback?.value ?? true}
                                    options={[
                                        {label: "true", value: true},
                                        {label: "false", value: false},
                                    ]}
                                    onChange={(value) =>
                                        handleFeedbackValueChange(value as boolean)
                                    }
                                />
                            ) : (
                                <Input
                                    className="flex-1"
                                    placeholder="Value"
                                    value={feedbackValueRaw}
                                    onChange={(e) => handleFeedbackValueChange(e.target.value)}
                                />
                            )}
                            <S
                                className="w-[100px]"
                                value={feedbackValueType}
                                options={[
                                    {label: "Text", value: "string"},
                                    {label: "Number", value: "number"},
                                    {label: "Boolean", value: "boolean"},
                                ]}
                                onChange={(value) =>
                                    handleFeedbackTypeChange(value as AnnotationFeedbackValueType)
                                }
                                suffixIcon={<CaretDown size={14} />}
                                getPopupContainer={(t) => getWithinPopover(t)}
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
                                icon={<Trash size={14} />}
                                onClick={removeFeedback}
                            />
                        </div>
                    ) : (
                        renderAddFeedbackButton()
                    ))}
            </Space>
        </Space>
    )
}

export default FilterRow
