import {useEffect, useState} from "react"

import {isLiveChatEnabled} from "./crispChat"

/** Client-only gate: it reads `window.__env`, which the server render cannot see. */
export const useLiveChatEnabled = () => {
    const [enabled, setEnabled] = useState(false)
    useEffect(() => setEnabled(isLiveChatEnabled()), [])
    return enabled
}
