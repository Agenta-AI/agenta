import React, {useState} from "react"
import {Filter, JSSTheme} from "@/lib/Types"
import {ArrowCounterClockwise, CaretDown, Funnel, X} from "@phosphor-icons/react"
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
        gap: 8,
        borderRadius: theme.borderRadius,
        backgroundColor: "#f5f7fa",
        marginTop: 8,
    },
}))

type Props = {
    setFilterValue: React.Dispatch<React.SetStateAction<Filter>>
    columns: {column: string; mapping: string}[]
}

const Filters: React.FC<Props> = ({setFilterValue, columns}) => {
    const classes = useStyles()
    const [filter, setFilter] = useState<Filter>({} as Filter)
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

    const clearFilter = () => {
        setFilter({} as Filter)
        setFilterValue({} as Filter)
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
                        <Space className="pl-3">
                            <Typography.Text>Where</Typography.Text>

                            <Select
                                placeholder="Column"
                                style={{width: 88}}
                                popupMatchSelectWidth={120}
                                suffixIcon={<CaretDown size={14} />}
                                onChange={(value) => setFilter({...filter, column: value})}
                                value={filter.column}
                                options={columns.map((item) => {
                                    return {
                                        value: item.mapping,
                                        label: item.column.toUpperCase(),
                                    }
                                })}
                            />
                            {filter.column && (
                                <>
                                    <Select
                                        placeholder="Condition"
                                        style={{width: 95}}
                                        suffixIcon={<CaretDown size={14} />}
                                        onChange={(value) =>
                                            setFilter({...filter, condition: value})
                                        }
                                        popupMatchSelectWidth={250}
                                        value={filter.condition}
                                        options={conditions.map((item) => {
                                            return {value: item, label: item.toUpperCase()}
                                        })}
                                    />

                                    <Input
                                        placeholder="Keyword"
                                        className="w-[300px]"
                                        value={filter.keyword}
                                        onChange={(e) =>
                                            setFilter({...filter, keyword: e.target.value})
                                        }
                                    />
                                </>
                            )}
                        </Space>
                    </div>

                    <div className="flex items-center justify-end mt-2">
                        <Button
                            type="primary"
                            disabled={!filter.keyword}
                            onClick={() => {
                                setIsFilterOpen(false)
                                setFilterValue(filter)
                            }}
                        >
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
                Filters {filter.condition && <X size={14} />}
            </Button>
        </Popover>
    )
}

export default Filters
