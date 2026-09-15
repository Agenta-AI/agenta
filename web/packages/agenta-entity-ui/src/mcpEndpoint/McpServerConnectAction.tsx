/**
 * The inline authorization control for one MCP server row in the agent config form.
 *
 * A server the author registers with OAuth is useless until someone completes the consent flow,
 * and until now the only place to do that was the Settings MCP dashboard — a different page, in a
 * different tab, halfway through configuring an agent. This renders the endpoint's derived
 * connection state next to the row and runs the same discover / scopes / popup / callback flow
 * the dashboard runs.
 */
import {useCallback, useMemo, useState} from "react"

import {
    findCustomMcpEndpoint,
    getMcpConnectionState,
    getMcpConnectionStateLabel,
    mcpEndpointsQueryAtom,
    refreshMcpEndpointsAtom,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {Tag} from "@agenta/ui/components/presentational"
import {useAtomValue, useSetAtom} from "jotai"

import McpConnectDialog from "./McpConnectDialog"

const TAG_CLS = "m-0 text-xs leading-[22.4px]"

export interface McpEndpointConnectStatusProps {
    /** The registered endpoint, or undefined while the project's list is still loading. */
    endpoint: MCPEndpoint | undefined
    disabled?: boolean
    onConnect: () => void
}

/**
 * The state tag (and, when there is something to do, the Connect button) for one endpoint.
 * Renders nothing for an endpoint that authorizes some other way — a secret-header server is
 * already described by the row's own fields.
 */
export function McpEndpointConnectStatus({
    endpoint,
    disabled,
    onConnect,
}: McpEndpointConnectStatusProps) {
    if (!endpoint || endpoint.auth_mode !== "oauth") return null

    const state = getMcpConnectionState(endpoint)
    if (state === "ready") {
        return (
            <Tag tone="green" className={TAG_CLS}>
                Authorized
            </Tag>
        )
    }

    return (
        <>
            <Tag tone="gold" className={TAG_CLS}>
                {getMcpConnectionStateLabel(state)}
            </Tag>
            <button
                type="button"
                aria-label={`Connect ${endpoint.name || endpoint.slug}`}
                disabled={disabled}
                onClick={(event) => {
                    event.stopPropagation()
                    onConnect()
                }}
                className="flex cursor-pointer items-center gap-1 rounded border border-solid border-[var(--ag-colorBorderSecondary)] bg-transparent px-1.5 py-0.5 text-[11px] text-[var(--ag-colorTextSecondary)] hover:border-[var(--ag-colorBorder)] hover:text-[var(--ag-colorText)] disabled:cursor-not-allowed disabled:opacity-50"
            >
                Connect
            </button>
        </>
    )
}

export interface McpServerConnectActionProps {
    /** The slug the server registered under — the agent config item's `name` after registration. */
    slug?: string
    disabled?: boolean
}

export function McpServerConnectAction({slug, disabled}: McpServerConnectActionProps) {
    const endpointsQuery = useAtomValue(mcpEndpointsQueryAtom)
    const refreshEndpoints = useSetAtom(refreshMcpEndpointsAtom)
    const [connecting, setConnecting] = useState(false)

    const endpoint = useMemo(
        () => findCustomMcpEndpoint(endpointsQuery.data, slug),
        [endpointsQuery.data, slug],
    )

    const openConnect = useCallback(() => setConnecting(true), [])
    const closeConnect = useCallback(() => setConnecting(false), [])
    const onConnected = useCallback(() => {
        void refreshEndpoints()
    }, [refreshEndpoints])

    if (!endpoint || endpoint.auth_mode !== "oauth") return null

    return (
        <span className="flex items-center gap-1.5" role="presentation">
            <McpEndpointConnectStatus
                endpoint={endpoint}
                disabled={disabled}
                onConnect={openConnect}
            />
            {/* Mounted only once the author asks for it, so a list of servers does not carry a
                modal (and a scope discovery request) per row. */}
            {connecting ? (
                <McpConnectDialog
                    endpoint={endpoint}
                    onClose={closeConnect}
                    onSuccess={onConnected}
                />
            ) : null}
        </span>
    )
}
