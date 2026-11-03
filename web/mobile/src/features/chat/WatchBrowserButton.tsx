import {useEffect, useRef, useState} from "react"

import {browserLiveStatusQueryAtomFamily} from "@agenta/entities/browser"
import {BrowserLiveDialog} from "@agenta/entity-ui/browser"
import {Button} from "@agenta/ui/ui"
import {Globe} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useLivenessPoll} from "../sessions/useLivenessPoll"

const TURN_POLL_MS = 10_000

export const WatchBrowserButton = ({
    sessionId,
    projectId,
}: {
    sessionId: string
    projectId: string
}) => {
    const turnRunning = Boolean(
        useLivenessPoll(projectId).data?.find((stream) => stream.session_id === sessionId)?.flags
            ?.is_running,
    )
    const {data, refetch} = useAtomValue(browserLiveStatusQueryAtomFamily(sessionId))
    const [open, setOpen] = useState(false)

    // Only a turn starts or stops the browser: poll while one runs, and read once more when it ends.
    const wasRunning = useRef(turnRunning)
    useEffect(() => {
        const ended = wasRunning.current && !turnRunning
        wasRunning.current = turnRunning
        if (ended) void refetch()
        if (!turnRunning) return
        const timer = setInterval(() => void refetch(), TURN_POLL_MS)
        return () => clearInterval(timer)
    }, [turnRunning, refetch])

    if (!data?.running && !open) return null

    return (
        <>
            <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                aria-label="Watch browser"
                onClick={() => setOpen(true)}
            >
                <Globe size={14} />
                <span className="hidden sm:inline">Watch browser</span>
            </Button>
            <BrowserLiveDialog
                open={open}
                onOpenChange={setOpen}
                title="Agent browser"
                description="Watch the agent work. Take control to use the browser yourself."
                sessionId={sessionId}
            />
        </>
    )
}
