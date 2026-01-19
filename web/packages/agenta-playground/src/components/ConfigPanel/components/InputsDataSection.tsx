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
import {Database, Plus, X} from "@phosphor-icons/react"
import {Button, Input, Space, Tag, Tooltip, Typography} from "antd"

import type {EntitySelection} from "../../EntitySelector"

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
    /** Callback to add a new extra column */
    onAddExtraColumn?: (name: string) => void
    /** Callback to remove an extra column */
    onRemoveExtraColumn?: (key: string) => void
    /** Children to render inside the section (DataSourceSection or DownstreamMappingsSection) */
    children?: ReactNode
}

export function InputsDataSection({
    entity,
    columns,
    suppliedColumns = [],
    isDownstream = false,
    extraColumns = [],
    onAddExtraColumn,
    onRemoveExtraColumn,
    children,
}: InputsDataSectionProps) {
    const type = entity.type as RunnableType
    const runnable = useRunnable(type, entity.id)

    // State for adding new extra column
    const [newColumnName, setNewColumnName] = useState("")
    const [isAddingColumn, setIsAddingColumn] = useState(false)

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
    const suppliedKeySet = useMemo(() => new Set(suppliedColumns.map((c) => c.key)), [suppliedColumns])
    const expectedKeySet = useMemo(() => new Set(effectiveColumns.map((c) => c.key)), [effectiveColumns])
    const coveredCount = useMemo(
        () => effectiveColumns.filter((c) => suppliedKeySet.has(c.key)).length,
        [effectiveColumns, suppliedKeySet],
    )

    return (
        <div className="px-4 pb-4">
            <div className="border border-gray-200 rounded-lg bg-gray-50 overflow-hidden">
                {/* Section Header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white">
                    <div className="flex items-center gap-2">
                        <Database size={14} className="text-gray-500" />
                        <Text strong className="text-sm">
                            Inputs & Data
                        </Text>
                    </div>
                </div>

                {/* Expected / Provided Inputs - Row Layout */}
                <div className="px-3 py-2 border-b border-gray-100">
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
                                        className={`text-xs ${
                                            coveredCount === effectiveColumns.length
                                                ? "text-green-500"
                                                : "text-orange-400"
                                        }`}
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
                                {/* Supplied columns from testcase data */}
                                {suppliedColumns.map((col) => {
                                    const isExpected = expectedKeySet.has(col.key)
                                    const isExtra = extraColumns.some((ec) => ec.key === col.key)
                                    return (
                                        <Tag
                                            key={col.key}
                                            color={
                                                isExtra ? "purple" : isExpected ? "green" : "default"
                                            }
                                            className="m-0"
                                            closable={isExtra && !!onRemoveExtraColumn}
                                            onClose={(e) => {
                                                e.preventDefault()
                                                onRemoveExtraColumn?.(col.key)
                                            }}
                                        >
                                            {col.name}
                                            {isExtra && (
                                                <span className="text-purple-400 ml-1 text-[10px]">
                                                    (extra)
                                                </span>
                                            )}
                                            {!isExpected && !isExtra && (
                                                <span className="text-gray-400 ml-1">(unused)</span>
                                            )}
                                        </Tag>
                                    )
                                })}
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
                                                    onChange={(e) => setNewColumnName(e.target.value)}
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

                {/* Children (DataSourceSection or DownstreamMappingsSection) */}
                {children}
            </div>
        </div>
    )
}
