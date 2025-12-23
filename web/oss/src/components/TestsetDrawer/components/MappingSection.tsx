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

    return (
        <div className={classes.container}>
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

            {(selectedRevisionId && selectedRevisionId !== "draft") || isNewTestset ? (
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
                                        ...columnOptions,
                                    ]}
                                />

                                {mapping.column === "create" && (
                                    <AutoComplete
                                        className="flex-1"
                                        value={mapping.newColumn || undefined}
                                        options={columnOptions}
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
