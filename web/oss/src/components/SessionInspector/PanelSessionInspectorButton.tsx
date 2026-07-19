import {useEffect, useState} from "react"

import {executionController} from "@agenta/playground"
import {MagnifyingGlass} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useAtomValue} from "jotai"

import {InspectorDrawer} from "@/oss/components/AgentChatSlice/components/Inspector/InspectorDrawer"

/** Compare-column inspect: resolves the panel's read-back backend session_id, then opens the
 * unified Inspector in a floating drawer (session scope). */
const PanelSessionInspectorButton = ({entityId}: {entityId: string}) => {
    const loadableId = useAtomValue(executionController.selectors.derivedLoadableId)
    const backendSessionId = useAtomValue(
        executionController.selectors.backendSessionId(loadableId ?? "", `sess:${entityId}`),
    )
    const [open, setOpen] = useState(false)
    // If the session goes invalid while the drawer is open, close it (letting it animate out) rather
    // than unmounting mid-flight; also resets `open` so it can't silently reappear if the id returns.
    useEffect(() => {
        if (!backendSessionId) setOpen(false)
    }, [backendSessionId])
    return (
        <>
            <Tooltip title="Inspect session">
                <Button
                    type="text"
                    size="small"
                    icon={<MagnifyingGlass size={14} />}
                    disabled={!backendSessionId}
                    onClick={() => setOpen(true)}
                    aria-label="Inspect session"
                />
            </Tooltip>
            {backendSessionId ? (
                <InspectorDrawer
                    sessionId={backendSessionId}
                    open={open}
                    onClose={() => setOpen(false)}
                />
            ) : null}
        </>
    )
}

export default PanelSessionInspectorButton
