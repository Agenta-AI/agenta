import React, {useMemo, useState} from "react"
import {Filter, JSSTheme} from "@/lib/Types"
import {ArrowCounterClockwise, CaretDown, Funnel, Plus, Trash, X} from "@phosphor-icons/react"
import {Button, Divider, Input, Popover, Select, Space, Typography} from "antd"
import {createUseStyles} from "react-jss"
import {useUpdateEffect} from "usehooks-ts"
import isEqual from "lodash/isEqual"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    popover: {
        "& .ant-popover-inner": {
            width: "650px !important",
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
    columns: {value: string; label: string; type?: string}[]
    onApplyFilter: (filters: Filter[]) => void
    onClearFilter: (filters: Filter[]) => void
}

const Filters: React.FC<Props> = ({filterData, columns, onApplyFilter, onClearFilter}) => {
    const classes = useStyles()
    const emptyFilter = [{key: "", operator: "", value: "", isPermanent: false}] as Filter[]

    const [filter, setFilter] = useState<Filter[]>(() =>
        !filterData?.length ? emptyFilter : filterData,
    )
    const [isFilterOpen, setIsFilterOpen] = useState(false)

    useUpdateEffect(() => {
        if (filterData && filterData.length > 0) {
            setFilter(filterData)
        } else {
            setFilter(emptyFilter)
        }
    }, [filterData])

    const operators = [
        {type: "string", value: "contains", label: "contains"},
        {type: "string", value: "matches", label: "matches"},
        {type: "string", value: "like", label: "like"},
        {type: "string", value: "startswith", label: "startswith"},
        {type: "string", value: "endswith", label: "endswith"},
        {type: "exists", value: "exists", label: "exists"},
        {type: "exists", value: "not_exists", label: "not exists"},
        {type: "exists", value: "in", label: "in"},
        {type: "exists", value: "is", label: "is"},
        {type: "exists", value: "is_not", label: "is not"},
        {type: "number", value: "eq", label: "="},
        {type: "number", value: "neq", label: "!="},
        {type: "number", value: "gt", label: ">"},
        {type: "number", value: "lt", label: "<"},
        {type: "number", value: "gte", label: ">="},
        {type: "number", value: "lte", label: "<="},
        {type: "number", value: "btwn", label: "between"},
    ]

    const filteredColumns = useMemo(
        () => columns.filter((col) => !filter.some((item) => item.key === col.value)),
        [columns, filter],
    )

    const onFilterChange = ({
        columnName,
        value,
        idx,
    }: {
        columnName: keyof Omit<Filter, "isPermanent">
        value: any
        idx: number
    }) => {
        setFilter((prevFilters) => {
            const newFilters = [...prevFilters]
            newFilters[idx] = {...newFilters[idx], [columnName]: value}
            return newFilters
        })
    }

    const onDeleteFilter = (index: number) => {
        setFilter(filter.filter((_, idx) => idx !== index))
    }

    const addNestedFilter = () => {
        setFilter([...filter, {key: "", operator: "", value: "", isPermanent: false}])
    }

    const clearFilter = () => {
        const clearedFilters = filter.filter((f) => f.isPermanent)

        if (!isEqual(clearedFilters, filterData)) {
            onClearFilter(clearedFilters)
        }
        setFilter(!clearedFilters.length ? emptyFilter : clearedFilters)
    }

    const applyFilter = () => {
        const sanitizedFilters = filter.filter(({key, operator}) => key && operator)

        if (!isEqual(sanitizedFilters, filterData)) {
            onApplyFilter(sanitizedFilters)
        }
        setIsFilterOpen(false)
    }

    const mapColumnLabel = useMemo(
        () =>
            columns.reduce(
                (acc, col) => {
                    acc[col.value] = col.label
                    return acc
                },
                {} as Record<string, string>,
            ),
        [columns],
    )
    const getColumnLabelFromValue = (key: string) => mapColumnLabel[key] || key

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
                        {filter.map((item, idx) => {
                            const selectedColumn = columns.find((col) => col.value === item.key)
                            const filteredOperators = operators.filter(
                                (operator) => operator.type === selectedColumn?.type,
                            )

                            return (
                                <Space key={idx}>
                                    <p className={`w-[60px] text-end`}>
                                        {idx === 0 ? "Where" : "And"}
                                    </p>

                                    <Select
                                        showSearch
                                        labelRender={(label) =>
                                            !label.value ? "Column" : label.label
                                        }
                                        popupMatchSelectWidth={220}
                                        popupClassName="capitalize"
                                        className="capitalize w-[200px]"
                                        suffixIcon={<CaretDown size={14} />}
                                        onChange={(value) =>
                                            onFilterChange({columnName: "key", value, idx})
                                        }
                                        value={{
                                            value: item.key,
                                            label: getColumnLabelFromValue(item.key),
                                        }}
                                        options={filteredColumns}
                                        disabled={item.isPermanent}
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
                                                options={filteredOperators}
                                                disabled={item.isPermanent}
                                            />

                                            <Input
                                                placeholder="Keyword"
                                                className="w-[220px]"
                                                value={item.value}
                                                disabled={item.isPermanent}
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
                                            disabled={item.isPermanent}
                                            onClick={() => onDeleteFilter(idx)}
                                        />
                                    )}
                                </Space>
                            )
                        })}

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
                        <Button type="link" onClick={() => setIsFilterOpen(false)}>
                            Cancel
                        </Button>
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
