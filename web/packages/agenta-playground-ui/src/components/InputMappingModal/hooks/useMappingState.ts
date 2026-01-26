/**
 * useMappingState Hook
 *
 * Manages local mapping state with actions for scalar and object mappings.
 * Encapsulates all the mapping manipulation logic.
 */

import {useCallback, useMemo, useState} from "react"

import type {
    InputMapping,
    PathInfo,
    RunnableInputPort,
    RunnableOutputPort,
    TestsetColumn,
} from "@agenta/entities/runnable"
import {autoMapInputs} from "@agenta/entities/runnable"
import {keyToString} from "@agenta/shared/utils"

import type {UseMappingStateReturn} from "../types"
import {buildAvailablePaths} from "../utils"

export interface UseMappingStateOptions {
    sourceOutput: RunnableOutputPort | null
    targetInputs: RunnableInputPort[]
    testcaseColumns?: TestsetColumn[]
    discoveredPaths?: PathInfo[]
    initialMappings?: InputMapping[]
}

/**
 * Hook for managing mapping state with all CRUD operations
 */
export function useMappingState({
    sourceOutput,
    targetInputs,
    testcaseColumns = [],
    discoveredPaths = [],
    initialMappings = [],
}: UseMappingStateOptions): UseMappingStateReturn {
    const [localMappings, setLocalMappings] = useState<InputMapping[]>(initialMappings)
    const [isDirty, setIsDirty] = useState(false)

    // Build available paths from all sources
    const availablePaths = useMemo(() => {
        return buildAvailablePaths(sourceOutput?.availablePaths, testcaseColumns, discoveredPaths)
    }, [sourceOutput, testcaseColumns, discoveredPaths])

    // Calculate mapping stats
    const mappingStats = useMemo(() => {
        const required = targetInputs.filter((i) => i.required)
        const mappedRequired = required.filter((i) => {
            // Check for targetKey or deprecated targetInputKey
            const mapping = localMappings.find(
                (m) => (m.targetKey === i.key || m.targetInputKey === i.key) && !m.keyInObject,
            )
            const objectMappings = localMappings.filter(
                (m) => (m.targetKey === i.key || m.targetInputKey === i.key) && m.keyInObject,
            )
            // For object types, check if any object mappings exist
            if (i.type === "object") {
                return objectMappings.length > 0
            }
            return mapping && mapping.status === "valid"
        })
        return {
            total: targetInputs.length,
            required: required.length,
            mappedRequired: mappedRequired.length,
            isComplete: mappedRequired.length === required.length,
        }
    }, [targetInputs, localMappings])

    // ========================================================================
    // SCALAR MAPPING ACTIONS
    // ========================================================================

    /** Handle path selection for a simple (scalar) input */
    const handlePathChange = useCallback((targetKey: string, pathString: string) => {
        setLocalMappings((prev) => {
            const existing = prev.find(
                (m) =>
                    (m.targetKey === targetKey || m.targetInputKey === targetKey) && !m.keyInObject,
            )
            if (existing) {
                return prev.map((m) =>
                    (m.targetKey === targetKey || m.targetInputKey === targetKey) && !m.keyInObject
                        ? {
                              ...m,
                              targetKey,
                              sourcePath: pathString,
                              isAutoMapped: false,
                              status: "valid" as const,
                          }
                        : m,
                )
            }
            return [
                ...prev,
                {
                    targetKey,
                    sourcePath: pathString,
                    isAutoMapped: false,
                    status: "valid" as const,
                },
            ]
        })
        setIsDirty(true)
    }, [])

    /** Handle auto-map button */
    const handleAutoMap = useCallback(() => {
        // Get target input keys
        const targetKeys = targetInputs.map((i) => i.key)
        // Call autoMapInputs with the available paths
        const newMappings = autoMapInputs(targetKeys, availablePaths)
        setLocalMappings(newMappings)
        setIsDirty(true)
    }, [targetInputs, availablePaths])

    /** Get the current mapping for a simple input (no keyInObject) */
    const getMappingForInput = useCallback(
        (inputKey: string): InputMapping | undefined => {
            return localMappings.find(
                (m) =>
                    (m.targetKey === inputKey || m.targetInputKey === inputKey) && !m.keyInObject,
            )
        },
        [localMappings],
    )

    // ========================================================================
    // OBJECT MAPPING ACTIONS
    // ========================================================================

    /** Handle path selection for an object key mapping */
    const handleObjectKeyPathChange = useCallback(
        (targetKey: string, keyInObject: string, pathString: string) => {
            setLocalMappings((prev) => {
                const existing = prev.find(
                    (m) =>
                        (m.targetKey === targetKey || m.targetInputKey === targetKey) &&
                        keyToString(m.keyInObject) === keyInObject,
                )
                if (existing) {
                    return prev.map((m) =>
                        (m.targetKey === targetKey || m.targetInputKey === targetKey) &&
                        keyToString(m.keyInObject) === keyInObject
                            ? {
                                  ...m,
                                  targetKey,
                                  sourcePath: pathString,
                                  isAutoMapped: false,
                                  status: "valid" as const,
                              }
                            : m,
                    )
                }
                return [
                    ...prev,
                    {
                        targetKey,
                        keyInObject,
                        sourcePath: pathString,
                        isAutoMapped: false,
                        status: "valid" as const,
                    },
                ]
            })
            setIsDirty(true)
        },
        [],
    )

    /** Remove a key mapping for an object input */
    const handleRemoveObjectKey = useCallback((targetKey: string, keyInObject: string) => {
        setLocalMappings((prev) =>
            prev.filter(
                (m) =>
                    !(
                        (m.targetKey === targetKey || m.targetInputKey === targetKey) &&
                        keyToString(m.keyInObject) === keyInObject
                    ),
            ),
        )
        setIsDirty(true)
    }, [])

    /** Rename a key in an object mapping */
    const handleRenameObjectKey = useCallback(
        (targetKey: string, oldKeyInObject: string, newKeyInObject: string) => {
            // Don't allow empty or duplicate keys
            if (!newKeyInObject.trim()) return
            // Check if new key already exists
            const exists = localMappings.some(
                (m) =>
                    (m.targetKey === targetKey || m.targetInputKey === targetKey) &&
                    keyToString(m.keyInObject) === newKeyInObject &&
                    keyToString(m.keyInObject) !== oldKeyInObject,
            )
            if (exists) return

            setLocalMappings((prev) =>
                prev.map((m) =>
                    (m.targetKey === targetKey || m.targetInputKey === targetKey) &&
                    keyToString(m.keyInObject) === oldKeyInObject
                        ? {...m, keyInObject: newKeyInObject.trim(), isAutoMapped: false}
                        : m,
                ),
            )
            setIsDirty(true)
        },
        [localMappings],
    )

    /** Add all testcase columns as key mappings for an object input */
    const handleAddAllTestcaseColumns = useCallback(
        (targetKey: string) => {
            setLocalMappings((prev) => {
                // Remove existing testcase mappings for this target
                const withoutTestcase = prev.filter(
                    (m) =>
                        !(
                            (m.targetKey === targetKey || m.targetInputKey === targetKey) &&
                            m.keyInObject &&
                            m.sourcePath?.startsWith("testcase.")
                        ),
                )
                // Add mappings for all testcase columns
                const newMappings: InputMapping[] = testcaseColumns.map((col) => ({
                    targetKey,
                    keyInObject: col.key,
                    sourcePath: `testcase.${col.key}`,
                    isAutoMapped: true,
                    status: "valid" as const,
                }))
                return [...withoutTestcase, ...newMappings]
            })
            setIsDirty(true)
        },
        [testcaseColumns],
    )

    /** Add prediction mapping (output → inputs.prediction) */
    const handleAddPredictionMapping = useCallback(
        (targetKey: string) => {
            // Find the first output path
            const outputPath = availablePaths.find((p) => p.source === "output")
            if (!outputPath) return

            setLocalMappings((prev) => {
                // Remove existing prediction mapping
                const withoutPrediction = prev.filter(
                    (m) =>
                        !(
                            (m.targetKey === targetKey || m.targetInputKey === targetKey) &&
                            keyToString(m.keyInObject) === "prediction"
                        ),
                )
                return [
                    ...withoutPrediction,
                    {
                        targetKey,
                        keyInObject: "prediction",
                        sourcePath: outputPath.pathString || outputPath.path,
                        isAutoMapped: true,
                        status: "valid" as const,
                    },
                ]
            })
            setIsDirty(true)
        },
        [availablePaths],
    )

    /** Get all key mappings for an object input */
    const getObjectMappings = useCallback(
        (inputKey: string): InputMapping[] => {
            return localMappings.filter(
                (m) => (m.targetKey === inputKey || m.targetInputKey === inputKey) && m.keyInObject,
            )
        },
        [localMappings],
    )

    /** Reset to specific mappings */
    const reset = useCallback((mappings: InputMapping[]) => {
        setLocalMappings(mappings)
        setIsDirty(false)
    }, [])

    return {
        localMappings,
        isDirty,
        availablePaths,
        mappingStats,
        // Scalar
        handlePathChange,
        handleAutoMap,
        getMappingForInput,
        // Object
        handleObjectKeyPathChange,
        handleRemoveObjectKey,
        handleRenameObjectKey,
        handleAddAllTestcaseColumns,
        handleAddPredictionMapping,
        getObjectMappings,
        // Reset
        reset,
    }
}
