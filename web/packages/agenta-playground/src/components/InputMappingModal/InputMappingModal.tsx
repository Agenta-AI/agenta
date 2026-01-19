/**
 * InputMappingModal Component
 *
 * Modal for configuring input mappings between a source runnable's output
 * and a target runnable's inputs. Supports auto-mapping and manual override.
 *
 * Features:
 * - Shows source output paths (from trace/result)
 * - Shows target input ports with required/optional status
 * - Select dropdown to map each input to a source path
 * - "Auto-Map" button to regenerate mappings
 * - Visual indicators: Auto (blue), Manual (green), Missing (red)
 * - Test run capability for path discovery
 */

import {useCallback, useEffect, useState} from "react"

import type {RunnableInputPort} from "@agenta/entities/runnable"
import {useRunnable} from "@agenta/entities/runnable"
import {keyToString} from "@agenta/shared"
import {ArrowRight, Lightning, MagicWand, Play, Spinner} from "@phosphor-icons/react"
import {Button, Modal, Space, Typography} from "antd"

import {MappingLegend, ObjectMappingRow, ScalarMappingRow, TestRunPreview} from "./components"
import {useMappingState} from "./hooks"
import type {EntityInfo, InputMappingModalWrapperProps, PathInfo} from "./types"
import {extractPathsFromValue, getMappingStatus} from "./utils"

const {Text} = Typography

// ============================================================================
// MAPPING TABLE COMPONENT
// ============================================================================

