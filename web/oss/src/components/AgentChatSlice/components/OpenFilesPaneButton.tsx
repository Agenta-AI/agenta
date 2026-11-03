import {FilesPaneToggle} from "@agenta/entity-ui/drive"

import {useSessionFilesPane} from "@/oss/components/Drives/SessionFilesPane"

export default function OpenFilesPaneButton({sessionId}: {sessionId: string | null}) {
    const {open, toggle} = useSessionFilesPane(sessionId ?? "")
    // The button hugs the page's right edge, where a top-centred tooltip overflows the viewport
    // for a frame and flickers a horizontal scrollbar.
    return (
        <FilesPaneToggle open={open} onToggle={toggle} disabled={!sessionId} tooltipSide="left" />
    )
}
