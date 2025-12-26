import {useMemo} from "react"

import {ArrowRight, Plus, Trash} from "@phosphor-icons/react"
import {AutoComplete, Button, Select, Typography} from "antd"

import {useStyles} from "../assets/styles"
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
}: MappingSectionProps) {
    const classes = useStyles()

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
        <div className={classes.container} data-testid="mapping-section">
            <Typography.Text
                className={classes.label}
                type={hasDuplicateColumns ? "danger" : "secondary"}
            >
                Mapping
            </Typography.Text>
            {hasDuplicateColumns && (
                <Typography.Text type="danger">
                    Duplicate columns detected. Ensure each column is unique
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
                                <AutoComplete
                                    className="flex-1"
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
                                    className="flex-1"
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
                                            ? customSelectOptions(selectedTestsetColumns.length > 0)
                                            : []),
                                        ...getAvailableColumnOptions(idx),
                                    ]}
                                />

                                {mapping.column === "create" && (
                                    <AutoComplete
                                        className="flex-1"
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

                                <Button
                                    type="text"
                                    icon={<Trash size={16} />}
                                    className="flex-shrink-0"
                                    onClick={() =>
                                        setMappingData(
                                            mappingData.filter((_, index) => index !== idx),
                                        )
                                    }
                                />
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
                <Typography.Text type="secondary">
                    Please select a testset revision to configure mappings
                </Typography.Text>
            )}
        </div>
    )
}
