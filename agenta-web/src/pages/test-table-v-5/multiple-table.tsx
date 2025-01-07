import React, {useEffect, useRef, useState} from "react"
import {AgGridReact} from "ag-grid-react"
import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"
import {ColDef} from "ag-grid-community"

const columnDefs: ColDef[] = [
    {field: "athlete"},
    {field: "age"},
    {field: "country"},
    {field: "year"},
    {field: "sport"},
]

const MultipleTable: React.FC = () => {
    const [rowData, setRowData] = useState<any[]>([])

    const topGridApiRef = useRef<any>(null)
    const bottomGridApiRef = useRef<any>(null)

    useEffect(() => {
        // Fetching the data from the provided URL
        fetch("https://www.ag-grid.com/example-assets/olympic-winners.json")
            .then((response) => response.json())
            .then((data) => setRowData(data.slice(0, 10)))
    }, [])

    return (
        <div className="flex flex-col gap-2">
            <div id="myGridTop" className="ag-theme-alpine" style={{height: 400, width: "100%"}}>
                <AgGridReact ref={topGridApiRef} columnDefs={columnDefs} rowData={rowData} />
            </div>

            <div id="myGridTop" className="ag-theme-alpine" style={{height: 400, width: "100%"}}>
                <AgGridReact ref={bottomGridApiRef} columnDefs={columnDefs} rowData={rowData} />
            </div>
        </div>
    )
}

export default MultipleTable
