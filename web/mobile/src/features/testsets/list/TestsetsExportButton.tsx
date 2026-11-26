import {useState} from "react"

import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretDown, DownloadSimple, FileCsv, FileJs} from "@phosphor-icons/react"

import type {TestsetExportFormat} from "./testsetRowTypes"

/**
 * Export for the selected test sets, as a split button: the main part uses the last format the
 * reader chose (CSV at first), the arrow offers CSV or JSON. Each test set saves as its own file.
 */
export const TestsetsExportButton = ({
    disabled,
    onExport,
}: {
    disabled: boolean
    onExport: (format: TestsetExportFormat) => void
}) => {
    const [format, setFormat] = useState<TestsetExportFormat>("csv")
    const exportAs = (next: TestsetExportFormat) => {
        setFormat(next)
        onExport(next)
    }

    return (
        // One control in two parts: the seam between them is a single border.
        <span className="inline-flex [&>*:first-child]:rounded-r-none [&>*:last-child]:-ml-px [&>*:last-child]:rounded-l-none">
            <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() => exportAs(format)}
            >
                <DownloadSimple aria-hidden data-icon="inline-start" />
                Export {format.toUpperCase()}
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon-xs"
                        variant="outline"
                        aria-label="Choose the export format"
                        disabled={disabled}
                    >
                        <CaretDown aria-hidden />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[180px]">
                    <DropdownMenuItem onSelect={() => exportAs("csv")}>
                        <FileCsv aria-hidden size={14} />
                        Export as CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => exportAs("json")}>
                        <FileJs aria-hidden size={14} />
                        Export as JSON
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </span>
    )
}
