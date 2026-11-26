/** A part's heading in an item view: the label, and its note behind an info icon. */
import {SimpleTooltip} from "@agenta/ui/ui"
import {Info} from "@phosphor-icons/react"

/** Canvas F02 f6, F03 f7: 13/20/600. The note opens on hover or keyboard focus. */
export function FieldHeading({label, note}: {label: string; note: string}) {
    return (
        <div className="flex items-center gap-1">
            <span className="text-label font-semibold leading-5 text-foreground">{label}</span>
            <SimpleTooltip title={note}>
                <button
                    type="button"
                    aria-label={note}
                    className="inline-flex size-5 cursor-help items-center justify-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-foreground focus-ring"
                >
                    <Info size={14} aria-hidden />
                </button>
            </SimpleTooltip>
        </div>
    )
}
