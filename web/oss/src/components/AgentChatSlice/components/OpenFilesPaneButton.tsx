/**
 * The session bar's Files-pane opener — mirrors the config panel's collapse pair: "«" while the
 * pane is hidden (it expands leftward from the right edge), gone while shown (the pane header's
 * own "»" is the collapse, so a second chevron in the bar would be a duplicate).
 */
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {CaretDoubleLeft} from "@phosphor-icons/react"

import {useSessionFilesPane} from "@/oss/components/Drives/SessionFilesPane"

export default function OpenFilesPaneButton({sessionId}: {sessionId: string | null}) {
    const {open, openPane} = useSessionFilesPane(sessionId ?? "")

    if (open) return null

    return (
        // side="left": the button hugs the page's right edge, and a top-centered tooltip
        // overflows the viewport for a frame (horizontal-scrollbar flicker).
        <SimpleTooltip
            title={
                <span className="flex items-center gap-1.5">
                    Show files <ShortcutKeys id="panel.files" tone="inverse" />
                </span>
            }
            side="left"
        >
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Show files pane"
                disabled={!sessionId}
                onClick={openPane}
                className="h-7 w-7 shrink-0 p-0"
            >
                <CaretDoubleLeft size={14} />
            </Button>
        </SimpleTooltip>
    )
}
