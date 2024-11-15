import React, {useCallback, useMemo, useRef, useState} from "react"
import {AgGridReact} from "ag-grid-react"
import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"
import {
    ClientSideRowModelModule,
    ColDef,
    ColGroupDef,
    ColSpanParams,
    GridReadyEvent,
    ModuleRegistry,
    SizeColumnsToFitGridStrategy,
} from "ag-grid-community"

// Register AG Grid Modules
ModuleRegistry.registerModules([ClientSideRowModelModule])

// Interface for Olympic Data
interface IOlympicData {
    athlete: string
    age: number
    country: string
    year: number
    sport: string
    gold: number
    silver: number
    bronze: number
    total: number
}

const SyncTableWithMergingColumns = () => {
    const topGrid = useRef<AgGridReact>(null)
    const bottomGrid = useRef<AgGridReact>(null)

    const topColumnDefs = useMemo<(ColDef | ColGroupDef)[]>(
        () => [
            {
                headerName: "Athlete Details",
                children: [
                    {
                        field: "athlete",
                        width: 150,
                        suppressSizeToFit: true,
                    },
                    {field: "age", width: 90},
                ],
            },
            {field: "sport"},
            {
                headerName: "History",
                children: [
                    {
                        field: "country",
                        suppressSizeToFit: true,
                    },
                    {field: "year"},
                ],
            },
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
            {
                headerName: "Employ detailes",
                children: [
                    {
                        field: "athlete",
                        width: 150,
                        suppressSizeToFit: true,
                    },
                    {field: "age", width: 90},
                ],
            },
            {headerName: "Education", field: "sport"},

            {
                field: "country",
            },
            {field: "year"},
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

    const [rowData, setRowData] = useState<IOlympicData[]>([])

    const autoSizeStrategy = useMemo<SizeColumnsToFitGridStrategy>(
        () => ({
            type: "fitGridWidth",
        }),
        [],
    )

    const onGridReady = useCallback((params: GridReadyEvent) => {
        fetch("https://www.ag-grid.com/example-assets/olympic-winners.json")
            .then((response) => response.json())
            .then((data) => setRowData(data.slice(0, 50)))
    }, [])

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
                    headerHeight={0}
                    groupHeaderHeight={48}
                />
            </div>

            <div className="ag-theme-alpine" style={{height: 500}}>
                <AgGridReact
                    ref={bottomGrid}
                    alignedGrids={[topGrid]}
                    rowData={rowData.slice(10, 20)}
                    columnDefs={bottomColumnDefs}
                    defaultColDef={defaultColDef}
                    autoSizeStrategy={autoSizeStrategy}
                    onGridReady={onGridReady}
                    suppressMovableColumns={true}
                    headerHeight={0}
                    groupHeaderHeight={48}
                />
            </div>
        </div>
    )
}

export default SyncTableWithMergingColumns
