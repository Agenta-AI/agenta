/**
 * MappingTable Component
 *
 * Displays all input mappings in a table format showing:
 * - Source paths (output or testcase data)
 * - Target input ports with required/optional status
 * - Mapping status indicators
 * - Value previews when available
 */

import type {RunnableInputPort} from "@agenta/entities/runnable"
import {keyToString} from "@agenta/shared/utils"
import {ArrowRight, Lightning} from "@phosphor-icons/react"
import {Typography} from "antd"

import type {useMappingState} from "../hooks"
import type {PathInfo} from "../types"
import {getMappingStatus} from "../utils"

import {MappingLegend} from "./MappingLegend"
import {ObjectMappingRow} from "./ObjectMappingRow"
import {ScalarMappingRow} from "./ScalarMappingRow"

const {Text} = Typography

export interface MappingTableProps {
    targetInputs: RunnableInputPort[]
    mappingState: ReturnType<typeof useMappingState>
    sourceLabel: string
    targetLabel: string
    /** Testcase data for value preview */
    testcaseData?: Record<string, unknown>
    /** Test run output for value preview */
    testRunOutput?: unknown
}

/**
 * Resolves a value from source path using testcase data or test run output
 */
export function resolvePreviewValue(
    sourcePath: string | null,
    testcaseData?: Record<string, unknown>,
    testRunOutput?: unknown,
): unknown {
    if (!sourcePath) return undefined

    // Split path string into parts (e.g., "testcase.input" -> ["testcase", "input"])
    const pathParts = sourcePath.split(".")
    if (pathParts.length === 0) return undefined

    const [source, ...rest] = pathParts

    if (source === "testcase" && testcaseData) {
        // Navigate into testcase data
        let value: unknown = testcaseData
        for (const key of rest) {
            if (value && typeof value === "object" && key in value) {
                value = (value as Record<string, unknown>)[key]
            } else {
                return undefined
            }
        }
        return value
    }

    if ((source === "output" || source === "outputs") && testRunOutput !== undefined) {
        // Navigate into output data
        if (rest.length === 0) {
            return testRunOutput
        }
        let value: unknown = testRunOutput
        for (const key of rest) {
            if (value && typeof value === "object" && key in value) {
                value = (value as Record<string, unknown>)[key]
            } else {
                return undefined
            }
        }
        return value
    }

    return undefined
}

/**
 * Table showing all input mappings with source paths and target inputs
 */
export function MappingTable({
    targetInputs,
    mappingState,
    sourceLabel,
    targetLabel,
    testcaseData,
    testRunOutput,
}: MappingTableProps) {
    const {
        availablePaths,
        getMappingForInput,
        getObjectMappings,
        handlePathChange,
        handleObjectKeyPathChange,
        handleRemoveObjectKey,
        handleRenameObjectKey,
        handleAddAllTestcaseColumns,
        handleAddPredictionMapping,
    } = mappingState

    const outputCount = availablePaths.filter((p: PathInfo) => p.source === "output").length
    const testcaseCount = availablePaths.filter((p: PathInfo) => p.source === "testcase").length

    return (
        <>
            {/* Mappings Table with integrated connection header */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
                {/* Connection Header - Source → Target entities */}
                <div className="grid grid-cols-12 gap-2 px-3 py-3 bg-gray-100 border-b border-gray-200">
                    <div className="col-span-4 flex items-center gap-2">
                        <Lightning size={16} className="text-blue-500" />
                        <Text strong className="truncate">
                            {sourceLabel}
                        </Text>
                    </div>
                    <div className="col-span-2" />
                    <div className="col-span-1 flex justify-center">
                        <ArrowRight size={16} className="text-gray-400" />
                    </div>
                    <div className="col-span-3 flex items-center gap-2">
                        <Lightning size={16} className="text-purple-500" />
                        <Text strong className="truncate">
                            {targetLabel}
                        </Text>
                    </div>
                    <div className="col-span-2" />
                </div>

                {/* Column Headers */}
                <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                    <div className="col-span-4">
                        <Text type="secondary" className="text-xs uppercase tracking-wide">
                            Source
                        </Text>
                    </div>
                    <div className="col-span-2">
                        <Text type="secondary" className="text-xs uppercase tracking-wide">
                            Value
                        </Text>
                    </div>
                    <div className="col-span-1" />
                    <div className="col-span-3">
                        <Text type="secondary" className="text-xs uppercase tracking-wide">
                            Target
                        </Text>
                    </div>
                    <div className="col-span-2 text-right">
                        <Text type="secondary" className="text-xs uppercase tracking-wide">
                            Status
                        </Text>
                    </div>
                </div>

                {/* Mapping Rows */}
                <div className="divide-y divide-gray-100">
                    {targetInputs.map((input) => {
                        const isObjectType = input.type === "object"
                        const objectMappings = getObjectMappings(input.key)
                        const mapping = getMappingForInput(input.key)
                        const status = getMappingStatus(
                            isObjectType && objectMappings.length > 0
                                ? {
                                      targetKey: input.key,
                                      sourcePath: null,
                                      isAutoMapped: false,
                                      status: "valid" as const,
                                  }
                                : mapping,
                            input.required,
                        )

                        if (isObjectType) {
                            // Resolve preview values for each object mapping
                            const objectPreviewValues: Record<string, unknown> = {}
                            objectMappings.forEach((m) => {
                                const keyName = keyToString(m.keyInObject)
                                if (keyName) {
                                    objectPreviewValues[keyName] = resolvePreviewValue(
                                        m.sourcePath,
                                        testcaseData,
                                        testRunOutput,
                                    )
                                }
                            })

                            return (
                                <ObjectMappingRow
                                    key={input.key}
                                    input={input}
                                    objectMappings={objectMappings}
                                    status={status}
                                    availablePaths={availablePaths}
                                    onPathChange={handleObjectKeyPathChange}
                                    onRemoveKey={handleRemoveObjectKey}
                                    onRenameKey={handleRenameObjectKey}
                                    onAddAllTestcase={handleAddAllTestcaseColumns}
                                    onAddPrediction={handleAddPredictionMapping}
                                    previewValues={objectPreviewValues}
                                />
                            )
                        }

                        // Resolve preview value for scalar mapping
                        const previewValue = mapping
                            ? resolvePreviewValue(mapping.sourcePath, testcaseData, testRunOutput)
                            : undefined

                        return (
                            <ScalarMappingRow
                                key={input.key}
                                input={input}
                                mapping={mapping}
                                status={status}
                                availablePaths={availablePaths}
                                onPathChange={handlePathChange}
                                previewValue={previewValue}
                            />
                        )
                    })}

                    {targetInputs.length === 0 && (
                        <div className="px-3 py-4 text-center">
                            <Text type="secondary">No input ports defined</Text>
                        </div>
                    )}
                </div>
            </div>

            <MappingLegend
                sourceLabel={sourceLabel}
                testcaseCount={testcaseCount}
                outputCount={outputCount}
            />
        </>
    )
}
