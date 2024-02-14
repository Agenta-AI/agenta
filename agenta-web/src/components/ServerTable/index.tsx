import React, {ReactNode, useEffect, useMemo, useRef, useState} from "react"
import {Space, Table, TableColumnType} from "antd"
import {AnyObject} from "antd/es/_util/type"
import ReactDragListView from "react-drag-listview"
import {useQueryParam} from "@/hooks/useQuery"
import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"
import {ColsDropdown, ResizableTitle, TableParams, getFilterParams} from "./components"
import {useDeepCompareEffect} from "@/hooks/useDeepCompareEffect"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    root: {
        width: "100%",
    },
    dragHandle: {
        cursor: "move",
    },
    filterRoot: {
        "& .input": {
            width: 200,
        },
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
    header: {
        width: "100%",
        justifyContent: "flex-end",
    },
}))

type DataCol<T> = TableColumnType<T> & {filterDataType?: Parameters<typeof getFilterParams>[0]}

interface Props<T> {
    height?: number | string
    fetchData?: (params: TableParams) => Promise<{
        data: T[]
        total?: number
    }>
    headersSelection?: boolean
    colsDraggable?: boolean
    colsResizable?: boolean
    pagination?: boolean
    columns: DataCol<T>[]
    headerExtra?: ReactNode
}

const ServerTable = <T extends AnyObject>(
    props: Omit<React.ComponentProps<typeof Table<T>>, "pagination" | "columns"> & Props<T>,
) => {
    const classes = useStyles()
    const [columns, setColumns] = useState<DataCol<T>[]>((props.columns || []) as DataCol<T>[])
    const [_tableParams, setTableParams] = useQueryParam("tableParams")
    const [_hiddenCols, _setHiddenCols] = useQueryParam("hiddenCols", "")
    const [data, setData] = useState<T[]>([])
    const [loading, setLoading] = useState(false)

    const tableParams = useMemo(() => JSON.parse(_tableParams || "{}"), [_tableParams])
    const hiddenCols = useMemo(() => _hiddenCols?.split(",") || [], [_hiddenCols])
    const setHiddenCols = (cols: string[]) => _setHiddenCols(cols.join(","))
    const total = useRef(0)

    // useDeepCompareEffect(() => {
    //     setColumns(
    //         (props.columns || []).map((item) => ({...item, width: item.width})) as DataCol<T>[],
    //     )
    // }, [props.columns])

    useEffect(() => {
        setLoading(true)
        props
            .fetchData?.(tableParams)
            .then((res) => {
                setData(res.data)
                total.current = res.total || 0
            })
            .catch(console.error)
            .finally(() => {
                setLoading(false)
            })
    }, [tableParams])

    const onDragEnd = (fromIndex: number, toIndex: number) => {
        setColumns((cols) => {
            const nextCols = [...cols]
            const item = nextCols.splice(fromIndex - 1, 1)[0]
            nextCols.splice(toIndex - 1, 0, item)
            return nextCols
        })
    }

    const handleResize =
        (key: string) =>
        (_: any, {size}: {size: {width: number}}) => {
            setColumns((cols) => {
                return cols.map((col) => ({
                    ...col,
                    width: col.key === key ? size.width : col.width,
                }))
            })
        }

    const cols = useMemo(() => {
        return columns.map((col) => ({
            ...col,
            hidden: hiddenCols.includes(col.key?.toString()!),
            width: col.width || 150,
            onHeaderCell: (column: TableColumnType<T>) => ({
                width: column.width,
                onResize: handleResize(column.key?.toString()!),
            }),
            title: props.colsDraggable ? (
                <span className={classes.dragHandle}>{col.title as ReactNode}</span>
            ) : (
                col.title
            ),
            sortOrder: col.sorter
                ? Object.entries(tableParams?.sorters || {}).find(
                      (item) => item[0] === col.key?.toString()!,
                  )?.[1]
                : undefined,
            ...(col.filterDataType
                ? getFilterParams(col.filterDataType, col.key?.toString()!, tableParams)
                : {}),
        }))
    }, [hiddenCols, columns, tableParams, props.colsDraggable])

    return (
        <Space direction="vertical" size="middle" className={classes.root}>
            <Space className={classes.header} align="center">
                {props.headerExtra}
                {props.headersSelection && (
                    <ColsDropdown
                        columns={columns}
                        hiddenCols={hiddenCols}
                        setHiddenCols={setHiddenCols}
                    />
                )}
            </Space>
            <ReactDragListView.DragColumn
                nodeSelector="th"
                handleSelector={'[class*="dragHandle"]'}
                ignoreSelector={'[class*="resizableHandle"]'}
                onDragEnd={onDragEnd}
            >
                <Table<T>
                    size="middle"
                    {...props}
                    dataSource={data}
                    columns={cols as TableColumnType<T>[]}
                    loading={loading}
                    pagination={
                        !!props.pagination && {
                            pageSize: tableParams?.pagination?.pageSize || 10,
                            current: tableParams?.pagination?.page || 1,
                            total: total.current,
                        }
                    }
                    components={{
                        ...(props.components || {}),
                        header: {
                            cell: props.colsResizable ? ResizableTitle : undefined,
                            ...(props.components?.header || {}),
                        },
                    }}
                    scroll={{x: "max-content", y: props.height}}
                    onChange={(pagination, filters, sorters, extra) => {
                        const sortObj = (Array.isArray(sorters) ? sorters[0] : sorters) || {}
                        setTableParams(
                            JSON.stringify({
                                pagination: {
                                    page: pagination.current,
                                    pageSize: pagination.pageSize,
                                },
                                filters: Object.entries(filters).reduce((acc, [key, value]) => {
                                    const val = value?.[0]
                                    return !val ? acc : {...acc, [key]: val}
                                }, {}),
                                sorters:
                                    !sortObj?.order || !sortObj?.columnKey
                                        ? {}
                                        : {
                                              [sortObj.columnKey.toString()]: sortObj.order,
                                          },
                            }),
                        )
                        props.onChange?.(pagination, filters, sorters, extra)
                    }}
                />
            </ReactDragListView.DragColumn>
        </Space>
    )
}

export default ServerTable
