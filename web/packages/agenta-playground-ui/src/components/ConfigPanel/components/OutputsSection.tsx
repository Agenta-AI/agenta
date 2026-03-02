/**
 * OutputsSection Component
 *
 * Displays the "Outputs" section showing:
 * - Output schema with typed values
 * - Output receivers list (downstream runnables)
 * - Add/Edit/Remove receiver actions
 */

import {useMemo} from "react"

import {runnableBridge, type RunnableType} from "@agenta/entities/runnable"
import {type OutputReceiverInfo} from "@agenta/playground"
import {
    ArrowRight,
    ArrowSquareOut,
    Flask,
    Lightning,
    PencilSimple,
    Plus,
    Trash,
} from "@phosphor-icons/react"
import {Button, Space, Tag, Tooltip, Typography} from "antd"
import {useAtomValue} from "jotai"

import type {EntitySelection} from "../../EntitySelector"

const {Text} = Typography

// Re-export OutputReceiverInfo for backwards compatibility
export type {OutputReceiverInfo}

export interface OutputsSectionProps {
    /** The selected entity */
    entity: EntitySelection
    /** Connected output receivers (downstream runnables) */
    outputReceivers?: OutputReceiverInfo[]
    /** Callback to add a new output receiver */
    onAddOutputReceiver?: () => void
    /** Callback to edit an output receiver's mappings */
    onEditOutputReceiver?: (connectionId: string) => void
    /** Callback to remove an output receiver */
    onRemoveOutputReceiver?: (connectionId: string) => void
    /** Callback to navigate to an output receiver's config */
    onNavigateToReceiver?: (entityId: string) => void
}

