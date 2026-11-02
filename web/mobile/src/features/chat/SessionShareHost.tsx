import {useAtom} from "jotai"

import {SessionShareDialogBound} from "./SessionShareDialogBound"
import {shareDialogRequestAtom} from "./shareDialogState"

/**
 * The one Share dialog of the app, for whichever session `shareDialogRequestAtom` names. Mounted
 * once beside the app's providers, so the tab strip and every row menu open the same dialog.
 */
export const SessionShareHost = () => {
    const [request, setRequest] = useAtom(shareDialogRequestAtom)
    if (!request) return null
    return (
        <SessionShareDialogBound
            key={request.sessionId}
            request={request}
            onClose={() => setRequest(null)}
        />
    )
}
