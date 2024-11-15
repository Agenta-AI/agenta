import React, {useCallback, useRef} from "react"
import {AgGridReact} from "ag-grid-react"
import {ColDef, ColumnResizedEvent, GridApi} from "ag-grid-community"
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
}

const SynchronizedTables: React.FC<SynchronizedTablesProps> = ({tables}) => {
    const gridRefs = useRef<Map<string, AgGridReact>>(new Map())
    const isResizing = useRef(false)

    // Register grid reference
    const registerGridRef = (tableId: string, ref: AgGridReact) => {
        if (ref) {
            gridRefs.current.set(tableId, ref)
        }
    }

    const getOtherGridApis = (sourceTableId: string): GridApi[] => {
        const apis: GridApi[] = []
        gridRefs.current.forEach((gridRef, tableId) => {
            if (tableId !== sourceTableId && gridRef.api) {
                apis.push(gridRef.api)
            }
        })
        return apis
    }

    // Handle column resize
   const handleColumnResize = useCallback(
       (event: ColumnResizedEvent, sourceTableId: string) => {
           // Early exit if resize is finished or already in progress
           if (event.finished || isResizing.current) return

           const sourceColumn = event.column
           if (!sourceColumn) return

           isResizing.current = true

           const sourceGridRef = gridRefs.current.get(sourceTableId)
           if (!sourceGridRef || !sourceGridRef.api) return

           const sourceColumnId = sourceColumn.getId()
           const newWidth = sourceColumn.getActualWidth()

           // Retrieve the source grid's columns only once to get the source index
           const sourceIndex = sourceGridRef.api
               .getColumns()
               ?.findIndex((col) => col.getId() === sourceColumnId)

           // Ensure sourceIndex is valid
           if (sourceIndex === -1 || sourceIndex === undefined) return

           // Loop through each grid to update the width at the specific column index
           gridRefs.current.forEach((gridRef, tableId) => {
               if (tableId === sourceTableId || !gridRef.api) return

               const targetGridApi = gridRef.api as GridApi
               const targetColumnState = targetGridApi.getColumnState()

               // Ensure the target grid has a column at the same index
               if (sourceIndex < targetColumnState.length) {
                   // Update the width for the specific column index
                   targetColumnState[sourceIndex] = {
                       ...targetColumnState[sourceIndex],
                       width: newWidth,
                   }
                   targetGridApi.applyColumnState({state: targetColumnState, applyOrder: false})
               }
           })

           isResizing.current = false
       },
       [gridRefs],
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
                            suppressMovableColumns={true}
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

    return <SynchronizedTables tables={tables} />
}

export default App
