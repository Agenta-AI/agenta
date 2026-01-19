/**
 * InputMappingModal Types
 *
 * Type definitions for the input mapping modal and related components.
 * These types work with the base types from @agenta/entities/runnable.
 */

import type {
    InputMapping,
    OutputConnection,
    PathInfo,
    RunnableInputPort,
    RunnableOutputPort,
    RunnableType,
    TestsetColumn,
} from "@agenta/entities/runnable"

// Re-export the types we use
export type {
    InputMapping,
    OutputConnection,
    PathInfo,
    RunnableInputPort,
    RunnableOutputPort,
    RunnableType,
    TestsetColumn,
}

// ============================================================================
// STATUS INFO
// ============================================================================

/** Status indicator for a mapping */
export interface MappingStatusInfo {
    color: "red" | "orange" | "blue" | "green" | "default"
    label: string
    icon: React.ReactNode
}

// ============================================================================
// COMPONENT PROPS
// ============================================================================

/** Entity info for the wrapper component */
export interface EntityInfo {
    type: RunnableType
    id: string
    label: string
}

/** Props for the main InputMappingModal */
export interface InputMappingModalProps {
    /** Whether the modal is open */
    open: boolean
    /** Handler to close the modal */
    onClose: () => void
    /** The output connection being configured */
    connection: OutputConnection | null
    /** Source output port with available paths */
    sourceOutput: RunnableOutputPort | null
    /** Target input ports */
    targetInputs: RunnableInputPort[]
    /** Handler when mappings are saved */
    onSave: (connectionId: string, mappings: InputMapping[]) => void
    /** Source node label for display */
    sourceLabel?: string
    /** Target node label for display */
    targetLabel?: string
    /** Testcase columns that can also be used as input sources */
    testcaseColumns?: TestsetColumn[]
}

/** Props for the wrapper component */
export interface InputMappingModalWrapperProps {
    /** Whether the modal is open */
    open: boolean
    /** Handler to close the modal */
    onClose: () => void
    /** The output connection being configured */
    connection: OutputConnection | null
    /** Source entity info */
    sourceEntity: EntityInfo | null
    /** Target entity info */
    targetEntity: EntityInfo | null
    /** Handler when mappings are saved */
    onSave: (connectionId: string, mappings: InputMapping[]) => void
    /** Testcase columns that can also be used as input sources */
    testcaseColumns?: TestsetColumn[]
    /** Active testcase data for test runs */
    testcaseData?: Record<string, unknown>
}

/** Props for the mapping table content */
export interface MappingTableProps {
    sourceOutput: RunnableOutputPort | null
    targetInputs: RunnableInputPort[]
    localMappings: InputMapping[]
    setLocalMappings: React.Dispatch<React.SetStateAction<InputMapping[]>>
    setIsDirty: React.Dispatch<React.SetStateAction<boolean>>
    testcaseColumns?: TestsetColumn[]
    sourceLabel: string
    targetLabel: string
    /** Paths discovered from test run output */
    discoveredPaths?: PathInfo[]
}

/** Props for individual mapping row */
export interface MappingRowProps {
    input: RunnableInputPort
    mapping: InputMapping | undefined
    availablePaths: PathInfo[]
    onPathChange: (targetKey: string, pathString: string) => void
}

/** Props for object mapping row component (interface) */
export interface ObjectMappingRowComponentProps {
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

/** Props for path selector dropdown */
export interface PathSelectorProps {
    value: string | undefined
    onChange: (value: string) => void
    availablePaths: PathInfo[]
    placeholder?: string
    allowClear?: boolean
    size?: "small" | "middle" | "large"
    className?: string
}

/** Props for scalar mapping row */
export interface ScalarMappingRowComponentProps {
    input: RunnableInputPort
    mapping: InputMapping | undefined
    status: MappingStatusInfo
    availablePaths: PathInfo[]
    onPathChange: (targetKey: string, pathString: string) => void
    /** Preview value resolved from the source path */
    previewValue?: unknown
}

/** Props for test run preview */
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

/** Props for mapping legend */
export interface MappingLegendProps {
    sourceLabel: string
    testcaseCount: number
    outputCount: number
}

// ============================================================================
// HOOK TYPES
// ============================================================================

/** Return type for useMappingState hook */
export interface UseMappingStateReturn {
    localMappings: InputMapping[]
    isDirty: boolean
    availablePaths: PathInfo[]
    mappingStats: {
        total: number
        required: number
        mappedRequired: number
        isComplete: boolean
    }
    // Scalar mapping actions
    handlePathChange: (targetKey: string, pathString: string) => void
    handleAutoMap: () => void
    getMappingForInput: (inputKey: string) => InputMapping | undefined
    // Object mapping actions
    handleObjectKeyPathChange: (targetKey: string, keyInObject: string, pathString: string) => void
    handleRemoveObjectKey: (targetKey: string, keyInObject: string) => void
    handleRenameObjectKey: (targetKey: string, oldKey: string, newKey: string) => void
    handleAddAllTestcaseColumns: (targetKey: string) => void
    handleAddPredictionMapping: (targetKey: string) => void
    getObjectMappings: (inputKey: string) => InputMapping[]
    // Reset
    reset: (mappings: InputMapping[]) => void
}