interface MappingTableProps {
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
function resolvePreviewValue(
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
 * Table showing all input mappings
 */
function MappingTable({
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

    const outputCount = availablePaths.filter((p) => p.source === "output").length
    const testcaseCount = availablePaths.filter((p) => p.source === "testcase").length

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

// ============================================================================
// INNER MODAL COMPONENT (with entity hooks)
// ============================================================================

interface InputMappingModalInnerProps extends Omit<
    InputMappingModalWrapperProps,
    "sourceEntity" | "targetEntity"
> {
    sourceEntity: EntityInfo
    targetEntity: EntityInfo
}

/**
 * Inner modal component that uses useRunnable hook for entity access
 */
function InputMappingModalInner({
    open,
    onClose,
    connection,
    sourceEntity,
    targetEntity,
    onSave,
    testcaseColumns = [],
    testcaseData,
}: InputMappingModalInnerProps) {
    // Use hooks for runnable state and actions
    const sourceRunnable = useRunnable(sourceEntity.type, sourceEntity.id)
    const targetRunnable = useRunnable(targetEntity.type, targetEntity.id)

    // Debug logging for canExecute
    if (process.env.NODE_ENV === "development") {
        console.log("[InputMappingModal] sourceRunnable state:", {
            type: sourceEntity.type,
            id: sourceEntity.id,
            canExecute: sourceRunnable.canExecute,
            isPending: sourceRunnable.isPending,
            isError: sourceRunnable.isError,
            hasData: !!sourceRunnable.config,
            inputsSatisfied: sourceRunnable.inputsSatisfied,
            inputs: sourceRunnable.inputs.map((i) => ({
                key: i.key,
                required: i.required,
                hasValue: i.value !== undefined && i.value !== null,
            })),
        })
    }

    // Local UI state
    const [isTestExpanded, setIsTestExpanded] = useState(false)
    const [discoveredPaths, setDiscoveredPaths] = useState<PathInfo[]>([])
    const [testRunState, setTestRunState] = useState<{
        isRunning: boolean
        status: "success" | "error" | "pending" | "cancelled" | null
        output: unknown
        error: {message: string; details?: unknown} | null
        inputData: Record<string, unknown> | null
    }>({isRunning: false, status: null, output: null, error: null, inputData: null})

    // Get source output and target inputs
    const sourceOutput = sourceRunnable.outputs[0] ?? null
    const targetInputs = targetRunnable.inputs

    // Initialize mapping state with hook
    const mappingState = useMappingState({
        sourceOutput,
        targetInputs,
        testcaseColumns,
        discoveredPaths,
        initialMappings: connection?.inputMappings ?? [],
    })

    // Reset mappings when connection changes
    useEffect(() => {
        if (connection) {
            mappingState.reset(connection.inputMappings)
        }
    }, [connection])

    // Handle test run
    const handleTestRun = useCallback(async () => {
        setIsTestExpanded(true)
        setTestRunState((prev) => ({...prev, isRunning: true, status: "pending", inputData: null}))

        try {
            // Use testcase data if available, otherwise use sample data
            let inputs: Record<string, unknown>
            if (testcaseData && Object.keys(testcaseData).length > 0) {
                inputs = {...testcaseData}
            } else {
                inputs = {}
                sourceRunnable.inputs.forEach((input) => {
                    inputs[input.key] = input.value ?? `[Sample ${input.name}]`
                })
            }

            console.log("[InputMappingModal] Running test with inputs:", inputs)
            const result = await sourceRunnable.execute(inputs)

            if (result?.status === "success") {
                const output = result.structuredOutput || result.output
                if (output && typeof output === "object") {
                    const paths = extractPathsFromValue(output, "output")
                    setDiscoveredPaths(paths)
                    console.log("[InputMappingModal] Discovered paths:", paths)
                }
                setTestRunState({
                    isRunning: false,
                    status: "success",
                    output: result.output,
                    error: null,
                    inputData: inputs,
                })
            } else {
                setTestRunState({
                    isRunning: false,
                    status: "error",
                    output: null,
                    error: result?.error ?? {message: "Unknown error"},
                    inputData: inputs,
                })
            }
        } catch (error) {
            setTestRunState({
                isRunning: false,
                status: "error",
                output: null,
                error: {message: error instanceof Error ? error.message : "Unknown error"},
                inputData: null,
            })
        }
    }, [sourceRunnable, testcaseData])

    // Handle save
    const handleSave = useCallback(() => {
        if (connection) {
            onSave(connection.id, mappingState.localMappings)
            onClose()
        }
    }, [connection, mappingState.localMappings, onSave, onClose])

    // For Test Run, we can execute if:
    // 1. Source runnable is ready (loaded without error, has config)
    // 2. AND either: inputs are satisfied OR we have testcase data to use as inputs
    const hasTestcaseData = testcaseData && Object.keys(testcaseData).length > 0
    const canTestRun = sourceRunnable.isReady && (sourceRunnable.inputsSatisfied || hasTestcaseData)

    if (process.env.NODE_ENV === "development") {
        console.log("[InputMappingModal] canTestRun:", {
            canTestRun,
            isReady: sourceRunnable.isReady,
            hasTestcaseData,
            inputsSatisfied: sourceRunnable.inputsSatisfied,
        })
    }

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title="Configure Input Mappings"
            width={720}
            footer={
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <Button icon={<MagicWand size={14} />} onClick={mappingState.handleAutoMap}>
                            Auto-Map
                        </Button>
                        <Button
                            icon={
                                testRunState.isRunning ? (
                                    <Spinner size={14} className="animate-spin" />
                                ) : (
                                    <Play size={14} />
                                )
                            }
                            onClick={handleTestRun}
                            disabled={testRunState.isRunning || !canTestRun}
                        >
                            Test Run
                        </Button>
                    </div>
                    <Space>
                        <Button onClick={onClose}>Cancel</Button>
                        <Button
                            type="primary"
                            onClick={handleSave}
                            disabled={!mappingState.isDirty}
                        >
                            Save Mappings
                        </Button>
                    </Space>
                </div>
            }
        >
            {/* Test Run Preview */}
            {(testRunState.status !== null || testRunState.isRunning) && (
                <TestRunPreview
                    isExpanded={isTestExpanded}
                    onToggle={() => setIsTestExpanded(!isTestExpanded)}
                    isRunning={testRunState.isRunning}
                    status={testRunState.status}
                    output={testRunState.output}
                    error={testRunState.error}
                    inputData={testRunState.inputData ?? undefined}
                />
            )}

            {/* Mapping Table */}
            <MappingTable
                targetInputs={targetInputs}
                mappingState={mappingState}
                sourceLabel={sourceEntity.label}
                targetLabel={targetEntity.label}
                testcaseData={testcaseData}
                testRunOutput={testRunState.output}
            />
        </Modal>
    )
}

// ============================================================================
// WRAPPER COMPONENT
// ============================================================================

/**
 * Wrapper component that handles missing entities
 */
export function InputMappingModalWrapper({
    open,
    onClose,
    connection,
    sourceEntity,
    targetEntity,
    onSave,
    testcaseColumns,
    testcaseData,
}: InputMappingModalWrapperProps) {
    // Don't render inner component if entities are missing
    if (!sourceEntity || !targetEntity) {
        return (
            <Modal open={open} onCancel={onClose} footer={null} title="Configure Input Mappings">
                <div className="py-8 text-center">
                    <Text type="secondary">
                        {!sourceEntity
                            ? "Source entity not available"
                            : "Target entity not available"}
                    </Text>
                </div>
            </Modal>
        )
    }

    return (
        <InputMappingModalInner
            open={open}
            onClose={onClose}
            connection={connection}
            sourceEntity={sourceEntity}
            targetEntity={targetEntity}
            onSave={onSave}
            testcaseColumns={testcaseColumns}
            testcaseData={testcaseData}
        />
    )
}
