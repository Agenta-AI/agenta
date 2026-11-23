import {Button, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {CaretDownIcon} from "@phosphor-icons/react"

const items = ["Newest first", "Oldest first", "Name"]

/** MICRO-01: the trigger's caret turns while the menu is open (`ag-caret`), or stays still. */
export function CaretTurnDemo({turns}: {turns: boolean}) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline">
                    Sort
                    <CaretDownIcon className={turns ? "ag-caret" : undefined} />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-popover-sm p-1">
                {items.map((item) => (
                    <div key={item} className="flex h-8 items-center rounded-sm px-2 text-label hover:bg-accent">
                        {item}
                    </div>
                ))}
            </PopoverContent>
        </Popover>
    )
}
