import React, {useCallback, useRef} from "react"
import {AgGridReact} from "ag-grid-react"
import {ColDef, ColumnResizedEvent, GridReadyEvent, GridApi} from "ag-grid-community"
import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"

interface TableConfig {
    id: string
    data: any[]
    columnDefs: ColDef[]
    title: string
}

interface SynchronizedTablesProps {
    tables: TableConfig[]
    columnMappings: Record<string, Record<string, string>>
}

const SynchronizedTables: React.FC<SynchronizedTablesProps> = ({tables, columnMappings}) => {
    const gridRefs = useRef<Map<string, AgGridReact>>(new Map())
    const isResizing = useRef(false)

    // Register grid reference
    const registerGridRef = (tableId: string, ref: AgGridReact) => {
        if (ref) {
            gridRefs.current.set(tableId, ref)
        }
    }

    // Get all grid APIs except the source
    const getOtherGridApis = (sourceTableId: string): GridApi[] => {
        const apis: GridApi[] = []
        gridRefs.current.forEach((gridRef, tableId) => {
            if (tableId !== sourceTableId && gridRef.api) {
                apis.push(gridRef.api)
            }
        })
        return apis
    }

    // Handle column resize for any table
    const handleColumnResize = useCallback(
        (event: ColumnResizedEvent, sourceTableId: string) => {
            if (event.finished || isResizing.current) return

            const sourceColumn = event.column
            if (!sourceColumn) return

            try {
                isResizing.current = true
                const sourceColId = sourceColumn.getColId()
                const newWidth = sourceColumn.getActualWidth()

                // Get all other grid APIs
                const otherGridApis = getOtherGridApis(sourceTableId)

                // Update each grid's column width
                otherGridApis.forEach((targetGrid) => {
                    // Get mapping for target table
                    const targetMapping = columnMappings[sourceTableId]
                    if (!targetMapping) return

                    const targetColId = targetMapping[sourceColId]
                    if (!targetColId) return

                    const targetColumn = targetGrid.getColumn(targetColId)
                    if (targetColumn) {
                        targetGrid.setColumnWidth(targetColumn, newWidth)
                    }
                })
            } finally {
                setTimeout(() => {
                    isResizing.current = false
                }, 50)
            }
        },
        [columnMappings],
    )

    return (
        <div className="p-4">
            {tables.map((table) => (
                <div key={table.id} className="mb-8">
                    <h3 className="mb-2 text-lg font-semibold">{table.title}</h3>
                    <div className="ag-theme-alpine" style={{height: 400, width: "100%"}}>
                        <AgGridReact
                            ref={(ref) => registerGridRef(table.id, ref as AgGridReact)}
                            rowData={table.data}
                            columnDefs={table.columnDefs}
                            onColumnResized={(e) => handleColumnResize(e, table.id)}
                        />
                    </div>
                </div>
            ))}
        </div>
    )
}

// Example usage
const App: React.FC = () => {
    const tables: TableConfig[] = [
        {
            id: "employees",
            title: "Employee Table",
            data: [
                {employeeId: 1, firstName: "John Doe", salary: 50000, department: "IT"},
                {employeeId: 2, firstName: "Jane Smith", salary: 60000, department: "HR"},
            ],
            columnDefs: [
                {field: "employeeId", headerName: "Employee ID", resizable: true, minWidth: 100},
                {field: "firstName", headerName: "First Name", resizable: true, minWidth: 150},
                {field: "salary", headerName: "Salary", resizable: true, minWidth: 100},
                {field: "department", headerName: "Department", resizable: true, minWidth: 150},
            ],
        },
        {
            id: "products",
            title: "Product Table",
            data: [
                {productId: 101, productName: "Laptop", price: 1200, category: "Electronics"},
                {productId: 102, productName: "Desk Chair", price: 300, category: "Furniture"},
            ],
            columnDefs: [
                {field: "productId", headerName: "Product ID", resizable: true, minWidth: 100},
                {field: "productName", headerName: "Product Name", resizable: true, minWidth: 150},
                {field: "price", headerName: "Price", resizable: true, minWidth: 100},
                {field: "category", headerName: "Category", resizable: true, minWidth: 150},
            ],
        },
    ]

    const columnMappings = {
        employees: {
            employeeId: "productId",
            firstName: "productName",
            salary: "price",
            department: "category",
        },
        products: {
            productId: "employeeId",
            productName: "firstName",
            price: "salary",
            category: "department",
        },
    }

    return <SynchronizedTables tables={tables} columnMappings={columnMappings} />
}

export default App


//    const handleColumnResize = useCallback(
//        (event: ColumnResizedEvent, sourceTableId: string) => {
//            // Exit early if resize is complete or already in progress
//            if (event.finished || isResizing.current) return

//            const sourceColumn = event.column
//            if (!sourceColumn) return

//            isResizing.current = true

//            const sourceGridRef = gridRefs.current.get(sourceTableId)
//            if (!sourceGridRef || !sourceGridRef.api) return

//            const sourceColumnId = sourceColumn.getId()
//            const newWidth = sourceColumn.getActualWidth()
//            console.log(newWidth)
//            // Loop through each grid to update the width at the specific column index
//            gridRefs.current.forEach((gridRef, tableId) => {
//                if (tableId === sourceTableId || !gridRef.api) return

//                const targetGridApi = gridRef.api as GridApi
//                const targetColumns = targetGridApi.getColumns()

//                // Get the source column index only once for all grids
//                const sourceIndex = targetColumns?.findIndex((col) => col.getId() === sourceColumnId)
//                if (sourceIndex === -1 || sourceIndex === undefined) return

//                // Use column state to directly set the width for the specific column
//                const targetColumnState = targetGridApi.getColumnState()
//                if (sourceIndex < targetColumnState.length) {
//                    targetColumnState[sourceIndex].width = newWidth
//                    targetGridApi.applyColumnState({state: targetColumnState, applyOrder: false})
//                }
//            })

//            isResizing.current = false
//        },
//        [gridRefs],
//    )
