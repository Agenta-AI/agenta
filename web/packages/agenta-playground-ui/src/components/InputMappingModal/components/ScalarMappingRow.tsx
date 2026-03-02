/**
 * ScalarMappingRow Component
 *
 * Row for mapping a scalar input (string, number, boolean, etc.)
 */

import type {InputMapping, PathInfo, RunnableInputPort} from "@agenta/entities/runnable"
import {ArrowRight} from "@phosphor-icons/react"
import {Tag, Tooltip, Typography} from "antd"

import type {MappingStatusInfo} from "../types"

import {PathSelector} from "./PathSelector"

const {Text} = Typography

export interface ScalarMappingRowProps {
    input: RunnableInputPort
    mapping: InputMapping | undefined
    status: MappingStatusInfo
    availablePaths: PathInfo[]
    onPathChange: (targetKey: string, pathString: string) => void
    /** Preview value resolved from the source path */
    previewValue?: unknown
}

/**
 * Formats a preview value for display
 */
function formatPreviewValue(value: unknown): string {
    if (value === undefined) return ""
    if (value === null) return "null"
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value)
}

/**
 * Row for scalar input mapping
 */
export function ScalarMappingRow({
    input,
    mapping,
    status,
    availablePaths,
    onPathChange,
    previewValue,
}: ScalarMappingRowProps) {
    const currentPath = mapping?.sourcePath || ""
    const hasPreview = previewValue !== undefined && currentPath
    const displayValue = formatPreviewValue(previewValue)
    const isTruncated = displayValue.length > 20

    return (
        <div className="hover:bg-gray-50">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 items-center">
                {/* Source Path Selector */}
                <div className="col-span-4">
                    <PathSelector
                        value={currentPath || undefined}
                        onChange={(value) => onPathChange(input.key, value)}
                        availablePaths={availablePaths}
                        allowClear
                    />
                </div>

                {/* Preview Value (compact) */}
                <div className="col-span-2 min-w-0">
                    {hasPreview && (
                        <Tooltip title={displayValue} placement="top">
                            <Text className="text-[11px] font-mono text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded truncate block">
                                {isTruncated ? displayValue.slice(0, 20) + "…" : displayValue}
                            </Text>
                        </Tooltip>
                    )}
                </div>

                {/* Arrow */}
                <div className="col-span-1 flex justify-center">
                    <ArrowRight size={14} className="text-gray-300" />
                </div>

                {/* Target Input */}
                <div className="col-span-3 min-w-0">
                    <div className="flex items-center gap-1">
                        <Text strong className="text-sm truncate">
                            {input.name || input.key}
                        </Text>
                        {input.required && (
                            <Text type="danger" className="text-xs flex-shrink-0">
                                *
                            </Text>
                        )}
                    </div>
                    <Text type="secondary" className="text-xs">
                        {input.type}
                    </Text>
                </div>

                {/* Status */}
                <div className="col-span-2 flex justify-end">
                    <Tag color={status.color} className="m-0 flex items-center gap-1">
                        {status.icon}
                        {status.label}
                    </Tag>
                </div>
            </div>
        </div>
    )
}
