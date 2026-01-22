/**
 * InputsDataSection Component
 *
 * Displays the "Inputs & Data" section showing:
 * - Expected inputs (from runnable schema)
 * - Provided inputs (from testcase data)
 * - Extra column management (add/remove user-defined columns)
 */

import {useState, useCallback, useMemo, type ReactNode} from "react"

import {useRunnable, type RunnableType, type TestsetColumn} from "@agenta/entities/runnable"
import {cn, statusColors, textColors, bgColors, borderColors} from "@agenta/ui"
import {Database, Plus, X} from "@phosphor-icons/react"
import {Button, Input, Space, Tag, Tooltip, Typography} from "antd"

import type {EntitySelection} from "../../EntitySelector"

import {OutputMappingSection} from "./OutputMappingSection"

const {Text} = Typography

export interface InputsDataSectionProps {
    /** The selected entity */
    entity: EntitySelection
    /** Expected input columns (from runnable's schema) - passed from parent or empty for downstream */
    columns: TestsetColumn[]
    /** Supplied input columns (from testset/testcase data) */
    suppliedColumns?: {key: string; name: string}[]
    /** Whether this is a downstream node (hides add column button) */
    isDownstream?: boolean
    /** Extra columns added by the user */
    extraColumns?: {key: string; name: string; type: string}[]
    /** Column keys that are newly added (from prompt template but not in original testcase data) */
    newColumnKeys?: string[]
    /** Callback to add a new extra column */
    onAddExtraColumn?: (name: string) => void
    /** Callback to remove an extra column */
    onRemoveExtraColumn?: (key: string) => void
    /** Children to render inside the section (DataSourceSection or DownstreamMappingsSection) */
    children?: ReactNode
    /** Loadable ID for output mapping (primary node only) */
    loadableId?: string
    /** Whether to show the output mappings section (primary node only) */
    showOutputMappings?: boolean
    /** Callback to add output mapping column (only adds to testcase data, not to extraColumns) */
    onAddOutputMappingColumn?: (name: string) => void
}

