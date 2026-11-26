import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import {SessionAccessChip, sessionSharingCopy} from "@agenta/sessions-ui/sharing"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ExportIcon} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {shareDialogRequestAtom} from "./shareDialogState"
import {useSessionSharing} from "./useSessionSharing"

/**
 * "Share the conversation" in the session header, one icon button for everyone: it opens the
 * share dialog for the owner, and for everyone else who has access and what they can do here.
 * Ownerless chats (a channel, an API key) get only the access view; the state's
 * `not_shareable_reason` picks the channel text or the no-owner texts. Nothing until the state is
 * known, so the header does not flash a wrong control.
 */
export const SessionSharingControl = ({
    sessionId,
    sessionName,
    workspaceId,
    projectId,
    agentId,
    buttonClassName,
}: {
    sessionId: string
    sessionName: string
    workspaceId: string
    projectId: string
    agentId?: string | null
    /** The header's icon button box, so Share matches the panel icons beside it. */
    buttonClassName?: string
}) => {
    const t = useT(agentLayoutHeaderCatalog)
    const {sharing, owner} = useSessionSharing(sessionId, projectId)
    const openShare = useSetAtom(shareDialogRequestAtom)
    if (!sharing) return null

    const label = t("agentLayout.header.shareConversation")
    const button = (props: {disabled?: boolean; onClick?: () => void}) => (
        <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className={buttonClassName}
            {...props}
        >
            <ExportIcon aria-hidden className="size-4 max-md:size-5" />
        </Button>
    )

    if (sharing.my_role === "owner") {
        return (
            <SimpleTooltip
                title={sharing.shareable ? label : sessionSharingCopy.tooltipNotShareable}
            >
                {/* A disabled button fires no pointer events, so the tooltip hangs on a wrapper. */}
                <span className="inline-flex shrink-0">
                    {button({
                        disabled: !sharing.shareable,
                        onClick: () =>
                            openShare({sessionId, sessionName, workspaceId, projectId, agentId}),
                    })}
                </span>
            </SimpleTooltip>
        )
    }
    // Everyone else: the same button opens who has access and what they can do here.
    return (
        <SessionAccessChip
            sharing={sharing}
            owner={owner}
            fromChannel={sharing.not_shareable_reason === "channel"}
            trigger={button({})}
        />
    )
}
