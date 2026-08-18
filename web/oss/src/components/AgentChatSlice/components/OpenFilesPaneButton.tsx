/**
 * The session bar's Files-pane opener — mirrors the config panel's collapse pair: "«" while the
 * pane is hidden (it expands leftward from the right edge), gone while shown (the pane header's
 * own "»" is the collapse, so a second chevron in the bar would be a duplicate).
 */
import {CaretDoubleLeft} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"

import {useSessionFilesPane} from "@/oss/components/Drives/SessionFilesPane"

export default function OpenFilesPaneButton({sessionId}: {sessionId: string | null}) {
    const {open, openPane} = useSessionFilesPane(sessionId ?? "")

    if (open) return null

    return (
        // placement="left": the button hugs the page's right edge, and a top-centered tooltip
        // overflows the viewport for a frame (horizontal-scrollbar flicker).
        <Tooltip title="Show files" placement="left">
            <Button
                type="text"
                size="small"
                icon={<CaretDoubleLeft size={14} />}
                disabled={!sessionId}
                onClick={openPane}
                aria-label="Show files pane"
            />
        </Tooltip>
    )
}
