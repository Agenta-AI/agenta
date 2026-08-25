import {configPanelCollapsedAtom} from "@agenta/chat/state"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"
import {ChevronsRight} from "lucide-react"

const LABEL = "Show configuration"

/**
 * The control that brings the collapsed config pane back.
 *
 * Two homes, because the pane can collapse on surfaces that do not all have a tab rail: the rail's
 * `leadingExtra`, where the pane disappeared from, and the workspace top bar on a surface with no
 * rail. It lived only in the rail at first, so hiding the rail took the only way back with it.
 *
 * `labelled` is the difference between those homes, and it is not cosmetic. In the rail the icon
 * sits in a row of controls that explains it; in the top bar it would be a lone chevron against
 * empty canvas, which reads as decoration. Anything a surface offers as its ONLY way back says
 * what it does in words.
 */
export const ConfigRevealButton = ({labelled = false}: {labelled?: boolean}) => {
    const setConfigCollapsed = useSetAtom(configPanelCollapsedAtom)
    const reveal = () => setConfigCollapsed(false)

    if (labelled)
        return (
            <Button variant="outline" size="sm" onClick={reveal} className="gap-1.5">
                <ChevronsRight size={14} />
                Configuration
            </Button>
        )

    return (
        <SimpleTooltip title={LABEL}>
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label={LABEL}
                onClick={reveal}
                className="h-7 w-7 shrink-0 p-0"
            >
                <ChevronsRight size={14} />
            </Button>
        </SimpleTooltip>
    )
}
