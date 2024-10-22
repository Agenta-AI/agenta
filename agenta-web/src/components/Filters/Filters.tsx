import React, {useState} from "react"
import {Filter, JSSTheme} from "@/lib/Types"
import {ArrowCounterClockwise, CaretDown, Funnel, Plus, Trash, X} from "@phosphor-icons/react"
import {Button, Divider, Input, Popover, Select, Space, Typography} from "antd"
import {createUseStyles} from "react-jss"

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
    columns: {column: string; mapping: string}[]
    onApplyFilter: (filters: Filter[]) => void
    onClearFilter: (filters: Filter[]) => void
}

const Filters: React.FC<Props> = ({columns, onApplyFilter, onClearFilter}) => {
    const classes = useStyles()
    const emptyFilter = [{condition: "", column: "", keyword: ""}] as Filter[]

    const [filter, setFilter] = useState<Filter[]>(emptyFilter)
    const [isFilterOpen, setIsFilterOpen] = useState(false)

    const conditions = [
        "contains",
        "does not contain",
        "starts with",
        "ends with",
        "exists",
        "does not exist",
        "=",
        ">",
        "<",
        ">=",
        "<=",
    ]

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
        setFilter([...filter, {column: "", condition: "", keyword: ""}])
    }

    const clearFilter = () => {
        setFilter(emptyFilter)
        onClearFilter(emptyFilter)
    }

    const applyFilter = () => {
        const sanitizedFilters = filter.filter(
            ({column, condition, keyword}) => column && condition && keyword,
        )

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

                        <Button icon={<ArrowCounterClockwise size={14} />} onClick={clearFilter}>
                            Clear
                        </Button>
                    </div>

                    <div className="-ml-4 -mr-2">
                        <Divider className="!m-0" />
                    </div>

                    <div className={classes.filterContainer}>
                        {filter.map((item, idx) => (
                            <Space key={idx}>
                                <p className={`!w-[70px] text-end`}>{idx == 0 ? "Where" : "And"}</p>

                                <Select
                                    labelRender={(label) => (!label.value ? "Column" : label.label)}
                                    style={{width: 88}}
                                    popupMatchSelectWidth={120}
                                    suffixIcon={<CaretDown size={14} />}
                                    onChange={(value) =>
                                        onFilterChange({columnName: "column", value, idx})
                                    }
                                    value={item.column}
                                    options={columns.map((col) => ({
                                        value: col.mapping,
                                        label: col.column,
                                    }))}
                                />
                                {item.column && (
                                    <>
                                        <Select
                                            labelRender={(label) =>
                                                !label.value ? "Condition" : label.value
                                            }
                                            style={{width: 95}}
                                            suffixIcon={<CaretDown size={14} />}
                                            onChange={(value) =>
                                                onFilterChange({
                                                    columnName: "condition",
                                                    value,
                                                    idx,
                                                })
                                            }
                                            popupMatchSelectWidth={250}
                                            value={item.condition}
                                            options={conditions.map((con) => ({
                                                value: con,
                                                label: con,
                                            }))}
                                        />

                                        <Input
                                            placeholder="Keyword"
                                            className="w-[275px]"
                                            value={item.keyword}
                                            onChange={(e) =>
                                                onFilterChange({
                                                    columnName: "keyword",
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

                    <div className="flex items-center justify-end mt-2">
                        <Button type="primary" disabled={!filter[0]?.keyword} onClick={applyFilter}>
                            Apply
                        </Button>
                    </div>
                </section>
            }
        >
            <Button
                icon={<Funnel size={14} />}
                onClick={() => setIsFilterOpen(true)}
                className="flex items-center gap-2"
            >
                Filters {filter[0]?.keyword && <X size={14} />}
            </Button>
        </Popover>
    )
}

export default Filters
