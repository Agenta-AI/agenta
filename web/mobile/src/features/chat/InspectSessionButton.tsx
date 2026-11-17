import {useState} from "react"

import {useT} from "@agenta/i18n"
import chatMobileSessionsCatalog from "@agenta/i18n/catalogs/chat.mobileSessions"
import {playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {MagnifyingGlass} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {SessionInspectorSheet} from "./SessionInspectorSheet"

export const InspectSessionButton = ({sessionId}: {sessionId: string}) => {
    const t = useT(chatMobileSessionsCatalog)
    const inspectorEnabled = useAtomValue(playgroundInspectorEnabledAtom)
    const [open, setOpen] = useState(false)

    if (!inspectorEnabled) return null

    return (
        <>
            <SimpleTooltip title={t("chat.mobileSessions.inspectSession")}>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("chat.mobileSessions.inspectSession")}
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
