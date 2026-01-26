/**
 * LoadableRowCard Component
 *
 * Displays a single row from a loadable entity (testset) with its
 * field values and execution controls.
 *
 * Features:
 * - Renders input fields based on column definitions
 * - Shows execution status and results
 * - Supports both local (editable) and connected (read-only) modes
 */

import {useCallback} from "react"

import type {TestsetRow, TestsetColumn} from "@agenta/entities/runnable"
import {CaretRight, Check, Trash, Warning, X} from "@phosphor-icons/react"
import {Button, Card, Input, InputNumber, Switch, Space, Tag, Typography} from "antd"

const {Text} = Typography
const {TextArea} = Input

export interface LoadableRowCardProps {
    row: TestsetRow
    columns: TestsetColumn[]
    /** 1-based index for display */
    index: number
    isActive: boolean
    isEditable: boolean
    isExecuting?: boolean
    executionStatus?: "idle" | "pending" | "running" | "success" | "error" | "cancelled"
    executionOutput?: unknown
    executionError?: {message: string; code?: string}
    onSelect: () => void
    onUpdate: (data: Record<string, unknown>) => void
    onRemove: () => void
    onExecute: () => void
}

/**
 * Determine if a field should use a larger text area
 */
function shouldUseTextArea(key: string, column?: TestsetColumn): boolean {
    // Check column hints
    if (column?.multiline) {
        return true
    }
    // Check common field names
    const largeTextFields = [
        "prediction",
        "ground_truth",
        "context",
        "prompt",
        "response",
        "output",
        "input",
        "content",
    ]
    return largeTextFields.includes(key.toLowerCase())
}

/**
 * Render an input field based on column type
 */
function FieldInput({
    column,
    value,
    onChange,
    disabled,
}: {
    column: TestsetColumn
    value: unknown
    onChange: (value: unknown) => void
    disabled: boolean
}) {
    const {key, name, type} = column
    const useTextArea = shouldUseTextArea(key, column)

    // Boolean type
    if (type === "boolean") {
        return (
            <div className="flex items-center justify-between">
                <Text type="secondary">{name}</Text>
                <Switch
                    checked={value === true}
                    onChange={(checked) => onChange(checked)}
                    disabled={disabled}
                    size="small"
                />
            </div>
        )
    }

    // Number type
    if (type === "number" || type === "integer") {
        return (
            <div>
                <Text type="secondary" className="block mb-1 text-xs">
                    {name}
                </Text>
                <InputNumber
                    value={typeof value === "number" ? value : undefined}
                    onChange={(v) => onChange(v)}
                    placeholder={`Enter ${name.toLowerCase()}...`}
                    className="w-full"
                    disabled={disabled}
                    size="small"
                />
            </div>
        )
    }

    // Large text fields
    if (useTextArea) {
        return (
            <div>
                <Text type="secondary" className="block mb-1 text-xs">
                    {name}
                </Text>
                <TextArea
                    value={typeof value === "string" ? value : ""}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={`Enter ${name.toLowerCase()}...`}
                    autoSize={{minRows: 2, maxRows: 6}}
                    disabled={disabled}
                    className="text-sm"
                />
            </div>
        )
    }

    // Default: string input
    return (
        <div>
            <Text type="secondary" className="block mb-1 text-xs">
                {name}
            </Text>
            <Input
                value={typeof value === "string" ? value : ""}
                onChange={(e) => onChange(e.target.value)}
                placeholder={`Enter ${name.toLowerCase()}...`}
                disabled={disabled}
                size="small"
            />
        </div>
    )
}

/**
 * Get the status icon for execution result
 */
function ExecutionStatusIcon({status}: {status?: LoadableRowCardProps["executionStatus"]}) {
    switch (status) {
        case "success":
            return <Check size={14} weight="bold" className="text-green-600" />
        case "error":
            return <X size={14} weight="bold" className="text-red-600" />
        case "running":
        case "pending":
            return (
                <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            )
        case "cancelled":
            return <Warning size={14} className="text-yellow-600" />
        default:
            return null
    }
}

export function LoadableRowCard({
    row,
    columns,
    index,
    isActive,
    isEditable,
    isExecuting,
    executionStatus,
    executionOutput,
    executionError,
    onSelect,
    onUpdate,
    onRemove,
    onExecute,
}: LoadableRowCardProps) {
    const handleFieldChange = useCallback(
        (key: string, value: unknown) => {
            onUpdate({...row.data, [key]: value})
        },
        [row.data, onUpdate],
    )

    // Check if all required fields have values
    const requiredColumns = columns.filter((c) => c.required)
    const hasAllRequired = requiredColumns.every((col) => {
        const value = row.data[col.key]
        return value !== undefined && value !== null && value !== ""
    })

    const getCardStyle = () => {
        if (isActive) {
            return {borderColor: "#1890ff", backgroundColor: "#e6f7ff"}
        }
        if (executionStatus === "success") {
            return {borderColor: "#b7eb8f", backgroundColor: "#f6ffed"}
        }
        if (executionStatus === "error") {
            return {borderColor: "#ffa39e", backgroundColor: "#fff1f0"}
        }
        return {}
    }

    return (
        <Card
            size="small"
            style={getCardStyle()}
            styles={{body: {padding: 12}}}
            className={`cursor-pointer transition-all ${isActive ? "shadow-sm" : "hover:shadow-sm"}`}
            onClick={onSelect}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <Space size="small">
                    <Text strong className="text-sm">
                        {row.label || `Testcase ${index}`}
                    </Text>
                    {!hasAllRequired && (
                        <Tag color="warning" className="text-xs">
                            Missing inputs
                        </Tag>
                    )}
                    <ExecutionStatusIcon status={executionStatus} />
                </Space>

                <Space size="small">
                    <Button
                        type="primary"
                        size="small"
                        icon={<CaretRight size={12} />}
                        onClick={(e) => {
                            e.stopPropagation()
                            onExecute()
                        }}
                        disabled={!hasAllRequired || isExecuting}
                        loading={isExecuting}
                    >
                        Run
                    </Button>
                    {isEditable && (
                        <Button
                            type="text"
                            size="small"
                            danger
                            icon={<Trash size={14} />}
                            onClick={(e) => {
                                e.stopPropagation()
                                onRemove()
                            }}
                            title="Remove row"
                        />
                    )}
                </Space>
            </div>

            {/* Input Fields */}
            {columns.length > 0 ? (
                <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                    {columns.map((column) => (
                        <FieldInput
                            key={column.key}
                            column={column}
                            value={row.data[column.key]}
                            onChange={(value) => handleFieldChange(column.key, value)}
                            disabled={!isEditable}
                        />
                    ))}
                </div>
            ) : (
                <Text type="secondary" italic className="text-sm">
                    No columns defined
                </Text>
            )}

            {/* Execution Result Preview */}
            {executionOutput !== undefined && (
                <div className="mt-3 pt-3 border-t">
                    <Text type="secondary" className="block mb-1 text-xs">
                        Output:
                    </Text>
                    <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-32">
                        {typeof executionOutput === "string"
                            ? executionOutput
                            : JSON.stringify(executionOutput, null, 2)}
                    </pre>
                </div>
            )}

            {/* Error Display */}
            {executionError && (
                <div className="mt-3 pt-3 border-t">
                    <Text type="danger" className="block text-xs">
                        Error: {executionError.message}
                    </Text>
                </div>
            )}
        </Card>
    )
}
