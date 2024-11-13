import React, {useMemo, useState} from "react"
import {Button, Table, TableColumnType} from "antd"
import type {ColumnsType} from "antd/es/table"
import {ResizableTitle} from "@/components/ServerTable/components"

interface TableDataType {
    key: any
    input1: string
    input2: string
    input3: string
    input4: string
    expectedOutput: string
    appOutput: string
    anyOutput: string
    additionalInfo: string
}

const data: TableDataType[] = [
    {
        key: 1,
        input1: "Sample Input 1",
        input2: "Sample Input 2",
        input3: "Sample Input 3",
        input4: "Sample Input 4",
        expectedOutput: "Expected Output 1",
        appOutput: "App Output 1",
        anyOutput: "Any Output 1",
        additionalInfo: "Additional Info 1",
    },
    {
        key: 2,
        input1: "Sample Input 1",
        input2: "Sample Input 2",
        input3: "Sample Input 3",
        input4: "Sample Input 4",
        expectedOutput: "Expected Output 2",
        appOutput: "App Output 2",
        anyOutput: "Any Output 2",
        additionalInfo: "Additional Info 2",
    },
]

const NestedTable: React.FC = () => {
    const [columnsTop, setColumnsTop] = useState<ColumnsType<TableDataType>>([
        {
            title: null,
            dataIndex: "null",
            key: "input1",
            width: 200,
            onHeaderCell: () => ({
                style: {minWidth: 100},
            }),
            colSpan: 4,
            onCell: (_, index) => ({
                colSpan: 4,
            }),
        },

        {
            title: "Variant 1",
            dataIndex: "input1",
            key: "variant1",
            width: 200,
            className: "select-none",
            onHeaderCell: () => ({
                style: {minWidth: 100},
            }),
        },
        {
            title: "Variant 2",
            dataIndex: "input2",
            key: "variant2",
            width: 200,
            className: "select-none",
            onHeaderCell: () => ({
                style: {minWidth: 100},
            }),
        },
        {
            title: "Variant 3",
            dataIndex: "input3",
            key: "variant3",
            width: 200,
            className: "select-none",
            onHeaderCell: () => ({
                style: {minWidth: 100},
            }),
        },
        {
            title: "Variant 4",
            dataIndex: "additionalInfo",
            key: "input3",
            width: 200,
            className: "select-none",
            onHeaderCell: () => ({
                style: {minWidth: 100},
            }),
        },
    ])

    const [columnsBottom, setColumnsBottom] = useState<ColumnsType<TableDataType>>([
        {
            title: "Input 1",
            dataIndex: "input1",
            key: "input1",
            width: 200,
            className: "select-none",
            onHeaderCell: () => ({
                style: {minWidth: 100},
            }),
        },
        {
            title: "Input 2",
            dataIndex: "input2",
            key: "input1",
            width: 200,
            className: "select-none",
            onHeaderCell: () => ({
                style: {minWidth: 100},
            }),
        },
        {
            title: "Input 3",
            dataIndex: "input3",
            key: "input1",
            width: 200,
            className: "select-none",
            onHeaderCell: () => ({
                style: {minWidth: 100},
            }),
        },
        {
            title: "Input 4",
            dataIndex: "input4",
            key: "input1",
            width: 200,
            className: "select-none",
            onHeaderCell: () => ({
                style: {minWidth: 100},
            }),
        },
        {
            title: "Expected Output",
            dataIndex: "expectedOutput",
            key: "variant1",
            width: 200,
            className: "select-none",
            onHeaderCell: () => ({
                style: {minWidth: 100},
            }),
        },
        {
            title: "App Output",
            dataIndex: "appOutput",
            key: "variant2",
            width: 200,
            className: "select-none",
            onHeaderCell: () => ({
                style: {minWidth: 100},
            }),
        },
        {
            title: "Any Output",
            dataIndex: "anyOutput",
            key: "variant3",
            width: 200,
            className: "select-none",
            onHeaderCell: () => ({
                style: {minWidth: 100},
            }),
        },
        {
            title: "Additional Info",
            dataIndex: "additionalInfo",
            key: "variant4",
            width: 200,
            className: "select-none",
            onHeaderCell: () => ({
                style: {minWidth: 100},
            }),
        },
    ])

    const handleCols = (cols: ColumnsType<TableDataType>, key: string, size: any) => {
        return cols.map((col) => ({
            ...col,
            width: col.key === key ? size.width : col.width,
        }))
    }
    const handleResize =
        (key: string) =>
        (_: any, {size}: {size: {width: number}}) => {
            setColumnsTop((cols) => handleCols(cols, key, size))
            setColumnsBottom((cols) => handleCols(cols, key, size))
        }

    const mergedColumnsTop = useMemo(() => {
        return columnsTop.map((col) => ({
            ...col,
            onHeaderCell: (column: TableColumnType<TableDataType>) => ({
                width: column.width,
                onResize: handleResize(column.key as string),
            }),
        }))
    }, [columnsTop])

    const mergedColumnsBottom = useMemo(() => {
        return columnsBottom.map((col) => ({
            ...col,
            onHeaderCell: (column: TableColumnType<TableDataType>) => ({
                width: column.width,
                onResize: handleResize(column.key as string),
            }),
        }))
    }, [columnsBottom])

    return (
        <>
            <Button href="/test-table-v-2" className="my-10">
                Version 2
            </Button>

            <h1 className="select-none">Table 1</h1>
            <Table
                columns={mergedColumnsTop as TableColumnType<TableDataType>[]}
                dataSource={data}
                bordered
                components={{header: {cell: ResizableTitle}}}
                rowKey="key"
                pagination={false}
                scroll={{x: "max-content"}}
            />

            <h1>Table 2</h1>
            <Table
                columns={mergedColumnsBottom as TableColumnType<TableDataType>[]}
                dataSource={data}
                bordered
                components={{header: {cell: ResizableTitle}}}
                rowKey="key"
                pagination={false}
                scroll={{x: "max-content"}}
            />
        </>
    )
}

export default NestedTable
