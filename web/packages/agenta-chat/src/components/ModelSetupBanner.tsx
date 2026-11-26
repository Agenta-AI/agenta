import {useEffect, useState} from "react"

import {agentNeedsSetupTitle, modelNeedsSetupMessage} from "@agenta/entity-ui/needs-setup"
import {useT} from "@agenta/i18n"
import chatModelSetupBannerCatalog from "@agenta/i18n/catalogs/chat.modelSetupBanner"
import {Button} from "@agenta/ui/ui"
import {WarningIcon} from "@phosphor-icons/react"

import {useAgentModelSetup} from "../hooks/useAgentModelSetup"

import RevealCollapse from "./RevealCollapse"

export interface ModelSetupBannerProps {
    /** The saved agent revision the server checked. */
    revisionId: string
    /** Opens the model picker. Omitted, or a viewer who cannot fix it, shows no button. */
    onSetUp?: () => void
}

/**
 * The one banner the needs-setup check raises, and only for a model item. Tools, MCP servers,
 * secrets and app connections never reach it: they show a tag on their own card.
 */
export const ModelSetupBanner = ({revisionId, onSetUp}: ModelSetupBannerProps) => {
    const t = useT(chatModelSetupBannerCatalog)
    const {blocked, canFix, answered} = useAgentModelSetup(revisionId)
    // The first answer shows at once: a slide then would move the chat after it painted.
    const [settledFor, setSettledFor] = useState<string | null>(null)
    useEffect(() => {
        if (answered) setSettledFor(revisionId)
    }, [answered, revisionId])
    const action =
        onSetUp && canFix ? (
            <Button size="sm" variant="outline" className="shrink-0" onClick={onSetUp}>
                {t("chat.modelSetupBanner.setUp")}
            </Button>
        ) : null

    // Same strip as the connect-model gate above the composer, so the two read as one family.
    return (
        <RevealCollapse open={blocked} animate={settledFor === revisionId}>
            <div
                role="status"
                className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-solid border-warning/30 bg-warning/10 px-3 py-2"
            >
                <span className="flex min-w-0 items-center gap-2 text-meta text-warning">
                    <WarningIcon size={14} className="shrink-0" />
                    <span className="min-w-0">
                        <span className="block truncate font-medium">{agentNeedsSetupTitle()}</span>
                        <span className="block">{modelNeedsSetupMessage()}</span>
                    </span>
                </span>
                {action}
            </div>
        </RevealCollapse>
    )
}
