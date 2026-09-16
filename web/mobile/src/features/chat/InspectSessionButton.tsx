import {useState} from "react"

import {playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {MagnifyingGlass} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {SessionInspectorSheet} from "./SessionInspectorSheet"

export const InspectSessionButton = ({sessionId}: {sessionId: string}) => {
    const inspectorEnabled = useAtomValue(playgroundInspectorEnabledAtom)
    const [open, setOpen] = useState(false)

    if (!inspectorEnabled) return null

    return (
        <>
            <SimpleTooltip title="Inspect session">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Inspect session"
                    onClick={() => setOpen(true)}
                    className="h-7 w-7 shrink-0 p-0"
                >
                    <MagnifyingGlass size={14} />
                </Button>
            </SimpleTooltip>
            <SessionInspectorSheet sessionId={sessionId} open={open} onOpenChange={setOpen} />
        </>
    )
}