export function OutputsSection({
    entity,
    outputReceivers = [],
    onAddOutputReceiver,
    onEditOutputReceiver,
    onRemoveOutputReceiver,
    onNavigateToReceiver,
}: OutputsSectionProps) {
    const _type = entity.type as RunnableType

    // Use bridge selectors
    const outputPortsAtom = useMemo(() => runnableBridge.outputPorts(entity.id), [entity.id])
    const outputPorts = useAtomValue(outputPortsAtom)

    const hasOutputReceivers = outputReceivers.length > 0

    // Helper to get type color
    const getTypeColor = (schemaType: string | undefined) => {
        switch (schemaType) {
            case "string":
                return "text-green-600 bg-green-50 border-green-200"
            case "number":
            case "integer":
                return "text-blue-600 bg-blue-50 border-blue-200"
            case "boolean":
                return "text-orange-600 bg-orange-50 border-orange-200"
            case "object":
                return "text-purple-600 bg-purple-50 border-purple-200"
            case "array":
                return "text-cyan-600 bg-cyan-50 border-cyan-200"
            default:
                return "text-gray-600 bg-gray-50 border-gray-200"
        }
    }

    // Format value for display
    const formatValue = (value: unknown): string => {
        if (value === null || value === undefined) return "—"
        if (typeof value === "string") {
            return value.length > 50 ? `${value.slice(0, 50)}...` : value
        }
        if (typeof value === "boolean") return value ? "true" : "false"
        if (typeof value === "number") return String(value)
        if (Array.isArray(value)) return `[${value.length} items]`
        if (typeof value === "object") return `{${Object.keys(value).length} fields}`
        return String(value)
    }

    // Get result output from outputPorts
    // Note: This component is currently disabled (see ConfigPanel.tsx comments)
    // Output receiver management is handled via DownstreamMappingsSection and RunnableColumnsLayout
    const resultOutput = outputPorts.find((o) => o.key === "output" || o.key === "result")
    const resultSchema = resultOutput?.schema as Record<string, unknown> | undefined
    const schemaProperties = resultSchema?.properties
        ? Object.entries(resultSchema.properties as Record<string, unknown>)
        : []
    const hasTypedSchema = schemaProperties.length > 0

    // Execution state is not available through runnableBridge
    // This would need to come from loadable execution results if re-enabled
    const structuredOutput: Record<string, unknown> | null = null
    const hasOutput = false
    const isExecuting = false
    const executionStatus: "success" | "error" | null = null

    return (
        <div className="px-4 pb-4">
            <div className="border border-gray-200 rounded-lg bg-gray-50 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white">
                    <div className="flex items-center gap-2">
                        <ArrowSquareOut size={14} className="text-gray-500" />
                        <Text strong className="text-sm">
                            Outputs
                        </Text>
                    </div>
                    {/* Only show + button when there are already receivers */}
                    {hasOutputReceivers && onAddOutputReceiver && (
                        <Tooltip title="Add receiver">
                            <Button
                                type="text"
                                size="small"
                                icon={<Plus size={14} />}
                                onClick={onAddOutputReceiver}
                            />
                        </Tooltip>
                    )}
                </div>

                {/* Output Schema & Values */}
                <div className="px-3 py-2 border-b border-gray-100">
                    {hasTypedSchema ? (
                        <div className="space-y-2">
                            {schemaProperties.map(([propKey, propSchema]) => {
                                const value = structuredOutput?.[propKey]
                                const hasValue = value !== undefined
                                const propSchemaObj = propSchema as {type?: string}

                                return (
                                    <div key={propKey} className="flex items-start gap-2">
                                        {/* Field path and type */}
                                        <div className="flex items-center gap-1.5 flex-shrink-0">
                                            <span className="font-mono text-gray-600">
                                                outputs.
                                                <span className="font-medium text-gray-800">
                                                    {propKey}
                                                </span>
                                            </span>
                                            <span
                                                className={`text-xs px-1 py-0.5 rounded font-mono border ${getTypeColor(propSchemaObj.type)}`}
                                            >
                                                {propSchemaObj.type || "any"}
                                            </span>
                                        </div>

                                        {/* Value display */}
                                        <div className="flex-1 min-w-0 text-right">
                                            {isExecuting ? (
                                                <span className="text-gray-400 italic">
                                                    Running...
                                                </span>
                                            ) : hasValue ? (
                                                <span className="text-gray-900 font-mono bg-gray-50 px-2 py-0.5 rounded break-all">
                                                    {formatValue(value)}
                                                </span>
                                            ) : executionStatus === "success" ? (
                                                <span className="text-gray-400 italic">—</span>
                                            ) : (
                                                <span className="text-gray-300">—</span>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        // No typed schema - show default output with raw value if available
                        <div className="flex items-center gap-2">
                            <Tag color="purple" className="m-0">
                                {resultOutput?.name || "Output"}
                            </Tag>
                            {isExecuting && (
                                <span className="text-gray-400 italic">Running...</span>
                            )}
                            {hasOutput && !isExecuting && (
                                <span className="text-gray-600 font-mono truncate max-w-[200px]">
                                    {formatValue(structuredOutput)}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Output Receivers */}
                <div className="px-3 py-2">
                    <Text type="secondary" className="text-xs uppercase tracking-wide block mb-1.5">
                        Receivers
                    </Text>
                    {hasOutputReceivers ? (
                        <div className="space-y-2">
                            {outputReceivers.map((receiver) => {
                                // Skip receivers with missing entity (defensive check)
                                if (!receiver.entity) return null

                                const isComplete = receiver.validMappings >= receiver.requiredInputs
                                const isEvaluator = receiver.entity.type === "evaluatorRevision"

                                return (
                                    <div
                                        key={receiver.connection.id}
                                        className="flex items-center justify-between p-2 bg-white rounded border border-gray-100 hover:border-gray-200 transition-colors"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div
                                                className={`w-6 h-6 rounded flex items-center justify-center ${
                                                    isEvaluator ? "bg-purple-100" : "bg-blue-100"
                                                }`}
                                            >
                                                {isEvaluator ? (
                                                    <Flask
                                                        size={12}
                                                        weight="fill"
                                                        className="text-purple-500"
                                                    />
                                                ) : (
                                                    <Lightning
                                                        size={12}
                                                        weight="fill"
                                                        className="text-blue-500"
                                                    />
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        onNavigateToReceiver?.(receiver.entity.id)
                                                    }
                                                    className="text-sm font-medium text-gray-900 hover:text-blue-600 truncate block text-left bg-transparent border-none cursor-pointer p-0"
                                                >
                                                    {receiver.entity.label}
                                                </button>
                                                <div className="flex items-center gap-1 text-xs text-gray-500">
                                                    <ArrowRight size={10} />
                                                    <span>
                                                        {receiver.validMappings}/
                                                        {receiver.requiredInputs} mapped
                                                    </span>
                                                    {!isComplete && (
                                                        <Tag
                                                            color="orange"
                                                            className="m-0 text-[10px] leading-none py-0"
                                                        >
                                                            incomplete
                                                        </Tag>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <Space size={4}>
                                            <Tooltip title="Edit mappings">
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    icon={<PencilSimple size={12} />}
                                                    onClick={() =>
                                                        onEditOutputReceiver?.(
                                                            receiver.connection.id,
                                                        )
                                                    }
                                                />
                                            </Tooltip>
                                            <Tooltip title="Remove receiver">
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    danger
                                                    icon={<Trash size={12} />}
                                                    onClick={() =>
                                                        onRemoveOutputReceiver?.(
                                                            receiver.connection.id,
                                                        )
                                                    }
                                                />
                                            </Tooltip>
                                        </Space>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="text-center py-3">
                            <Text type="secondary" className="text-xs">
                                No output receivers connected
                            </Text>
                            {onAddOutputReceiver && (
                                <div className="mt-2">
                                    <Button
                                        type="dashed"
                                        size="small"
                                        icon={<Plus size={12} />}
                                        onClick={onAddOutputReceiver}
                                    >
                                        Add Receiver
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