export function InputsDataSection({
    entity,
    columns,
    suppliedColumns = [],
    isDownstream = false,
    extraColumns = [],
    newColumnKeys = [],
    onAddExtraColumn,
    onAddOutputMappingColumn,
    onRemoveExtraColumn,
    children,
    loadableId,
    showOutputMappings = false,
}: InputsDataSectionProps) {
    const type = entity.type as RunnableType
    const runnable = useRunnable(type, entity.id)

    // State for adding new extra column
    const [newColumnName, setNewColumnName] = useState("")
    const [isAddingColumn, setIsAddingColumn] = useState(false)
    // State for expanding unused columns
    const [showAllUnused, setShowAllUnused] = useState(false)

    const handleAddColumn = useCallback(() => {
        if (newColumnName.trim() && onAddExtraColumn) {
            onAddExtraColumn(newColumnName.trim())
            setNewColumnName("")
            setIsAddingColumn(false)
        }
    }, [newColumnName, onAddExtraColumn])

    // For downstream nodes (when columns prop is empty), derive columns from runnable.inputs
    const effectiveColumns: TestsetColumn[] = useMemo(
        () =>
            columns.length > 0
                ? columns
                : runnable.inputs.map((input) => ({
                      key: input.key,
                      name: input.name || input.key,
                      type: (input.type as TestsetColumn["type"]) || "string",
                      required: input.required,
                  })),
        [columns, runnable.inputs],
    )

    const hasInputs = effectiveColumns.length > 0
    const hasSuppliedInputs = suppliedColumns.length > 0

    // Calculate coverage: which expected inputs are supplied
    const suppliedKeySet = useMemo(
        () => new Set(suppliedColumns.map((c) => c.key)),
        [suppliedColumns],
    )
    const expectedKeySet = useMemo(
        () => new Set(effectiveColumns.map((c) => c.key)),
        [effectiveColumns],
    )
    const newKeySet = useMemo(() => new Set(newColumnKeys), [newColumnKeys])
    const coveredCount = useMemo(
        () => effectiveColumns.filter((c) => suppliedKeySet.has(c.key)).length,
        [effectiveColumns, suppliedKeySet],
    )

    // Categorize and sort supplied columns:
    // 1. Expected columns (green) - in original prompt template
    // 2. New columns (blue) - added to prompt template but not in original testcase
    // 3. Extra columns (purple) - user-defined columns
    // 4. Unused columns (gray) - in testcase but not in prompt template
    const sortedSuppliedColumns = useMemo(() => {
        const extraKeySet = new Set(extraColumns.map((ec) => ec.key))

        const expected: typeof suppliedColumns = []
        const newCols: typeof suppliedColumns = []
        const extra: typeof suppliedColumns = []
        const unused: typeof suppliedColumns = []

        for (const col of suppliedColumns) {
            const isExpected = expectedKeySet.has(col.key)
            const isExtra = extraKeySet.has(col.key)
            const isNew = newKeySet.has(col.key)

            if (isExtra) {
                extra.push(col)
            } else if (isNew) {
                newCols.push(col)
            } else if (isExpected) {
                expected.push(col)
            } else {
                unused.push(col)
            }
        }

        return {expected, newCols, extra, unused}
    }, [suppliedColumns, expectedKeySet, newKeySet, extraColumns])

    // Determine which unused columns to show
    const visibleUnusedColumns = useMemo(() => {
        if (showAllUnused || sortedSuppliedColumns.unused.length <= 1) {
            return sortedSuppliedColumns.unused
        }
        return [] // Show none when collapsed (will show "+X unused" button instead)
    }, [sortedSuppliedColumns.unused, showAllUnused])

    const hiddenUnusedCount = sortedSuppliedColumns.unused.length - visibleUnusedColumns.length

    return (
        <div className="px-4 pb-4">
            <div
                className={cn(
                    "border rounded-lg overflow-hidden",
                    borderColors.secondary,
                    bgColors.subtle,
                )}
            >
                {/* Section Header */}
                <div
                    className={cn(
                        "flex items-center justify-between px-3 py-2 border-b",
                        borderColors.strong,
                        bgColors.container,
                    )}
                >
                    <div className="flex items-center gap-2">
                        <Database size={14} className={textColors.secondary} />
                        <Text strong className="text-sm">
                            Inputs & Data
                        </Text>
                    </div>
                </div>

                {/* Expected / Provided Inputs - Row Layout */}
                <div className={cn("px-3 py-2 border-b", borderColors.divider)}>
                    <div className="flex gap-4">
                        {/* Expected Inputs */}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1.5">
                                <Text type="secondary" className="text-xs uppercase tracking-wide">
                                    Expected
                                </Text>
                                {hasInputs && hasSuppliedInputs && (
                                    <Text
                                        type="secondary"
                                        className={cn(
                                            "text-xs",
                                            coveredCount === effectiveColumns.length
                                                ? statusColors.successIcon
                                                : statusColors.warning,
                                        )}
                                    >
                                        {coveredCount}/{effectiveColumns.length}
                                    </Text>
                                )}
                            </div>
                            {hasInputs ? (
                                <div className="flex flex-wrap gap-1.5">
                                    {effectiveColumns.map((col) => {
                                        const isCovered = suppliedKeySet.has(col.key)
                                        return (
                                            <Tag
                                                key={col.key}
                                                color={
                                                    !hasSuppliedInputs
                                                        ? "blue"
                                                        : isCovered
                                                          ? "green"
                                                          : "orange"
                                                }
                                                className="m-0"
                                            >
                                                {col.name}
                                            </Tag>
                                        )
                                    })}
                                </div>
                            ) : (
                                <Text type="secondary" className="text-xs">
                                    No inputs detected
                                </Text>
                            )}
                        </div>

                        {/* Provided Inputs */}
                        <div className="flex-1 min-w-0">
                            <Text
                                type="secondary"
                                className="text-xs uppercase tracking-wide block mb-1.5"
                            >
                                Provided
                            </Text>
                            <div className="flex flex-wrap gap-1.5">
                                {/* 1. Expected columns (green) */}
                                {sortedSuppliedColumns.expected.map((col) => (
                                    <Tag key={col.key} color="green" className="m-0">
                                        {col.name}
                                    </Tag>
                                ))}

                                {/* 2. New columns (blue) */}
                                {sortedSuppliedColumns.newCols.map((col) => (
                                    <Tag key={col.key} color="blue" className="m-0">
                                        {col.name}
                                        <span
                                            className={textColors.quaternary + " ml-1 text-[10px]"}
                                        >
                                            (new)
                                        </span>
                                    </Tag>
                                ))}

                                {/* 3. Extra columns (purple) - in supplied data */}
                                {sortedSuppliedColumns.extra.map((col) => (
                                    <Tag
                                        key={col.key}
                                        color="purple"
                                        className="m-0"
                                        closable={!!onRemoveExtraColumn}
                                        onClose={(e) => {
                                            e.preventDefault()
                                            onRemoveExtraColumn?.(col.key)
                                        }}
                                    >
                                        {col.name}
                                        <span
                                            className={textColors.quaternary + " ml-1 text-[10px]"}
                                        >
                                            (extra)
                                        </span>
                                    </Tag>
                                ))}

                                {/* Extra columns not yet in supplied (defined but no data yet) */}
                                {extraColumns
                                    .filter(
                                        (ec) => !suppliedColumns.some((sc) => sc.key === ec.key),
                                    )
                                    .map((col) => (
                                        <Tag
                                            key={col.key}
                                            color="purple"
                                            className="m-0 opacity-60"
                                            closable={!!onRemoveExtraColumn}
                                            onClose={(e) => {
                                                e.preventDefault()
                                                onRemoveExtraColumn?.(col.key)
                                            }}
                                        >
                                            {col.name}
                                            <span className="text-purple-400 ml-1 text-[10px]">
                                                (extra)
                                            </span>
                                        </Tag>
                                    ))}

                                {/* 4. Unused columns (gray) - shown at the end */}
                                {visibleUnusedColumns.map((col) => (
                                    <Tag key={col.key} color="default" className="m-0">
                                        {col.name}
                                        <span className={cn(textColors.quaternary, "ml-1")}>
                                            (unused)
                                        </span>
                                    </Tag>
                                ))}

                                {/* "+X unused" collapse/expand button */}
                                {hiddenUnusedCount > 0 && (
                                    <Tooltip
                                        title={sortedSuppliedColumns.unused
                                            .map((c) => c.name)
                                            .join(", ")}
                                    >
                                        <Tag
                                            className="m-0 cursor-pointer"
                                            onClick={() => setShowAllUnused(true)}
                                        >
                                            +{hiddenUnusedCount} unused
                                        </Tag>
                                    </Tooltip>
                                )}

                                {/* Collapse button when expanded */}
                                {showAllUnused && sortedSuppliedColumns.unused.length > 1 && (
                                    <Tag
                                        className={cn("m-0 cursor-pointer", textColors.secondary)}
                                        onClick={() => setShowAllUnused(false)}
                                    >
                                        <X size={10} className="mr-0.5" />
                                        hide
                                    </Tag>
                                )}

                                {/* No data message */}
                                {!hasSuppliedInputs && extraColumns.length === 0 && (
                                    <Text type="secondary" className="text-xs">
                                        No data
                                    </Text>
                                )}

                                {/* Add extra column button */}
                                {!isDownstream && onAddExtraColumn && (
                                    <>
                                        {isAddingColumn ? (
                                            <Space.Compact size="small">
                                                <Input
                                                    size="small"
                                                    placeholder="Column name..."
                                                    value={newColumnName}
                                                    onChange={(e) =>
                                                        setNewColumnName(e.target.value)
                                                    }
                                                    onPressEnter={handleAddColumn}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Escape") {
                                                            setIsAddingColumn(false)
                                                            setNewColumnName("")
                                                        }
                                                    }}
                                                    autoFocus
                                                    className="!w-28"
                                                />
                                                <Button
                                                    size="small"
                                                    type="primary"
                                                    icon={<Plus size={12} />}
                                                    onClick={handleAddColumn}
                                                    disabled={!newColumnName.trim()}
                                                />
                                                <Button
                                                    size="small"
                                                    icon={<X size={12} />}
                                                    onClick={() => {
                                                        setIsAddingColumn(false)
                                                        setNewColumnName("")
                                                    }}
                                                />
                                            </Space.Compact>
                                        ) : (
                                            <Tooltip title="Add extra data column (e.g., ground_truth)">
                                                <Tag
                                                    className="m-0 cursor-pointer border-dashed"
                                                    onClick={() => setIsAddingColumn(true)}
                                                >
                                                    <Plus size={10} className="mr-1" />
                                                    Add
                                                </Tag>
                                            </Tooltip>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Output Mappings Section (primary node only, when execution results exist) */}
                {showOutputMappings && loadableId && (
                    <OutputMappingSection
                        loadableId={loadableId}
                        columnOptions={[
                            // Include supplied columns from testcase data
                            ...suppliedColumns.map((c) => ({value: c.key, label: c.name})),
                            // Include extra columns that aren't in supplied yet
                            ...extraColumns
                                .filter((ec) => !suppliedColumns.some((sc) => sc.key === ec.key))
                                .map((c) => ({value: c.key, label: c.name})),
                        ]}
                        onAddColumn={onAddOutputMappingColumn ?? onAddExtraColumn}
                    />
                )}

                {/* Children (DataSourceSection or DownstreamMappingsSection) */}
                {children}
            </div>
        </div>
    )
}
