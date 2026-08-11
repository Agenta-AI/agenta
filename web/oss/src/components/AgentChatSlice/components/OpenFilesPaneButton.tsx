/**
 * The session bar's Files-pane toggle — mirrors the config panel's collapse pair: "«" while the
 * pane is hidden (it expands leftward from the right edge), "»" while shown (clicking tucks it
 * back). The pane's own header "»" is the same collapse, reachable from the other end.
 */
import {CaretDoubleLeft, CaretDoubleRight} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"

import {useSessionFilesPane} from "@/oss/components/Drives/SessionFilesPane"

export default function OpenFilesPaneButton({sessionId}: {sessionId: string | null}) {
    const {open, toggle} = useSessionFilesPane(sessionId ?? "")

    return (
        <Tooltip title={open ? "Hide files" : "Show files"}>
            <Button
                type="text"
                size="small"
                icon={open ? <CaretDoubleRight size={14} /> : <CaretDoubleLeft size={14} />}
                disabled={!sessionId}
                onClick={toggle}
                aria-label={open ? "Hide files pane" : "Show files pane"}
                aria-pressed={open}
            />
        </Tooltip>
    )
}
