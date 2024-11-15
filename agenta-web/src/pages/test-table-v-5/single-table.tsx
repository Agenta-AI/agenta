import React, {useEffect, useRef, useState} from "react"
import {AgGridReact} from "ag-grid-react"
import "ag-grid-community/styles/ag-grid.css"
import "ag-grid-community/styles/ag-theme-alpine.css"
import {ColDef} from "ag-grid-community"

const SingleTable: React.FC = () => {
    const [rowData, setRowData] = useState<any[]>([])

    const columnDefs: ColDef[] = [
        {field: "athlete"},
        {field: "age"},
        {field: "country"},
        {field: "year"},
        {field: "sport"},
    ]
    useEffect(() => {
        fetch("https://www.ag-grid.com/example-assets/olympic-winners.json")
            .then((response) => response.json())
            .then((data) => setRowData(data.slice(0, 10)))
    }, [])

    return (
        <div className="ag-theme-alpine" style={{height: 400, width: "100%"}}>
            <AgGridReact columnDefs={columnDefs} rowData={rowData} />
        </div>
    )
}

export default SingleTable
