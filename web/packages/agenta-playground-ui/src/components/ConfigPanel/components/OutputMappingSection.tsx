/**
 * OutputMappingSection Component
 *
 * Allows users to map execution output paths to testcase columns.
 * Output values can be applied to testcases to include execution results
 * in the saved data.
 *
 * Shows data preview alongside paths for better UX.
 *
 * ## Usage
 *
 * ```typescript
 * <OutputMappingSection
 *   loadableId={loadableId}
 *   columnOptions={[{ value: 'output', label: 'output' }]}
 *   onAddColumn={(name) => handleAddColumn(name)}
 * />
 * ```
 */

import {useCallback, useMemo, useState} from "react"

import {testsetLoadable, type OutputMapping, getValueAtPath} from "@agenta/entities/loadable"
import {formatPreviewValue} from "@agenta/shared/utils"
import {cn, textColors} from "@agenta/ui/styles"
import {ArrowRight, Play, Plus, Trash} from "@phosphor-icons/react"
import {AutoComplete, Button, Select, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

const {Text} = Typography

export interface OutputMappingSectionProps {
    /** Loadable ID to manage mappings for */
    loadableId: string
    /** Column options from loadable columns + extra columns */
    columnOptions: {value: string; label: string}[]
    /** Callback to add a new column (when user selects "create new") */
    onAddColumn?: (name: string) => void
}

export function OutputMappingSection({
    loadableId,
    columnOptions,
    onAddColumn,
}: OutputMappingSectionProps) {
    // Selectors
    const mappings = useAtomValue(testsetLoadable.selectors.outputMappings(loadableId))
    // Use schema-derived paths (works even before executions)
    const availablePaths = useAtomValue(
        testsetLoadable.selectors.availableOutputPathsWithSchema(loadableId),
    )
    const hasExecutionResults = useAtomValue(
        testsetLoadable.selectors.hasExecutionResults(loadableId),
    )
    const executionResults = useAtomValue(testsetLoadable.selectors.executionResults(loadableId))
    // Data preview for showing values alongside paths
    const outputDataPreview = useAtomValue(testsetLoadable.selectors.outputDataPreview(loadableId))

    // Actions
    const addMapping = useSetAtom(testsetLoadable.actions.addOutputMapping)
    const removeMapping = useSetAtom(testsetLoadable.actions.removeOutputMapping)
    const updateMapping = useSetAtom(testsetLoadable.actions.updateOutputMapping)
    const applyAll = useSetAtom(testsetLoadable.actions.applyOutputMappingsToAll)

    // Derived state
    const hasMappings = mappings.length > 0
    const hasValidMappings = mappings.some((m) => m.outputPath && m.targetColumn)
    const resultsCount = Object.keys(executionResults).length

    // Filter out already-mapped paths from available paths
    const mappedPaths = useMemo(() => new Set(mappings.map((m) => m.outputPath)), [mappings])

    // Options for output path select - include paths with data preview
    const outputPathOptions = useMemo(() => {
        // Wrap agData in { data: ... } to match path format (data.inputs.*, data.outputs.*)
        const dataSource = outputDataPreview ? {data: outputDataPreview} : null

        return availablePaths.map((path) => {
            // Extract value at this path for preview
            const value = dataSource ? getValueAtPath(dataSource, path) : undefined
            const preview = formatPreviewValue(value, 40)

            return {
                value: path,
                label: (
                    <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="truncate font-mono text-xs">{path}</span>
                        <span
                            className={cn("text-xs truncate max-w-[120px]", textColors.quaternary)}
                        >
                            {preview}
                        </span>
                    </div>
                ),
                // For search filtering, use plain path string
                searchValue: path,
                disabled: mappedPaths.has(path),
            }
        })
    }, [availablePaths, mappedPaths, outputDataPreview])

    // Options for column select - include "create new" option
    const columnSelectOptions = useMemo(
        () => [
            {value: "__create__", label: "+ Create new column"},
            ...columnOptions.map((opt) => ({
                ...opt,
                // Disable columns that are already targets
                disabled: mappings.some(
                    (m) => m.targetColumn === opt.value && m.targetColumn !== opt.value,
                ),
            })),
        ],
        [columnOptions, mappings],
    )

    // Handlers
    const handleAddMapping = useCallback(() => {
        addMapping(loadableId, {
            outputPath: "",
            targetColumn: "",
        })
    }, [addMapping, loadableId])

    const handleRemoveMapping = useCallback(
        (mappingId: string) => {
            removeMapping(loadableId, mappingId)
        },
        [removeMapping, loadableId],
    )

    const handleUpdateOutputPath = useCallback(
        (mappingId: string, outputPath: string) => {
            updateMapping(loadableId, mappingId, {outputPath})
        },
        [updateMapping, loadableId],
    )

    // Track which mappings are in "new column" input mode
    const [newColumnInputs, setNewColumnInputs] = useState<Record<string, string>>({})

    const handleUpdateTargetColumn = useCallback(
        (mappingId: string, targetColumn: string, mapping: OutputMapping) => {
            if (targetColumn === "__create__") {
                // User wants to create a new column - show input for name
                // Use the last part of the output path as default name
                const defaultName = mapping.outputPath?.split(".").pop() || "output"
                setNewColumnInputs((prev) => ({...prev, [mappingId]: defaultName}))
                updateMapping(loadableId, mappingId, {
                    targetColumn: "__create__",
                    isNewColumn: true,
                })
            } else {
                // Clear any pending new column input
                setNewColumnInputs((prev) => {
                    const {[mappingId]: _, ...rest} = prev
                    return rest
                })
                updateMapping(loadableId, mappingId, {
                    targetColumn,
                    isNewColumn: false,
                })
            }
        },
        [updateMapping, loadableId],
    )

    // Handle new column name change
    const handleNewColumnNameChange = useCallback((mappingId: string, name: string) => {
        setNewColumnInputs((prev) => ({...prev, [mappingId]: name}))
    }, [])

    // Handle confirming new column creation
    const handleConfirmNewColumn = useCallback(
        (mappingId: string) => {
            const name = newColumnInputs[mappingId]?.trim()
            if (!name) return

            // Create the column
            onAddColumn?.(name)

            // Update mapping with the new column name
            updateMapping(loadableId, mappingId, {
                targetColumn: name,
                isNewColumn: true,
            })

            // Clear the input
            setNewColumnInputs((prev) => {
                const {[mappingId]: _, ...rest} = prev
                return rest
            })
        },
        [newColumnInputs, onAddColumn, updateMapping, loadableId],
    )

    // Handle canceling new column creation
    const handleCancelNewColumn = useCallback(
        (mappingId: string) => {
            setNewColumnInputs((prev) => {
                const {[mappingId]: _, ...rest} = prev
                return rest
            })
            updateMapping(loadableId, mappingId, {
                targetColumn: "",
                isNewColumn: false,
            })
        },
        [updateMapping, loadableId],
    )

    const handleApplyMappings = useCallback(() => {
        applyAll(loadableId)
    }, [applyAll, loadableId])

    // Don't render if no available paths (no schema or execution results)
    const hasAvailablePaths = availablePaths.length > 0
    if (!hasAvailablePaths && !hasMappings) {
        return (
            <div className="px-3 py-2 border-t border-gray-100">
                <Text type="secondary" className="text-xs">
                    Run an execution to enable output mapping
                </Text>
            </div>
        )
    }

    return (
        <div className="px-3 py-2 border-t border-gray-100">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <Text type="secondary" className="text-xs uppercase tracking-wide">
                    Output Mappings
                </Text>
                {hasMappings && hasValidMappings && (
                    <Tooltip
                        title={
                            hasExecutionResults
                                ? `Apply mappings to ${resultsCount} row(s) with results`
                                : "Run an execution first to apply mappings"
                        }
                    >
                        <Button
                            type="text"
                            size="small"
                            icon={<Play size={12} />}
                            onClick={handleApplyMappings}
                            className="text-xs"
                            disabled={!hasExecutionResults}
                        >
                            Apply
                        </Button>
                    </Tooltip>
                )}
            </div>

            {/* Mapping rows */}
            {hasMappings && (
                <div className="flex flex-col gap-2 mb-2">
                    {mappings.map((mapping) => {
                        // Get preview value for this mapping's path
                        const dataSource = outputDataPreview ? {data: outputDataPreview} : null
                        const previewValue =
                            mapping.outputPath && dataSource
                                ? getValueAtPath(dataSource, mapping.outputPath)
                                : undefined
                        const previewText = formatPreviewValue(previewValue, 100)

                        return (
                            <div key={mapping.id} className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                    {/* Output path select */}
                                    <Select
                                        className="flex-1 min-w-0"
                                        size="small"
                                        placeholder="Output path..."
                                        value={mapping.outputPath || undefined}
                                        onChange={(value) =>
                                            handleUpdateOutputPath(mapping.id, value)
                                        }
                                        options={outputPathOptions}
                                        showSearch
                                        optionFilterProp="searchValue"
                                        filterOption={(input, option) =>
                                            (option?.searchValue as string)
                                                ?.toLowerCase()
                                                .includes(input.toLowerCase())
                                        }
                                        styles={{popup: {root: {minWidth: 350}}}}
                                    />

                                    <Tooltip
                                        title={mapping.outputPath ? previewText : "Select a path"}
                                    >
                                        <ArrowRight
                                            size={14}
                                            className={cn(textColors.quaternary, "flex-shrink-0")}
                                        />
                                    </Tooltip>

                                    {/* Target column select or new column input */}
                                    {newColumnInputs[mapping.id] !== undefined ? (
                                        <AutoComplete
                                            className="flex-1 min-w-0"
                                            size="small"
                                            placeholder="New column name..."
                                            value={newColumnInputs[mapping.id] ?? ""}
                                            options={columnOptions.map((c) => ({
                                                value: c.value,
                                                label: c.label,
                                            }))}
                                            onChange={(value) =>
                                                handleNewColumnNameChange(mapping.id, value)
                                            }
                                            onBlur={() => {
                                                if (newColumnInputs[mapping.id]?.trim()) {
                                                    handleConfirmNewColumn(mapping.id)
                                                } else {
                                                    handleCancelNewColumn(mapping.id)
                                                }
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    handleConfirmNewColumn(mapping.id)
                                                } else if (e.key === "Escape") {
                                                    handleCancelNewColumn(mapping.id)
                                                }
                                            }}
                                            autoFocus
                                        />
                                    ) : (
                                        <Select
                                            className="flex-1 min-w-0"
                                            size="small"
                                            placeholder="Column..."
                                            value={mapping.targetColumn || undefined}
                                            onChange={(value) =>
                                                handleUpdateTargetColumn(mapping.id, value, mapping)
                                            }
                                            options={columnSelectOptions}
                                            showSearch
                                            filterOption={(input, option) =>
                                                (option?.label as string)
                                                    ?.toLowerCase()
                                                    .includes(input.toLowerCase())
                                            }
                                        />
                                    )}

                                    {/* Remove button */}
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<Trash size={12} />}
                                        onClick={() => handleRemoveMapping(mapping.id)}
                                        className="flex-shrink-0"
                                    />
                                </div>
                                {/* Preview line showing the value being mapped */}
                                {mapping.outputPath && previewValue !== undefined && (
                                    <div
                                        className={cn(
                                            "ml-1 px-2 py-1 bg-zinc-1 rounded text-xs truncate",
                                            textColors.secondary,
                                        )}
                                    >
                                        <span className={textColors.quaternary}>Value: </span>
                                        {previewText}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Add mapping button */}
            <Button
                type="dashed"
                size="small"
                icon={<Plus size={12} />}
                onClick={handleAddMapping}
                className="w-full"
                disabled={availablePaths.length === 0}
            >
                {availablePaths.length === 0 ? "No output paths available" : "Add output mapping"}
            </Button>
        </div>
    )
}
