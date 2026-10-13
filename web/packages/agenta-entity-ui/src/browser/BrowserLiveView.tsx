import {useEffect, useRef} from "react"

import {browserLiveUrl, type BrowserLiveTarget} from "@agenta/entities/browserProfile"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {BrowserLiveSurface} from "./BrowserLiveSurface"
import {useBrowserLiveSocket} from "./useBrowserLiveSocket"

export interface BrowserLiveViewProps {
    target: BrowserLiveTarget
    /** Take control once connected, for a browser that waits on the user. */
    autoTakeControl?: boolean
}

export const BrowserLiveView = ({target, autoTakeControl = false}: BrowserLiveViewProps) => {
    const projectId = useAtomValue(projectIdAtom)
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    // A string, so a new target object with the same ids keeps the socket.
    const url = projectId ? browserLiveUrl(projectId, target) : null
    const {connection, status, notice, send, reconnect} = useBrowserLiveSocket(url, canvasRef)

    const tookControl = useRef(false)
    useEffect(() => {
        if (connection.phase !== "live") tookControl.current = false
        if (!autoTakeControl || tookControl.current || status?.control !== "agent") return
        tookControl.current = true
        send({type: "control", take: true})
    }, [autoTakeControl, connection.phase, status?.control, send])

    return (
        <BrowserLiveSurface
            connection={connection}
            status={status}
            notice={notice}
            canvasRef={canvasRef}
            send={send}
            onReconnect={reconnect}
        />
    )
}
