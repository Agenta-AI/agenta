/** A part's heading in an item view: the label, and its note behind the kit's field help. */
import {FieldHelp} from "@agenta/ui/ui"

/** Canvas F02 f6, F03 f7: 13/20/600. The note opens on hover, focus or a tap. */
export function FieldHeading({label, note}: {label: string; note: string}) {
    return (
        <div className="flex items-center gap-1">
            <span className="text-label font-semibold leading-5 text-foreground">{label}</span>
            <FieldHelp label={note}>{note}</FieldHelp>
        </div>
    )
}
