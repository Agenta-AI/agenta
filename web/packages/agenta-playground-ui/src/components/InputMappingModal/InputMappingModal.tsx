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

import {useCallback, useEffect, useMemo, useState} from "react"

import {
    runnableBridge,
    executeRunnable,
    type RunnableType,
    type RunnableInputPort,
    type RunnableOutputPort,
    type BridgeRunnableData,
} from "@agenta/entities/runnable"
import {MagicWand, Play, Spinner} from "@phosphor-icons/react"
import {Button, Modal, Space, Typography} from "antd"
import {useAtomValue} from "jotai"

import {MappingTable, TestRunPreview} from "./components"
import {useMappingState} from "./hooks"
import type {EntityInfo, InputMappingModalWrapperProps, PathInfo} from "./types"
import {extractPathsFromValue} from "./utils"

const {Text} = Typography

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
 * Inner modal component that uses runnableBridge for entity access
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
    // Use bridge selectors for source runnable
    const sourceQueryAtom = useMemo(() => runnableBridge.query(sourceEntity.id), [sourceEntity.id])
    const sourceInputPortsAtom = useMemo(
        () => runnableBridge.inputPorts(sourceEntity.id),
        [sourceEntity.id],
    )
    const sourceOutputPortsAtom = useMemo(
        () => runnableBridge.outputPorts(sourceEntity.id),
        [sourceEntity.id],
    )
    const sourceConfigAtom = useMemo(
        () => runnableBridge.configuration(sourceEntity.id),
        [sourceEntity.id],
    )
    const sourceInvocationUrlAtom = useMemo(
        () => runnableBridge.invocationUrl(sourceEntity.id),
        [sourceEntity.id],
    )

    const sourceQuery = useAtomValue(sourceQueryAtom)
    const sourceInputPorts = useAtomValue(sourceInputPortsAtom)
    const sourceOutputPorts = useAtomValue(sourceOutputPortsAtom)
    const sourceConfig = useAtomValue(sourceConfigAtom)
    const sourceInvocationUrl = useAtomValue(sourceInvocationUrlAtom)

    // Use bridge selectors for target runnable
    const targetInputPortsAtom = useMemo(
        () => runnableBridge.inputPorts(targetEntity.id),
        [targetEntity.id],
    )
    const targetInputPorts = useAtomValue(targetInputPortsAtom)

    // Derive ready state from query
    const isSourceReady = !sourceQuery.isPending && !sourceQuery.isError && !!sourceConfig

    // Debug logging
    if (process.env.NODE_ENV === "development") {
        console.log("[InputMappingModal] source state:", {
            type: sourceEntity.type,
            id: sourceEntity.id,
            isPending: sourceQuery.isPending,
            isError: sourceQuery.isError,
            hasConfig: !!sourceConfig,
            hasInvocationUrl: !!sourceInvocationUrl,
            inputPorts: sourceInputPorts.map((i) => ({
                key: i.key,
                required: i.required,
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

    // Adapt bridge port types to the types expected by useMappingState
    // Bridge ports have optional `required`, but RunnableInputPort expects required `required`
    const sourceOutput: RunnableOutputPort | null = sourceOutputPorts[0]
        ? {
              ...sourceOutputPorts[0],
              schema: sourceOutputPorts[0].schema as Record<string, unknown> | undefined,
          }
        : null

    const targetInputs: RunnableInputPort[] = targetInputPorts.map((port) => ({
        ...port,
        required: port.required ?? false,
    }))

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
                sourceInputPorts.forEach((input) => {
                    inputs[input.key] = `[Sample ${input.name}]`
                })
            }

            console.log("[InputMappingModal] Running test with inputs:", inputs)

            // Build runnable data for execution
            // Cast to BridgeRunnableData which has the minimal required properties
            const runnableData: BridgeRunnableData = {
                id: sourceEntity.id,
                invocationUrl: sourceInvocationUrl ?? undefined,
                configuration: sourceConfig ?? undefined,
            }

            // executeRunnable only uses invocationUrl and configuration from data
            const result = await executeRunnable(
                sourceEntity.type as RunnableType,
                runnableData as Parameters<typeof executeRunnable>[1],
                {inputs},
            )

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
    }, [sourceEntity, sourceInputPorts, sourceInvocationUrl, sourceConfig, testcaseData])

    // Handle save
    const handleSave = useCallback(() => {
        if (connection) {
            onSave(connection.id, mappingState.localMappings)
            onClose()
        }
    }, [connection, mappingState.localMappings, onSave, onClose])

    // For Test Run, we can execute if:
    // 1. Source runnable is ready (loaded without error, has config and invocation URL)
    // 2. AND either: we have testcase data OR we can generate sample inputs
    const hasTestcaseData = testcaseData && Object.keys(testcaseData).length > 0
    const canTestRun =
        isSourceReady && !!sourceInvocationUrl && (hasTestcaseData || sourceInputPorts.length > 0)

    if (process.env.NODE_ENV === "development") {
        console.log("[InputMappingModal] canTestRun:", {
            canTestRun,
            isSourceReady,
            hasInvocationUrl: !!sourceInvocationUrl,
            hasTestcaseData,
            hasInputPorts: sourceInputPorts.length > 0,
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
