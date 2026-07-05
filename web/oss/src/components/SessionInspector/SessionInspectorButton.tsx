import {Button} from "@agenta/primitive-ui/components/button"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {MagnifyingGlass} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {openSessionInspectorAtom} from "./store"

/** Session-inspector trigger; disabled until a backend session_id exists. */
const SessionInspectorButton = ({sessionId}: {sessionId: string | null}) => {
    const open = useSetAtom(openSessionInspectorAtom)

    const tooltip = sessionId ? "Inspect session" : "Run once to start a session before inspecting"

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        aria-label="Inspect session"
                        disabled={!sessionId}
                        onClick={() => sessionId && open(sessionId)}
                        variant="ghost"
                        size="icon-sm"
                    >
                        {<MagnifyingGlass size={16} />}
                    </Button>
                }
            />
            <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
    )
}

export default SessionInspectorButton
