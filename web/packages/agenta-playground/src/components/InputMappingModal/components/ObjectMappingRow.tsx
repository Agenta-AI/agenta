/**
 * ObjectMappingRow Component
 *
 * Row for mapping an object-type input with multiple key mappings.
 */

import type {InputMapping, PathInfo, RunnableInputPort} from "@agenta/entities/runnable"
import {keyToString} from "@agenta/shared"
import {EditableText} from "@agenta/ui"
import {ArrowRight, Lightning, Table, Trash} from "@phosphor-icons/react"
import {Button, Tag, Tooltip, Typography} from "antd"

import type {MappingStatusInfo} from "../types"

import {PathSelector} from "./PathSelector"

const {Text} = Typography

export interface ObjectMappingRowProps {
    input: RunnableInputPort
    objectMappings: InputMapping[]
    status: MappingStatusInfo
    availablePaths: PathInfo[]
    onPathChange: (targetKey: string, keyInObject: string, pathString: string) => void
    onRemoveKey: (targetKey: string, keyInObject: string) => void
    onRenameKey: (targetKey: string, oldKeyInObject: string, newKeyInObject: string) => void
    onAddAllTestcase: (targetKey: string) => void
    onAddPrediction: (targetKey: string) => void
    /** Preview values for each object key mapping */
    previewValues?: Record<string, unknown>
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
 * Row for object input mapping with key sub-mappings
 */
export function ObjectMappingRow({
    input,
    objectMappings,
    status,
    availablePaths,
    onPathChange,
    onRemoveKey,
    onRenameKey,
    onAddAllTestcase,
    onAddPrediction,
    previewValues = {},
}: ObjectMappingRowProps) {
    return (
        <div className="bg-gray-50/50">
            {/* Object Input Header */}
            <div className="grid grid-cols-12 gap-2 px-3 py-2 items-center border-b border-gray-100">
                {/* Add buttons */}
                <div className="col-span-4">
                    <div className="flex items-center gap-2">
                        <Tooltip title="Add all testcase columns">
                            <Button
                                size="small"
                                icon={<Table size={12} />}
                                onClick={() => onAddAllTestcase(input.key)}
                            >
                                + Testcase
                            </Button>
                        </Tooltip>
                        <Tooltip title="Add prediction (app output)">
                            <Button
                                size="small"
                                icon={<Lightning size={12} />}
                                onClick={() => onAddPrediction(input.key)}
                            >
                                + Output
                            </Button>
                        </Tooltip>
                    </div>
                </div>

                {/* Empty preview column */}
                <div className="col-span-2" />

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
                        <Tag color="purple" className="m-0 text-xs flex-shrink-0">
                            dict
                        </Tag>
                    </div>
                    <Text type="secondary" className="text-xs">
                        {objectMappings.length} key{objectMappings.length !== 1 ? "s" : ""} mapped
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

            {/* Object Key Mappings */}
            {objectMappings.map((objMapping) => {
                const keyName = keyToString(objMapping.keyInObject)
                if (!keyName) return null // Skip mappings without keyInObject

                const previewValue = previewValues[keyName]
                const hasPreview = previewValue !== undefined
                const displayValue = formatPreviewValue(previewValue)
                const isTruncated = displayValue.length > 16

                return (
                    <div key={`${input.key}-${keyName}`} className="hover:bg-gray-100/50 ml-4">
                        <div className="grid grid-cols-12 gap-2 px-3 py-1.5 items-center">
                            {/* Source Path */}
                            <div className="col-span-4">
                                <PathSelector
                                    value={objMapping.sourcePath || undefined}
                                    onChange={(value) => onPathChange(input.key, keyName, value)}
                                    availablePaths={availablePaths}
                                />
                            </div>

                            {/* Preview Value (compact) */}
                            <div className="col-span-2 min-w-0">
                                {hasPreview && (
                                    <Tooltip title={displayValue} placement="top">
                                        <Text className="text-[11px] font-mono text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded truncate block">
                                            {isTruncated
                                                ? displayValue.slice(0, 16) + "…"
                                                : displayValue}
                                        </Text>
                                    </Tooltip>
                                )}
                            </div>

                            {/* Arrow */}
                            <div className="col-span-1 flex justify-center">
                                <ArrowRight size={12} className="text-gray-300" />
                            </div>

                            {/* Target Key */}
                            <div className="col-span-3 flex items-center gap-1 min-w-0">
                                <Text type="secondary" className="text-xs flex-shrink-0">
                                    .
                                </Text>
                                <EditableText
                                    value={keyName}
                                    onChange={(newKey) => onRenameKey(input.key, keyName, newKey)}
                                    tooltip="Click to rename"
                                />
                            </div>

                            {/* Delete */}
                            <div className="col-span-2 flex justify-end">
                                <Button
                                    type="text"
                                    size="small"
                                    danger
                                    icon={<Trash size={12} />}
                                    onClick={() => onRemoveKey(input.key, keyName)}
                                />
                            </div>
                        </div>
                    </div>
                )
            })}

            {objectMappings.length === 0 && (
                <div className="px-3 py-2 ml-4 text-center">
                    <Text type="secondary" className="text-xs">
                        Click buttons above to add key mappings
                    </Text>
                </div>
            )}
        </div>
    )
}
