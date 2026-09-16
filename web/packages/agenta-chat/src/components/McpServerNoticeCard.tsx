/**
 * The turn's account of an MCP server that did not join the run, with the way back.
 *
 * Shared by both apps deliberately. The agent's configuration rail already reads
 * "Needs authorization · Connect" for the same connection on the same page, so the chat has to say
 * the same thing and open the same journey — a second wording, or a second dialog, would be two
 * answers to one question (UI QA round 3, D2).
 *
 * The Connect action is offered only once the endpoint row is resolved, because reconnecting needs
 * the row's id, slug and base URL. When the notice names a connection this project cannot see, the
 * sentence still renders and no dead button does.
 */
import {useState} from "react"

import {
    findCustomMcpEndpoint,
    mcpEndpointsQueryAtom,
    refreshMcpEndpointsAtom,
} from "@agenta/entities/mcpEndpoint"
import {McpConnectJourney} from "@agenta/entity-ui/mcpEndpoint"
import {cn} from "@agenta/ui/ui"
import {Plugs} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {mcpServerNoticeSentence, type McpServerNotice} from "../model/mcpServerNotice"

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
    const sentence = mcpServerNoticeSentence(notice, endpoint?.name)

    return (
        <div
            className={cn(
                "box-border flex items-start gap-2 rounded-lg border border-solid px-3 py-2",
                "border-colorWarningBorder bg-colorWarningBg",
                className,
            )}
            role="status"
            data-mcp-server-notice={notice.serverName}
        >
            <Plugs aria-hidden className="text-colorWarning mt-0.5 shrink-0" size={16} />
            <div className="flex min-w-0 flex-col items-start gap-1">
                <span className="text-colorText text-xs">{sentence}</span>
                {canConnect && (
                    <button
                        type="button"
                        onClick={() => setConnecting(true)}
                        aria-label={`Connect ${endpoint?.name || endpoint?.slug}`}
                        className="text-colorWarning cursor-pointer rounded border-0 bg-transparent px-0 py-0.5 text-xs font-medium underline"
                    >
                        Connect
                    </button>
                )}
            </div>
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
                    }}
                    onConnected={() => {
                        setConnecting(false)
                        void refreshEndpoints()
                    }}
                />
            )}
        </div>
    )
}

export default McpServerNoticeCard
