import {GenericObject, JSSTheme, PaginationQuery} from "@/lib/Types"
import {Button, Dropdown, Input, Space} from "antd"
import {ColumnsType} from "antd/es/table"
import {FilterDropdownProps} from "antd/es/table/interface"
import dayjs from "dayjs"
import React, {ReactNode, useMemo} from "react"
import {createUseStyles} from "react-jss"
import {Resizable} from "react-resizable"
import EnforceAntdStyles from "../EnforceAntdStyles/EnforceAntdStyles"
import {CheckOutlined} from "@ant-design/icons"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    filterRoot: {
        padding: "1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
    },
    resizableHandle: {
        position: "absolute",
        width: 10,
        height: "100%",
        right: "-5px",
        bottom: 0,
        cursor: "col-resize",
        zIndex: 1,
    },
    dropdownMenu: {
        "&>.ant-dropdown-menu-item": {
            "& .anticon-check": {
                display: "none",
            },
        },
        "&>.ant-dropdown-menu-item-selected": {
            "&:not(:hover)": {
                backgroundColor: "transparent !important",
            },
            "& .anticon-check": {
                display: "inline-flex !important",
            },
        },
    },
}))

export type TableParams = {
    pagination: PaginationQuery
    filters: GenericObject
    sorters: GenericObject
}

export const getFilterParams = (
    type: "number" | "text" | "date",
    field: string,
    tableParams: TableParams,
) => {
    const FilterDropdown: React.FC<FilterDropdownProps> = ({
        setSelectedKeys,
        selectedKeys,
        confirm,
    }) => {
        const classes = useStyles()

        return (
            <EnforceAntdStyles>
                <div className={classes.filterRoot}>
                    <Input.Search
                        type={type}
                        defaultValue={selectedKeys[0]?.toString()}
                        onSearch={(val) => {
                            setSelectedKeys(val ? [val] : [])
                            confirm()
                        }}
                    />
                </div>
            </EnforceAntdStyles>
        )
    }

    const filteredValStr = Object.entries(tableParams?.filters || {}).find(
        (item) => item[0] === field,
    )?.[1]

    return {
        filterDropdown: FilterDropdown,
        filteredValue: filteredValStr
            ? [
                  type === "date"
                      ? dayjs(filteredValStr.toString()).format("YYYY-MM-DD")
                      : filteredValStr,
              ]
            : undefined,
    }
}

interface ColsDropdownProps<T> {
    columns: ColumnsType<T>
    hiddenCols: string[]
    setHiddenCols: (cols: string[]) => void
}

export const ColsDropdown = <T,>({columns, hiddenCols, setHiddenCols}: ColsDropdownProps<T>) => {
    const classes = useStyles()
    const shownCols = useMemo(
        () =>
            columns
                .map((item) => item.key?.toString()!)
                .filter((item) => !hiddenCols.includes(item)),
        [columns, hiddenCols],
    )

    const onColToggle = (colKey: string) => {
        if (hiddenCols.includes(colKey)) {
            setHiddenCols(hiddenCols.filter((item) => item !== colKey))
        } else {
            setHiddenCols([...hiddenCols, colKey])
        }
    }

    return (
        <Dropdown
            trigger={["click"]}
            menu={{
                selectedKeys: shownCols,
                items: columns.map((item) => ({
                    key: item.key?.toString()!,
                    label: (
                        <Space>
                            <CheckOutlined />
                            <>{item.title as ReactNode}</>
                        </Space>
                    ),
                })) as any,
                onClick: ({key}) => onColToggle(key),
                className: classes.dropdownMenu,
            }}
        >
            <Button>
                Columns {shownCols.length}/{columns.length}
            </Button>
        </Dropdown>
    )
}

export const ResizableTitle: React.FC<GenericObject> = (props) => {
    const classes = useStyles()
    const {onResize, width, ...restProps} = props

    if (!width) {
        return <th {...restProps} />
    }

    return (
        <Resizable
            width={width}
            height={0}
            handle={
                <span
                    className={classes.resizableHandle}
                    onClick={(e) => {
                        e.stopPropagation()
                    }}
                />
            }
            onResize={onResize}
            draggableOpts={{enableUserSelectHack: false}}
        >
            <th {...restProps} />
        </Resizable>
    )
}
