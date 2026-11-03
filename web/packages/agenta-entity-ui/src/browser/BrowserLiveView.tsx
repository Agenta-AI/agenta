import {useRef} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {BrowserLiveSurface} from "./BrowserLiveSurface"
import {browserLiveUrl} from "./live"
import {useBrowserLiveSocket} from "./useBrowserLiveSocket"

export const BrowserLiveView = ({sessionId}: {sessionId: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const url = projectId ? browserLiveUrl(projectId, sessionId) : null
    const {connection, status, notice, viewport, send, reconnect} = useBrowserLiveSocket(
        url,
        canvasRef,
    )

    return (
        <BrowserLiveSurface
            connection={connection}
            status={status}
            notice={notice}
            viewport={viewport}
            canvasRef={canvasRef}
            send={send}
            onReconnect={reconnect}
        />
    )
}
