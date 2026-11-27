import {Button, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {CaretDownIcon} from "@phosphor-icons/react"

/** MICRO-02: the panel unfolds from the trigger's edge, or grows from its own center. */
export function OverlayOriginDemo({fromTrigger}: {fromTrigger: boolean}) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline">
                    Filter
                    <CaretDownIcon className="ag-caret" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-popover-sm p-3 text-body-sm text-muted-foreground"
                style={fromTrigger ? undefined : {transformOrigin: "center"}}
            >
                {fromTrigger
                    ? "Unfolds down out of the Filter button."
                    : "Grows from its own middle, away from the button."}
            </PopoverContent>
        </Popover>
    )
}
