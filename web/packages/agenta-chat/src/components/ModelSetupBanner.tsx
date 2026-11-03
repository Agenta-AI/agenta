import {AGENT_NEEDS_SETUP_TITLE, MODEL_NEEDS_SETUP_MESSAGE} from "@agenta/entities/workflow"
import {Alert, Button} from "@agenta/ui/ui"
import {Lock} from "@phosphor-icons/react"

import {useAgentModelSetup} from "../hooks/useAgentModelSetup"

import RevealCollapse from "./RevealCollapse"

export interface ModelSetupBannerProps {
    /** The saved agent revision the server checked. */
    revisionId: string
    /** `strip` sits above the composer; `alert` sits at the top of the config pane. */
    layout?: "strip" | "alert"
    /** Opens the model picker. Omitted, or a viewer who cannot fix it, shows no button. */
    onSetUp?: () => void
}

/**
 * The one banner the needs-setup check raises, and only for a model item. Tools, MCP servers,
 * secrets and app connections never reach it: they show a tag on their own card.
 */
export const ModelSetupBanner = ({
    revisionId,
    layout = "strip",
    onSetUp,
}: ModelSetupBannerProps) => {
    const {blocked, canFix} = useAgentModelSetup(revisionId)
    const action =
        onSetUp && canFix ? (
            <Button size="sm" className="shrink-0" onClick={onSetUp}>
                Set up
            </Button>
        ) : null

    if (layout === "alert") {
        return (
            <RevealCollapse open={blocked}>
                <Alert
                    className="mb-3"
                    type="warning"
                    showIcon
                    message={AGENT_NEEDS_SETUP_TITLE}
                    description={MODEL_NEEDS_SETUP_MESSAGE}
                    action={action}
                />
            </RevealCollapse>
        )
    }

    // Same strip as the connect-model gate above the composer, so the two read as one family.
    return (
        <RevealCollapse open={blocked}>
            <div
                role="status"
                className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-solid border-colorWarning/30 bg-colorWarningBg px-3 py-2"
            >
                <span className="flex min-w-0 items-center gap-2 text-xs text-colorWarningText">
                    <Lock size={14} className="shrink-0" />
                    <span className="min-w-0">
                        <span className="block truncate font-medium">
                            {AGENT_NEEDS_SETUP_TITLE}
                        </span>
                        <span className="block truncate">{MODEL_NEEDS_SETUP_MESSAGE}</span>
                    </span>
                </span>
                {action}
            </div>
        </RevealCollapse>
    )
}
