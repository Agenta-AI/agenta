/** A right-side check for a plain menu item; invisible but space-keeping when not selected. */
import {Check} from "@phosphor-icons/react"

export const SelectedMark = ({on, className = "ml-auto"}: {on: boolean; className?: string}) => (
    <Check
        aria-hidden
        className={`size-4 shrink-0 ${className} ${on ? "text-colorText" : "invisible"}`}
    />
)
