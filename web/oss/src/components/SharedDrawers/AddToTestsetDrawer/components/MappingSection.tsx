import {useMemo} from "react"

import {ArrowRight, Crosshair, Plus, Trash} from "@phosphor-icons/react"
import {AutoComplete, Button, Select, Tooltip, Typography} from "antd"

import {Mapping, TestsetColumn} from "../assets/types"

interface MappingSectionProps {
    mappingData: Mapping[]
    setMappingData: (data: Mapping[] | ((prev: Mapping[]) => Mapping[])) => void
    onMappingOptionChange: (params: {pathName: keyof Mapping; value: string; idx: number}) => void
    onNewColumnBlur: () => void
    allAvailablePaths: {value: string; label: string}[]
    columnOptions: {value: string; label: string}[]
    customSelectOptions: (divider?: boolean) => any[]
    selectedRevisionId: string
    hasDuplicateColumns: boolean
    testsetId: string
    selectedTestsetColumns: TestsetColumn[]
    elementWidth: number
    isNewTestset?: boolean
    /** Callback to focus drill-in view on a specific data path */
    onFocusPath?: (dataPath: string) => void
}

export function MappingSection({
    mappingData,
    setMappingData,
    onMappingOptionChange,
    onNewColumnBlur,
    allAvailablePaths,
    columnOptions,
    customSelectOptions,
    selectedRevisionId,
    hasDuplicateColumns,
    testsetId,
    selectedTestsetColumns,
    elementWidth,
    isNewTestset = false,
    onFocusPath,
}: MappingSectionProps) {
    // Get columns that are already mapped (excluding "create" which is a special value)
    const mappedColumns = useMemo(() => {
        const mapped = new Set<string>()
        mappingData.forEach((m) => {
            if (m.column && m.column !== "create") {
                mapped.add(m.column)
            }
            if (m.newColumn) {
                mapped.add(m.newColumn)
            }
        })
        return mapped
    }, [mappingData])

    // Get available column options for a specific mapping row
    // Filters out columns that are already mapped by other rows
    const getAvailableColumnOptions = (currentIdx: number) => {
        const currentMapping = mappingData[currentIdx]
        const currentColumn = currentMapping?.column
        const currentNewColumn = currentMapping?.newColumn

        return columnOptions.filter((opt) => {
            // Always show the currently selected column for this row
            if (opt.value === currentColumn || opt.value === currentNewColumn) {
                return true
            }
            // Filter out columns mapped by other rows
            return !mappedColumns.has(opt.value)
        })
    }

    return (
        <div className="flex flex-col gap-1" data-testid="mapping-section">
            <Typography.Text
                className="font-medium"
                type={hasDuplicateColumns ? "danger" : undefined}
            >
                3. Review Mappings
            </Typography.Text>
            <Typography.Text type="secondary" className="text-xs">
                {mappingData.length > 0
                    ? "Your field mappings are shown below. You can also add mappings manually."
                    : "Map fields from the data preview above, or add mappings manually here."}
            </Typography.Text>
            {hasDuplicateColumns && (
                <Typography.Text type="danger" className="text-xs">
                    Duplicate columns detected. Ensure each column is unique.
                </Typography.Text>
            )}

            {(selectedRevisionId && selectedRevisionId !== "draft") ||
            isNewTestset ||
            mappingData.length > 0 ? (
                <>
                    <div className="flex flex-col gap-2">
                        {mappingData.map((mapping, idx) => (
                            <div
                                key={`mapping-${idx}-${mapping.data || ""}`}
                                className="flex gap-2 items-center"
                            >
                                {/* Inputs container - takes remaining space */}
                                <div className="flex-1 flex gap-2 items-center min-w-0">
                                    <AutoComplete
                                        className="flex-1 min-w-0"
                                        placeholder="Select or type a data path"
                                        value={mapping.data || undefined}
                                        onSelect={(value) =>
                                            onMappingOptionChange({
                                                pathName: "data",
                                                value,
                                                idx,
                                            })
                                        }
                                        onChange={(value) =>
                                            onMappingOptionChange({
                                                pathName: "data",
                                                value,
                                                idx,
                                            })
                                        }
                                        options={allAvailablePaths}
                                        filterOption={(inputValue, option) =>
                                            option!.value
                                                .toUpperCase()
                                                .indexOf(inputValue.toUpperCase()) !== -1
                                        }
                                    />
                                    <ArrowRight size={16} className="flex-shrink-0 text-gray-400" />
                                    <Select
                                        className={
                                            mapping.column === "create" ? "w-[120px]" : "flex-1"
                                        }
                                        placeholder="Select a column"
                                        value={mapping.column || undefined}
                                        onChange={(value) =>
                                            onMappingOptionChange({
                                                pathName: "column",
                                                value,
                                                idx,
                                            })
                                        }
                                        options={[
                                            ...(testsetId
                                                ? customSelectOptions(
                                                      selectedTestsetColumns.length > 0,
                                                  )
                                                : []),
                                            ...getAvailableColumnOptions(idx),
                                        ]}
                                    />

                                    {mapping.column === "create" && (
                                        <AutoComplete
                                            className="flex-1 min-w-0"
                                            value={mapping.newColumn || undefined}
                                            options={getAvailableColumnOptions(idx)}
                                            onSelect={(value) =>
                                                onMappingOptionChange({
                                                    pathName: "newColumn",
                                                    value,
                                                    idx,
                                                })
                                            }
                                            onChange={(value) =>
                                                onMappingOptionChange({
                                                    pathName: "newColumn",
                                                    value,
                                                    idx,
                                                })
                                            }
                                            onBlur={onNewColumnBlur}
                                            placeholder="Column name"
                                            filterOption={(inputValue, option) =>
                                                option!.value
                                                    .toUpperCase()
                                                    .indexOf(inputValue.toUpperCase()) !== -1
                                            }
                                        />
                                    )}
                                </div>

                                {/* Buttons container - fixed width */}
                                <div className="flex items-center flex-shrink-0 w-16">
                                    {onFocusPath && (
                                        <div className="w-8 h-8 flex items-center justify-center">
                                            {mapping.data && (
                                                <Tooltip title="Focus in data preview">
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        icon={<Crosshair size={16} />}
                                                        onClick={() => onFocusPath(mapping.data)}
                                                    />
                                                </Tooltip>
                                            )}
                                        </div>
                                    )}
                                    <div className="w-8 h-8 flex items-center justify-center">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<Trash size={16} />}
                                            onClick={() =>
                                                setMappingData(
                                                    mappingData.filter((_, index) => index !== idx),
                                                )
                                            }
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <Button
                        type="dashed"
                        className="mt-1"
                        style={{width: elementWidth}}
                        icon={<Plus />}
                        onClick={() => setMappingData([...mappingData, {data: "", column: ""}])}
                    >
                        Add field
                    </Button>
                </>
            ) : (
                <div className="py-4 px-3 bg-gray-50 rounded-md border border-dashed border-gray-200 text-center">
                    <Typography.Text type="secondary">
                        Select a testset above to start mapping fields
                    </Typography.Text>
                </div>
            )}
        </div>
    )
}
