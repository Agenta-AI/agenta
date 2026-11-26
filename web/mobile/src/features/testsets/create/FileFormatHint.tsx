import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {Info} from "@phosphor-icons/react"

/** The "CSV and JSON formats are supported" line, with a popover that says what each format needs. */
export const FileFormatHint = () => (
    <p className="m-0 flex items-center justify-center gap-1 text-xs text-muted-foreground">
        CSV and JSON formats are supported
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label="File format requirements"
                    className="inline-flex cursor-pointer items-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                >
                    <Info aria-hidden size={14} />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 text-xs">
                <p className="m-0 mb-2 font-semibold text-foreground">File format requirements</p>
                <p className="m-0 font-medium text-foreground">CSV:</p>
                <ul className="m-0 mb-2 pl-4 text-muted-foreground">
                    <li>Comma-separated values</li>
                    <li>First row must be headers</li>
                </ul>
                <p className="m-0 font-medium text-foreground">JSON:</p>
                <ul className="m-0 pl-4 text-muted-foreground">
                    <li>Array of objects</li>
                    <li>Each object has column names as keys</li>
                </ul>
            </PopoverContent>
        </Popover>
    </p>
)
