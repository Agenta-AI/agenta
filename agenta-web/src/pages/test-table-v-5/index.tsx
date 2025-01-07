import React from "react"
import SingleTable from "./single-table"
import MultipleTable from "./multiple-table"
import SyncTable from "./sync-table"
import SyncTableWithDifferentColumn from "./sync-table-with-different-columns"
import SyncTableWithEmptyColumn from "./sync-table-with-empty-columns"
import SyncTableWithHideColumn from "./sync-table-with-hide-columns"
import SyncTableWithMergingColumns from "./sync-table-merging-columns"
import SyncTableWithMergingColumnsSize from "./sync-table-merging-columns-size"

const index = () => {
    return (
        <div className="flex flex-col gap-10">
            <div className="flex flex-col gap-2">
                <h3>Single Table</h3>
                <SingleTable />
            </div>

            <div className="flex flex-col gap-2">
                <h3>Multiple Table</h3>
                <MultipleTable />
            </div>

            <div className="flex flex-col gap-2">
                <h3>Sync Table</h3>
                <SyncTable />
            </div>

            <div className="flex flex-col gap-2">
                <h3>Sync Table With Different Columns</h3>
                <SyncTableWithDifferentColumn />
            </div>

            <div className="flex flex-col gap-2">
                <h3>Sync Table With Empty Columns</h3>
                <SyncTableWithEmptyColumn />
            </div>

            <div className="flex flex-col gap-2">
                <h3>Sync Table With Hide Columns</h3>
                <SyncTableWithHideColumn />
            </div>

            <div className="flex flex-col gap-2">
                <h3>Sync Table With Merging Columns</h3>
                <SyncTableWithMergingColumns />
            </div>
            <div className="flex flex-col gap-2">
                <h3>Sync Table With Merging Columns Size</h3>
                <SyncTableWithMergingColumnsSize />
            </div>
        </div>
    )
}

export default index
