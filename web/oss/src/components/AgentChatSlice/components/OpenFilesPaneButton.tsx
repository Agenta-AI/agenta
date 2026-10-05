import {FilesPaneToggle} from "@agenta/entity-ui/drive"

import {useSessionFilesPane} from "@/oss/components/Drives/SessionFilesPane"

export default function OpenFilesPaneButton({sessionId}: {sessionId: string | null}) {
    const {open, toggle} = useSessionFilesPane(sessionId ?? "")
    return <FilesPaneToggle open={open} onToggle={toggle} disabled={!sessionId} />
}
