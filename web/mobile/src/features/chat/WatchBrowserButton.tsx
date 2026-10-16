import {useState} from "react"

import {browserLiveStatusQueryAtomFamily} from "@agenta/entities/browser"
import {BrowserLiveDialog} from "@agenta/entity-ui/browser"
import {Button} from "@agenta/ui/ui"
import {Globe} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

export const WatchBrowserButton = ({sessionId}: {sessionId: string}) => {
    const running = useAtomValue(browserLiveStatusQueryAtomFamily(sessionId)).data?.running
    const [open, setOpen] = useState(false)
    if (!running && !open) return null

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
