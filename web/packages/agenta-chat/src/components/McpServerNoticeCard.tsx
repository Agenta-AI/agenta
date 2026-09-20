/**
 * The turn's account of an MCP server that did not join the run, with the way back.
 *
 * Shared by both apps deliberately, and drawn as the spec's D4 banner: the same sentence and the
 * same action the permission drawer shows for the same connection, so a lapsed login reads as one
 * message with one remedy wherever the reader meets it (spec D4; UI QA round 3, D2).
 *
 * The Reconnect action is offered only once the endpoint row is resolved, because reconnecting
 * needs the row's id, slug and base URL. When the notice names a connection this project cannot
 * see, the sentence still renders and no dead button does.
 */
import {useState} from "react"

import {
    findCustomMcpEndpoint,
    mcpEndpointsQueryAtom,
    refreshMcpEndpointsAtom,
} from "@agenta/entities/mcpEndpoint"
import {McpConnectJourney} from "@agenta/entity-ui/mcpEndpoint"
import {Alert, Button, cn, touchTargetExpansion} from "@agenta/ui/ui"
import {ArrowClockwise, WarningCircle} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {mcpServerNoticeCopy, type McpServerNotice} from "../model/mcpServerNotice"

export interface McpServerNoticeCardProps {
    notice: McpServerNotice
    className?: string
}

export const McpServerNoticeCard = ({notice, className}: McpServerNoticeCardProps) => {
    const endpointsQuery = useAtomValue(mcpEndpointsQueryAtom)
    const refreshEndpoints = useSetAtom(refreshMcpEndpointsAtom)
    const [connecting, setConnecting] = useState(false)

    const endpoint = findCustomMcpEndpoint(endpointsQuery.data, notice.slug ?? undefined)
    const canConnect = notice.needsAuthorization && !!endpoint?.id && !!endpoint.slug
    const connectionName = endpoint?.name || endpoint?.slug || notice.serverName
    const {lead, detail} = mcpServerNoticeCopy(notice, endpoint?.name)

    return (
        <>
            <Alert
                type="warning"
                showIcon
                icon={<WarningCircle />}
                // A replayed notice is history, not news: `status` reads it after the reader's own
                // work, where `alert` would interrupt on every reload of the transcript.
                role="status"
                data-mcp-server-notice={notice.serverName}
                className={cn("border-colorWarningBorder bg-colorWarningBg", className)}
                message={<span className="text-xs text-colorText">{lead}</span>}
                description={
                    detail ? (
                        <span className="text-xs leading-normal text-colorTextSecondary">
                            {detail}
                        </span>
                    ) : undefined
                }
                action={
                    canConnect ? (
                        <Button
                            size="sm"
                            onClick={() => setConnecting(true)}
                            aria-label={`Reconnect ${connectionName}`}
                            // The banner's one action, in a transcript a phone scrolls: 28px of
                            // chrome, 44px to land a finger on.
                            className={touchTargetExpansion(28)}
                        >
                            <ArrowClockwise />
                            Reconnect
                        </Button>
                    ) : undefined
                }
            />
            {canConnect && connecting && endpoint?.id && endpoint.slug && (
                <McpConnectJourney
                    open
                    onClose={() => setConnecting(false)}
                    reconnect={{
                        id: endpoint.id,
                        slug: endpoint.slug,
                        name: endpoint.name || endpoint.slug,
                        url: endpoint.data?.route?.base_url || "",
                        authMode: endpoint.auth_mode,
                        credentialHeader: endpoint.data?.route?.credential_header,
                    }}
                    onConnected={() => {
                        setConnecting(false)
                        void refreshEndpoints()
                    }}
                />
            )}
        </>
    )
}

export default McpServerNoticeCard
