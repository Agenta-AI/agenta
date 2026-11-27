import {useState} from "react"

import {
    getMcpConnectionStatus,
    hostnameLabel,
    readMcpToolCount,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {McpServerMark} from "@agenta/ui/agent-icon"
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from "@agenta/ui/ui"

import {PermissionDrawerBody} from "../DrillInView/SchemaControls/agentTemplate/IntegrationPermissionList"

import {useMcpPermissionSource} from "./McpPermissionDrawer"

const NO_POLICY = {}
const ignore = () => undefined

export interface McpServerToolsSheetProps {
    /** The project's server whose tools to show. */
    endpoint: MCPEndpoint
    /** Renew the project's sign-in, when it needs one. */
    onReconnect?: () => void
    /** The sheet has closed: the host drops it. */
    onClosed: () => void
}

/** A project server's tools, read-only, in the kit sheet: a permission belongs to an agent. */
export const McpServerToolsSheet = ({
    endpoint,
    onReconnect,
    onClosed,
}: McpServerToolsSheetProps) => {
    const [open, setOpen] = useState(true)
    const slug = endpoint.slug ?? ""
    const name = endpoint.name || slug
    const host = hostnameLabel(endpoint.data.route.base_url ?? "")
    const mcp = useMcpPermissionSource({
        slug,
        connectionName: endpoint.name || undefined,
        status: getMcpConnectionStatus(endpoint),
        cachedToolCount: readMcpToolCount(endpoint),
        policy: NO_POLICY,
        onChange: ignore,
        onReconnect,
        readOnly: true,
        banner: false,
    })
    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent side="right" onCloseAutoFocus={onClosed}>
                <SheetHeader>
                    <span className="flex min-w-0 items-center gap-3">
                        <McpServerMark size={24} name={name} />
                        <span className="flex min-w-0 flex-col">
                            <SheetTitle className="truncate">{name}</SheetTitle>
                            {host ? (
                                <SheetDescription className="truncate font-mono">
                                    {host}
                                </SheetDescription>
                            ) : null}
                        </span>
                    </span>
                </SheetHeader>
                <div className="flex min-h-0 flex-1 flex-col">
                    <PermissionDrawerBody
                        {...mcp.source}
                        permissions={mcp.permissions}
                        onChangePermissions={mcp.write}
                        onChangeToolPermission={mcp.setTool}
                    />
                </div>
            </SheetContent>
        </Sheet>
    )
}
