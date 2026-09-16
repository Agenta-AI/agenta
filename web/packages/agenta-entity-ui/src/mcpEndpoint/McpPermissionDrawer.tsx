/**
 * What one agent may do with one MCP server, in a drawer of its own.
 *
 * The permission editor used to be a rail row inside the agent's MCP form, which meant the
 * densest surface in the feature was nested two panels deep inside the shallowest one. It
 * is now the destination a rail row and the add drawer both lead to, which is what makes
 * "one navigation per configuration intent" true of this surface.
 *
 * STUB. The props are the contract WP4 fills in against; the body is today's editor moved
 * into the drawer chrome, so the surface is reachable and its writes land on the agent
 * draft while the D1 to D4 screens are built. `expired`, `readOnly` and `onReconnect` are
 * accepted and not yet drawn.
 */
import type {McpServerPolicy} from "@agenta/entities/mcpEndpoint"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button} from "@agenta/ui/ui"

import McpToolPermissions from "./McpToolPermissions"

export interface McpPermissionDrawerProps {
    open: boolean
    onClose: () => void
    /** The connection the gateway resolves at run time. */
    slug?: string
    /** The connection's display name, which titles the drawer. */
    connectionName?: string
    /**
     * The prefix the model sees on this server's tools. Frozen when the server was added,
     * so it is the agent item's field and not the connection's current name.
     */
    toolPrefix?: string
    policy: McpServerPolicy
    onChange: (policy: McpServerPolicy) => void
    /** Detaches the server from this agent. Absent hides the footer link. */
    onRemove?: () => void
    /** Renews the login. Absent hides the D4 action. */
    onReconnect?: () => void
    /** The login is expired, so the tools cannot be listed and the policy is only kept. */
    expired?: boolean
    /** Decision 23: the header, groups and rows, with no selects and no footer. */
    readOnly?: boolean
    disabled?: boolean
}

export function McpPermissionDrawer({
    open,
    onClose,
    slug,
    connectionName,
    toolPrefix,
    policy,
    onChange,
    onRemove,
    onReconnect,
    readOnly,
    disabled,
}: McpPermissionDrawerProps) {
    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="responsive"
            destroyOnClose
            title={
                <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-sm font-medium">
                        {connectionName || slug || "MCP server"}
                    </span>
                    {toolPrefix ? (
                        <span className="min-w-0 truncate font-mono text-xs font-normal text-colorTextTertiary">
                            {toolPrefix}
                        </span>
                    ) : null}
                </div>
            }
            footer={
                readOnly ? null : (
                    <div className="flex items-center justify-between gap-2">
                        {onRemove ? (
                            <Button variant="link" className="text-colorError" onClick={onRemove}>
                                Remove from agent
                            </Button>
                        ) : (
                            <span />
                        )}
                        {/* Decision 19: no dirty state. Overrides write to the agent draft as
                            they change, so Done and the close X do the same thing. */}
                        <Button onClick={onClose}>Done</Button>
                    </div>
                )
            }
        >
            <McpToolPermissions
                slug={slug}
                connectionName={connectionName}
                onConnect={onReconnect ?? (() => undefined)}
                policy={policy}
                onChange={onChange}
                disabled={disabled || readOnly}
            />
        </EnhancedDrawer>
    )
}

export default McpPermissionDrawer
