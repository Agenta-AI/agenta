import React, {useState} from "react"
import {Filter, JSSTheme} from "@/lib/Types"
import {ArrowCounterClockwise, CaretDown, Funnel, Plus, Trash, X} from "@phosphor-icons/react"
import {Button, Divider, Input, Popover, Select, Space, Typography} from "antd"
import {createUseStyles} from "react-jss"
import {useUpdateEffect} from "usehooks-ts"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    popover: {
        "& .ant-popover-inner": {
            width: "600px !important",
            padding: `0px ${theme.paddingXS}px ${theme.paddingXS}px ${theme.padding}px`,
        },
    },
    filterHeading: {
        fontSize: theme.fontSizeHeading5,
        lineHeight: theme.lineHeightHeading5,
        fontWeight: theme.fontWeightMedium,
    },
    filterContainer: {
        padding: 8,
        display: "flex",
        flexDirection: "column",
        alignItems: "start",
        borderRadius: theme.borderRadius,
        backgroundColor: "#f5f7fa",
        marginTop: 8,
    },
}))

type Props = {
    filterData?: Filter[]
    setFilterData?: React.Dispatch<React.SetStateAction<Filter[]>>
    columns: {value: string; label: string}[]
    onApplyFilter: (filters: Filter[]) => void
    onClearFilter: (filters: Filter[]) => void
}

const Filters: React.FC<Props> = ({
    filterData,
    setFilterData,
    columns,
    onApplyFilter,
    onClearFilter,
}) => {
    const classes = useStyles()
    const emptyFilter = [{key: "", operator: "", value: ""}] as Filter[]

    const [filter, setFilter] = useState<Filter[]>(emptyFilter)
    const [isFilterOpen, setIsFilterOpen] = useState(false)

    useUpdateEffect(() => {
        if (filterData && filterData.length > 0) {
            setFilter(filterData)
        } else {
            setFilter(emptyFilter)
        }
    }, [filterData])

    const operators = [
        {value: "contains", lable: "contains"},
        {value: "matches", lable: "matches"},
        {value: "like", lable: "like"},
        {value: "startswith", lable: "startswith"},
        {value: "endswith", lable: "endswith"},
        {value: "exists", lable: "exists"},
        {value: "not_exists", lable: "not exists"},
        {value: "eq", lable: "="},
        {value: "neq", lable: "!="},
        {value: "gt", lable: ">"},
        {value: "lt", lable: "<"},
        {value: "gte", lable: ">="},
        {value: "lte", lable: "<="},
    ]

    const filteredOptions = columns.filter(
        (col) => !filter.some((item, i) => item.key === col.value),
    )

    const onFilterChange = ({
        columnName,
        value,
        idx,
    }: {
        columnName: keyof Filter
        value: any
        idx: number
    }) => {
        const newFilters = [...filter]
        newFilters[idx][columnName as keyof Filter] = value
        setFilter(newFilters)
    }

    const onDeleteFilter = (index: number) => {
        setFilter(filter.filter((_, idx) => idx !== index))
    }

    const addNestedFilter = () => {
        setFilter([...filter, {key: "", operator: "", value: ""}])
    }

    const clearFilter = () => {
        setFilter(emptyFilter)
        onClearFilter(emptyFilter)
    }

    const applyFilter = () => {
        const sanitizedFilters = filter.filter(({key, operator}) => key && operator)

        onApplyFilter(sanitizedFilters)
        setIsFilterOpen(false)
    }

    return (
        <Popover
            title={null}
            trigger="click"
            overlayClassName={classes.popover}
            arrow={false}
            onOpenChange={() => setIsFilterOpen(false)}
            open={isFilterOpen}
            placement="bottomLeft"
            content={
                <section>
                    <div className="h-[44px] flex items-center justify-between">
                        <Typography.Text className={classes.filterHeading}>Filter</Typography.Text>
                    </div>

                    <div className="-ml-4 -mr-2">
                        <Divider className="!m-0" />
                    </div>

                    <div className={classes.filterContainer}>
                        {filter.map((item, idx) => (
                            <Space key={idx}>
                                <p className={`w-[60px] text-end`}>{idx == 0 ? "Where" : "And"}</p>

                                <Select
                                    showSearch
                                    labelRender={(label) => (!label.value ? "Column" : label.label)}
                                    style={{width: 100}}
                                    popupMatchSelectWidth={220}
                                    suffixIcon={<CaretDown size={14} />}
                                    onChange={(value) =>
                                        onFilterChange({columnName: "key", value, idx})
                                    }
                                    filterSort={(a, b) =>
                                        (a?.label ?? "")
                                            .toLowerCase()
                                            .localeCompare((b?.label ?? "").toLowerCase())
                                    }
                                    filterOption={(input, option) =>
                                        (option?.label ?? "")
                                            .toLowerCase()
                                            .includes(input.toLowerCase())
                                    }
                                    value={item.key}
                                    options={filteredOptions.map((col) => ({
                                        value: col.value,
                                        label: col.label,
                                    }))}
                                />
                                {item.key && (
                                    <>
                                        <Select
                                            labelRender={(label) =>
                                                !label.value ? "Condition" : label.label
                                            }
                                            style={{width: 95}}
                                            suffixIcon={<CaretDown size={14} />}
                                            onChange={(value) =>
                                                onFilterChange({
                                                    columnName: "operator",
                                                    value,
                                                    idx,
                                                })
                                            }
                                            popupMatchSelectWidth={100}
                                            value={item.operator}
                                            options={operators.map((operator) => ({
                                                value: operator.value,
                                                label: operator.lable,
                                            }))}
                                        />

                                        <Input
                                            placeholder="Keyword"
                                            className="w-[270px]"
                                            value={item.value}
                                            onChange={(e) =>
                                                onFilterChange({
                                                    columnName: "value",
                                                    value: e.target.value,
                                                    idx,
                                                })
                                            }
                                        />
                                    </>
                                )}
                                {filter.length > 1 && (
                                    <Button
                                        type="link"
                                        icon={<Trash size={14} />}
                                        onClick={() => onDeleteFilter(idx)}
                                    />
                                )}
                            </Space>
                        ))}

                        <Button
                            type="link"
                            size="small"
                            icon={<Plus size={14} />}
                            onClick={addNestedFilter}
                            className="mt-2"
                        >
                            Add conditions
                        </Button>
                    </div>

                    <Space className="flex items-center justify-end mt-2">
                        <Button type="link">Cancel</Button>
                        <Button
                            icon={<ArrowCounterClockwise size={14} className="mt-0.5" />}
                            onClick={clearFilter}
                        >
                            Clear
                        </Button>
                        <Button
                            type="primary"
                            disabled={!filter[0]?.operator}
                            onClick={applyFilter}
                        >
                            Apply
                        </Button>
                    </Space>
                </section>
            }
        >
            <Button
                icon={<Funnel size={14} />}
                onClick={() => setIsFilterOpen(true)}
                className="flex items-center gap-2"
            >
                Filters {filter[0]?.operator && <X size={14} />}
            </Button>
        </Popover>
    )
}

export default Filters
