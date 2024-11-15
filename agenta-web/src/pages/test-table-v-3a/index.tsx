import React, {useCallback, useRef, useState} from "react"
import {AgGridReact} from "ag-grid-react"
import {ColDef, ColumnResizedEvent, GridReadyEvent} from "ag-grid-community"
import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"

interface FirstTableItem {
    employeeId: number
    firstName: string
    salary: number
    department: string
}

interface SecondTableItem {
    productId: number
    productName: string
    price: number
    category: string
}

const SynchronizedTables: React.FC = () => {
    const firstGridRef = useRef<AgGridReact>(null)
    const secondGridRef = useRef<AgGridReact>(null)
    // Flag to prevent infinite loop of resize events
    const isResizing = useRef(false)

    // Sample data for first table (Employee data)
    const firstTableData: FirstTableItem[] = [
        {employeeId: 1, firstName: "John Doe", salary: 50000, department: "IT"},
        {employeeId: 2, firstName: "Jane Smith", salary: 60000, department: "HR"},
        {employeeId: 3, firstName: "Bob Johnson", salary: 55000, department: "Sales"},
    ]

    // Sample data for second table (Product data)
    const secondTableData: SecondTableItem[] = [
        {productId: 101, productName: "Laptop", price: 1200, category: "Electronics"},
        {productId: 102, productName: "Desk Chair", price: 300, category: "Furniture"},
        {productId: 103, productName: "Monitor", price: 400, category: "Electronics"},
    ]

    // Column mappings (bidirectional)
    const columnMappings = {
        firstToSecond: {
            employeeId: "productId",
            firstName: "productName",
            salary: "price",
            department: "category",
        },
        secondToFirst: {
            productId: "employeeId",
            productName: "firstName",
            price: "salary",
            category: "department",
        },
    }

    // Unique column definitions for first table
    const firstTableColumnDefs: ColDef[] = [
        {
            field: "employeeId",
            headerName: "Employee ID",
            resizable: true,
            minWidth: 100,
        },
        {
            field: "firstName",
            headerName: "First Name",
            resizable: true,
            minWidth: 150,
        },
        {
            field: "salary",
            headerName: "Salary",
            resizable: true,
            minWidth: 100,
            valueFormatter: (params) => `$${params.value.toLocaleString()}`,
        },
        {
            field: "department",
            headerName: "Department",
            resizable: true,
            minWidth: 150,
        },
    ]

    // Unique column definitions for second table
    const secondTableColumnDefs: ColDef[] = [
        {
            field: "productId",
            headerName: "Product ID",
            resizable: true,
            minWidth: 100,
        },
        {
            field: "productName",
            headerName: "Product Name",
            resizable: true,
            minWidth: 150,
        },
        {
            field: "price",
            headerName: "Price",
            resizable: true,
            minWidth: 100,
            valueFormatter: (params) => `$${params.value.toLocaleString()}`,
        },
        {
            field: "category",
            headerName: "Category",
            resizable: true,
            minWidth: 150,
        },
    ]

    // Generic handler for column resize events
    const handleColumnResize = useCallback(
        (event: ColumnResizedEvent, sourceGrid: "first" | "second") => {
            if (event.finished || isResizing.current) return

            const sourceColumn = event.column
            if (!sourceColumn) return

            try {
                isResizing.current = true

                const sourceColId = sourceColumn.getColId()
                const mapping =
                    sourceGrid === "first"
                        ? columnMappings.firstToSecond
                        : columnMappings.secondToFirst

                const targetColId = mapping[sourceColId as keyof typeof mapping]
                const targetGrid =
                    sourceGrid === "first" ? secondGridRef.current?.api : firstGridRef.current?.api

                if (!targetGrid) return

                const targetColumn = targetGrid.getColumn(targetColId)
                if (targetColumn) {
                    targetGrid.setColumnWidth(targetColumn, sourceColumn.getActualWidth())
                }
            } finally {
                // Reset the flag after a short delay to ensure both grids have updated
                setTimeout(() => {
                    isResizing.current = false
                }, 50)
            }
        },
        [],
    )

    // Specific handlers for each table
    const onFirstTableColumnResized = useCallback(
        (event: ColumnResizedEvent) => {
            handleColumnResize(event, "first")
        },
        [handleColumnResize],
    )

    const onSecondTableColumnResized = useCallback(
        (event: ColumnResizedEvent) => {
            handleColumnResize(event, "second")
        },
        [handleColumnResize],
    )

    return (
        <div className="p-4">
            <div className="mb-8">
                <h3 className="mb-2 text-lg font-semibold">Employee Table</h3>
                <div className="ag-theme-alpine" style={{height: 400, width: "100%"}}>
                    <AgGridReact
                        ref={firstGridRef}
                        rowData={firstTableData}
                        columnDefs={firstTableColumnDefs}
                        onColumnResized={onFirstTableColumnResized}
                    />
                </div>
            </div>

            <div>
                <h3 className="mb-2 text-lg font-semibold">Product Table</h3>
                <div className="ag-theme-alpine" style={{height: 400, width: "100%"}}>
                    <AgGridReact
                        ref={secondGridRef}
                        rowData={secondTableData}
                        columnDefs={secondTableColumnDefs}
                        onColumnResized={onSecondTableColumnResized}
                    />
                </div>
            </div>
        </div>
    )
}

export default SynchronizedTables
