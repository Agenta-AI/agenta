import {configPanelCollapsedAtom} from "@agenta/chat/state"
import {useSetAtom} from "jotai"
import {ChevronsRight} from "lucide-react"

/**
 * The collapsed config pane, as a rail rather than as nothing.
 *
 * A collapsed pane on a wide screen leaves an empty column where it used to be, and a bare chevron
 * floating in it reads as decoration. The rail keeps that column occupied by the pane's own edge:
 * it says "Configuration", it sits exactly where the pane expands from, and the whole strip is the
 * target rather than a 28px glyph.
 *
 * Borders are longhand (`border-y-0 border-l-0 border-r`): the `border-0 border-b` shorthand needs
 * shorthand-before-longhand ordering, which mobile's Tailwind v4 does not guarantee. `box-border`
 * for the same reason the shared kit needs it — preflight is off, so a plain element is
 * content-box and the border would widen the rail past its track.
 */
export const CollapsedConfigRail = () => {
    const setConfigCollapsed = useSetAtom(configPanelCollapsedAtom)

    return (
        <button
            type="button"
            aria-label="Show configuration"
            aria-expanded={false}
            onClick={() => setConfigCollapsed(false)}
            className="border-border hover:bg-accent group box-border flex h-full w-11 shrink-0 cursor-pointer flex-col items-center gap-3 border-y-0 border-l-0 border-r border-solid bg-transparent px-0 pt-3 transition-colors"
        >
            <ChevronsRight
                size={14}
                className="text-muted-foreground group-hover:text-foreground shrink-0"
            />
            <span className="text-muted-foreground group-hover:text-foreground text-xs tracking-wide [writing-mode:vertical-rl]">
                Configuration
            </span>
        </button>
    )
}
