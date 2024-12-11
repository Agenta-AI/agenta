import React from "react"
import TestsetTable from "@/components/TestSetTable/TestsetTable"
import "@ag-grid-community/styles/ag-grid.css"
import "@ag-grid-community/styles/ag-theme-alpine.css"

const testsetDisplay = () => {
    return <TestsetTable mode="edit" />
}

export default testsetDisplay
