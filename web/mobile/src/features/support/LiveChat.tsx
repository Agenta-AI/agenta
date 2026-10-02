import {useEffect} from "react"

import {loadLiveChat} from "./crispChat"
import {useLiveChatEnabled} from "./useLiveChatEnabled"

/** Loads Crisp once, app-wide; the sidebar's icon opens it. Renders nothing. */
export const LiveChat = () => {
    const enabled = useLiveChatEnabled()
    useEffect(() => {
        if (enabled) void loadLiveChat()
    }, [enabled])

    return null
}
