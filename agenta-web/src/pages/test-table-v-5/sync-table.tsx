import React, {useMemo, useRef, useState} from "react"
import {AgGridReact} from "ag-grid-react"
import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"
import {
    ClientSideRowModelModule,
    ColDef,
    ColGroupDef,
    GridReadyEvent,
    ModuleRegistry,
    SizeColumnsToFitGridStrategy,
} from "ag-grid-community"

ModuleRegistry.registerModules([ClientSideRowModelModule])

const SyncTable = () => {
    const topGrid = useRef<AgGridReact>(null)
    const bottomGrid = useRef<AgGridReact>(null)

    const columnDefs = useMemo<(ColDef | ColGroupDef)[]>(
        () => [
            {field: "athlete"},
            {field: "age"},
            {field: "country"},
            {field: "year"},
            {field: "sport"},
            {
                headerName: "Medals",
                children: [
                    {
                        columnGroupShow: "closed",
                        colId: "total",
                        valueGetter: "data.gold + data.silver + data.bronze",
                        width: 200,
                    },
                    {columnGroupShow: "open", field: "gold", width: 100},
                    {columnGroupShow: "open", field: "silver", width: 100},
                    {columnGroupShow: "open", field: "bronze", width: 100},
                ],
            },
        ],
        [],
    )

    const defaultColDef = useMemo<ColDef>(
        () => ({
            minWidth: 100,
        }),
        [],
    )

    const [rowData, setRowData] = useState([])

    const autoSizeStrategy = useMemo<SizeColumnsToFitGridStrategy>(
        () => ({
            type: "fitGridWidth",
        }),
        [],
    )

    const onGridReady = (params: GridReadyEvent) => {
        fetch("https://www.ag-grid.com/example-assets/olympic-winners.json")
            .then((resp) => resp.json())
            .then((data) => setRowData(data))
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="ag-theme-alpine" style={{height: 400, width: "100%"}}>
                <AgGridReact
                    ref={topGrid}
                    alignedGrids={[bottomGrid]}
                    rowData={rowData.slice(20, 30)}
                    columnDefs={columnDefs}
                    defaultColDef={defaultColDef}
                    autoSizeStrategy={autoSizeStrategy}
                    onGridReady={onGridReady}
                    suppressMovableColumns={true}
                />
            </div>

            <div className="ag-theme-alpine" style={{height: 400, width: "100%"}}>
                <AgGridReact
                    ref={bottomGrid}
                    alignedGrids={[topGrid]}
                    rowData={rowData.slice(0, 10)}
                    columnDefs={columnDefs}
                    defaultColDef={defaultColDef}
                    suppressMovableColumns={true}
                />
            </div>
        </div>
    )
}

export default SyncTable
