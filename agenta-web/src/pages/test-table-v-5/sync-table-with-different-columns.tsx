import React, {useMemo, useRef, useState} from "react"
import {AgGridReact} from "ag-grid-react"
import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"
import {
    ClientSideRowModelModule,
    ColDef,
    ColGroupDef,
    ModuleRegistry,
    SizeColumnsToFitGridStrategy,
} from "ag-grid-community"

ModuleRegistry.registerModules([ClientSideRowModelModule])

const SyncTableWithDifferentColumn: React.FC = () => {
    const topGrid = useRef<AgGridReact>(null)
    const bottomGrid = useRef<AgGridReact>(null)

    const topColumnDefs = useMemo<(ColDef | ColGroupDef)[]>(
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
                        colId: "total",
                        columnGroupShow: "closed",
                        valueGetter: "data.gold + data.silver + data.bronze",
                    },
                    {columnGroupShow: "open", field: "gold"},
                    {columnGroupShow: "open", field: "silver"},
                    {columnGroupShow: "open", field: "bronze"},
                ],
            },
        ],
        [],
    )

    const bottomColumnDefs = useMemo<(ColDef | ColGroupDef)[]>(
        () => [
            {headerName: "Name", field: "athlete"},
            {headerName: "Email", field: "age"},
            {headerName: "Job", field: "country"},
            {headerName: "Experiance", field: "year"},
            {headerName: "Education", field: "sport"},
            {
                headerName: "Skills",
                children: [
                    {
                        colId: "total",
                        columnGroupShow: "closed",
                        valueGetter: "data.gold + data.silver + data.bronze",
                    },
                    {columnGroupShow: "open", field: "gold"},
                    {columnGroupShow: "open", field: "silver"},
                    {columnGroupShow: "open", field: "bronze"},
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

    const onGridReady = () => {
        fetch("https://www.ag-grid.com/example-assets/olympic-winners.json")
            .then((resp) => resp.json())
            .then((data) => setRowData(data.slice(0, 50)))
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="ag-theme-alpine" style={{height: 500}}>
                <AgGridReact
                    ref={topGrid}
                    alignedGrids={[bottomGrid]}
                    rowData={rowData.slice(0, 10)}
                    columnDefs={topColumnDefs}
                    defaultColDef={defaultColDef}
                    autoSizeStrategy={autoSizeStrategy}
                    onGridReady={onGridReady}
                    suppressMovableColumns={true}
                />
            </div>
            <div className="ag-theme-alpine" style={{height: 500}}>
                <AgGridReact
                    ref={bottomGrid}
                    alignedGrids={[topGrid]}
                    rowData={rowData.slice(20, 30)}
                    columnDefs={bottomColumnDefs}
                    defaultColDef={defaultColDef}
                    suppressMovableColumns={true}
                />
            </div>
        </div>
    )
}

export default SyncTableWithDifferentColumn
