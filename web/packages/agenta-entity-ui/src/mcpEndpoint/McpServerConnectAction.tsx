/**
 * The inline authorization control for one MCP server row in the agent config form.
 *
 * A server the author registers with OAuth is useless until someone completes the consent flow,
 * and until now the only place to do that was the Settings MCP dashboard — a different page, in a
 * different tab, halfway through configuring an agent. This renders the endpoint's derived
 * connection state next to the row and asks its host to run the consent flow.
 *
 * It reports the request rather than mounting the dialog itself. The row is clickable, `extra`
 * renders inside that click target, and React events propagate through the React tree rather than
 * the DOM tree — so a dialog mounted here sends every click inside it, portal or not, back to the
 * row's own `onClick`. The host mounts one dialog outside the rows instead.
 */
import {useMemo} from "react"

import {
    findCustomMcpEndpoint,
    getMcpConnectionState,
    getMcpConnectionStateLabel,
    mcpEndpointsQueryAtom,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {Tag} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

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
    /** Asks the host to authorize this endpoint. The host owns the dialog. */
    onConnect: (endpoint: MCPEndpoint) => void
}

export function McpServerConnectAction({slug, disabled, onConnect}: McpServerConnectActionProps) {
    const endpointsQuery = useAtomValue(mcpEndpointsQueryAtom)

    const endpoint = useMemo(
        () => findCustomMcpEndpoint(endpointsQuery.data, slug),
        [endpointsQuery.data, slug],
    )

    if (!endpoint || endpoint.auth_mode !== "oauth") return null

    return (
        <span className="flex items-center gap-1.5" role="presentation">
            <McpEndpointConnectStatus
                endpoint={endpoint}
                disabled={disabled}
                onConnect={() => onConnect(endpoint)}
            />
        </span>
    )
}
