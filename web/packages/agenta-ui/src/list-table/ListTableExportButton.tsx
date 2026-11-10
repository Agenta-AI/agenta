import {Download} from "lucide-react"

import {Button} from "../components/ui/button"

import {downloadCsv, listTableToCsv} from "./csv"
import type {ListTableCsvColumn} from "./types"

/**
 * Saves the rows the list passes as a CSV file. For the toolbar's `actions` slot, or the
 * selection bar's bulk actions with the selected rows. Disabled when there is nothing to save.
 */
export const ListTableExportButton = <Row,>({
    rows,
    columns,
    fileName,
    label = "Export CSV",
    className,
}: {
    rows: readonly Row[]
    columns: ListTableCsvColumn<Row>[]
    /** `.csv` is added when missing. */
    fileName: string
    label?: string
    className?: string
}) => (
    <Button
        type="button"
        variant="outline"
        size="sm"
        className={className}
        disabled={rows.length === 0}
        onClick={() => downloadCsv(fileName, listTableToCsv(rows, columns))}
    >
        <Download aria-hidden data-icon="inline-start" />
        {label}
    </Button>
)
