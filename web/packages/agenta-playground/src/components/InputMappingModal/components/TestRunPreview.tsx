/**
 * TestRunPreview Component
 *
 * Collapsible preview of test run results for path discovery.
 * Shows both input and output data in a structured format.
 */

import type {ReactNode} from "react"
import {useState} from "react"

import {CaretDown, CaretRight, CaretUp, Play, Spinner, Warning} from "@phosphor-icons/react"
import {Tag, Tooltip, Typography} from "antd"

const {Text} = Typography

export interface TestRunPreviewProps {
    isExpanded: boolean
    onToggle: () => void
    isRunning: boolean
    status: "success" | "error" | "pending" | "cancelled" | null
    output: unknown
    error: {message: string; details?: unknown} | null
    /** Input data used for the test run */
    inputData?: Record<string, unknown>
}

/**
 * Renders a single data entry with label and value
 */
function DataEntry({label, value, indent = 0}: {label: string; value: unknown; indent?: number}) {
    const stringValue = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)
    const isComplex = typeof value === "object" && value !== null
    const displayValue = isComplex ? JSON.stringify(value) : String(value ?? "")
    const isTruncated = displayValue.length > 100

    return (
        <div className="flex items-start gap-2 py-1" style={{paddingLeft: indent * 12}}>
            <Text className="text-xs font-medium text-gray-500 shrink-0 min-w-[80px]">
                {label}:
            </Text>
            <Tooltip title={isTruncated ? stringValue : undefined} placement="topLeft">
                <Text
                    className={`text-xs font-mono ${isComplex ? "text-purple-600" : "text-gray-700"}`}
                >
                    {isTruncated ? displayValue.slice(0, 100) + "..." : displayValue}
                </Text>
            </Tooltip>
        </div>
    )
}

/**
 * Renders a collapsible section with data entries
 */
function DataSection({
    title,
    icon,
    data,
    defaultExpanded = true,
}: {
    title: string
    icon: ReactNode
    data: Record<string, unknown>
    defaultExpanded?: boolean
}) {
    const [isOpen, setIsOpen] = useState(defaultExpanded)
    const entries = Object.entries(data)

    if (entries.length === 0) {
        return null
    }

    return (
        <div className="border border-gray-100 rounded-md overflow-hidden mb-2 last:mb-0">
            <div
                className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 cursor-pointer hover:bg-gray-100"
                onClick={() => setIsOpen(!isOpen)}
            >
                {isOpen ? (
                    <CaretDown size={12} className="text-gray-400" />
                ) : (
                    <CaretRight size={12} className="text-gray-400" />
                )}
                {icon}
                <Text className="text-xs font-medium">{title}</Text>
                <Tag className="m-0 ml-auto text-[10px]" color="default">
                    {entries.length} {entries.length === 1 ? "field" : "fields"}
                </Tag>
            </div>
            {isOpen && (
                <div className="px-3 py-2 bg-white">
                    {entries.map(([key, val]) => (
                        <DataEntry key={key} label={key} value={val} />
                    ))}
                </div>
            )}
        </div>
    )
}

/**
 * Collapsible preview of test run results showing inputs and outputs
 */
export function TestRunPreview({
    isExpanded,
    onToggle,
    isRunning,
    status,
    output,
    error,
    inputData,
}: TestRunPreviewProps) {
    const hasResult = status !== null && !isRunning
    const isError = status === "error"

    // Prepare output data as an object for display
    const outputData: Record<string, unknown> =
        output && typeof output === "object" && !Array.isArray(output)
            ? (output as Record<string, unknown>)
            : output !== null && output !== undefined
              ? {result: output}
              : {}

    return (
        <div className="mb-4 border border-gray-200 rounded-lg overflow-hidden">
            {/* Header */}
            <div
                className={`flex items-center justify-between px-3 py-2 cursor-pointer ${
                    isError ? "bg-red-50" : "bg-green-50"
                }`}
                onClick={onToggle}
            >
                <div className="flex items-center gap-2">
                    {isRunning ? (
                        <Spinner size={14} className="animate-spin text-green-600" />
                    ) : isError ? (
                        <Warning size={14} className="text-red-600" />
                    ) : (
                        <Play size={14} className="text-green-600" />
                    )}
                    <Text strong className={isError ? "text-red-700" : "text-green-700"}>
                        {isRunning ? "Running test..." : isError ? "Test Failed" : "Test Result"}
                    </Text>
                    {hasResult && (
                        <Tag color={isError ? "red" : "green"} className="m-0">
                            {isError ? "Error" : "Success"}
                        </Tag>
                    )}
                </div>
                {isExpanded ? (
                    <CaretUp size={14} className={isError ? "text-red-600" : "text-green-600"} />
                ) : (
                    <CaretDown size={14} className={isError ? "text-red-600" : "text-green-600"} />
                )}
            </div>

            {/* Expanded Content */}
            {isExpanded && hasResult && (
                <div className="p-3 bg-gray-50/50 max-h-64 overflow-auto">
                    {isError ? (
                        // Error display
                        <div className="bg-red-50 border border-red-200 rounded-md p-3">
                            <Text className="text-sm font-medium text-red-700">
                                {error?.message || "Unknown error"}
                            </Text>
                            {error?.details && (
                                <pre className="mt-2 text-xs font-mono text-red-600 whitespace-pre-wrap">
                                    {JSON.stringify(error.details, null, 2)}
                                </pre>
                            )}
                        </div>
                    ) : (
                        // Success: Show structured input/output
                        <>
                            {inputData && Object.keys(inputData).length > 0 && (
                                <DataSection
                                    title="Inputs"
                                    icon={
                                        <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                                    }
                                    data={inputData}
                                />
                            )}
                            {Object.keys(outputData).length > 0 && (
                                <DataSection
                                    title="Output"
                                    icon={
                                        <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                                    }
                                    data={outputData}
                                />
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
