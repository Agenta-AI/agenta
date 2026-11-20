import {useCallback, useMemo, useState} from "react"

import {USER_ACCOUNT_SOURCE} from "@agenta/entities/accountChoice"
import {
    findCustomMcpEndpoint,
    getMcpConnectionStatus,
    getMcpConnectionStatusLabel,
    hostnameLabel,
    mcpEndpointsQueryAtom,
    mcpReconnectTarget,
    readMcpConnectionSlug,
    readMcpPolicy,
    readMcpToolCount,
    type MCPEndpoint,
    type McpConnectionStatus,
    type McpServerPolicy,
} from "@agenta/entities/mcpEndpoint"
import {useT} from "@agenta/i18n"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import mcpPermissionsCatalog from "@agenta/i18n/catalogs/entityUi.mcpPermissions"
import mcpViewsCatalog from "@agenta/i18n/catalogs/entityUi.mcpViews"
import {McpServerMark} from "@agenta/ui/agent-icon"
import {Badge, Button} from "@agenta/ui/ui"
import {useViewTitle, type ConfigItemRef, type ViewNav, type ViewProps} from "@agenta/ui/view-stack"
import {ArrowClockwise} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useMcpPermissionSource} from "../../../../mcpEndpoint/McpPermissionDrawer"
import {readRunnerPermission} from "../../agentConfigPatch"
import {McpAccountBlock} from "../accounts/McpAccountBlock"
import {PermissionDrawerBody} from "../IntegrationPermissionList"
import {
    findMcpIndex,
    readMcpAccountSource,
    customMcpEndpoints,
    mcpsOf,
    removeMcpByRef,
    updateMcpByRef,
    withMcpAccountSource,
} from "../mcpRail"
import {RemoveFromAgentDialog} from "../RemoveFromAgentDialog"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import {mcpConnectView} from "./mcpConnectView"
import type {McpServerViewParams} from "./mcpServerView"

/** The project's `custom` servers, the namespace an agent's connection reference names. */
const useCustomEndpoints = (): MCPEndpoint[] => {
    const query = useAtomValue(mcpEndpointsQueryAtom)
    return useMemo(() => customMcpEndpoints(query.data), [query.data])
}

/** "Reconnect" opens the reconnect step over this view; the permissions stay as they are. */
const useReconnect = (endpoint: MCPEndpoint | undefined, nav: ViewNav) => {
    const {push} = nav
    return useMemo(() => {
        const target = mcpReconnectTarget(endpoint)
        if (!target || !push) return undefined
        return () => void push(mcpConnectView, {reconnect: target}, {kind: "project"})
    }, [endpoint, push])
}

/**
 * The title line: the server, its host, and only when something needs attention, its state with
 * "Reconnect" (F03 f6). No banner says it a second time.
 */
const ServerTitle = ({
    name,
    endpoint,
    status,
    onReconnect,
}: {
    name: string
    endpoint: MCPEndpoint | undefined
    /** The project's sign-in state; absent when it is not the one this place uses. */
    status: McpConnectionStatus | undefined
    onReconnect?: () => void
}) => {
    const t = useT(mcpPermissionsCatalog)
    const host = endpoint ? hostnameLabel(endpoint.data.route.base_url ?? "") : ""
    return (
        <div className="flex min-w-0 items-center gap-3 px-4 pb-1 pt-3">
            <McpServerMark size={24} />
            <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="truncate text-[15px] font-semibold">{name}</span>
                {host ? (
                    <span className="truncate text-xs text-colorTextTertiary">{host}</span>
                ) : null}
            </div>
            {status && status !== "connected" ? (
                <>
                    <Badge variant="warning" className="m-0 shrink-0 font-normal">
                        {getMcpConnectionStatusLabel(status)}
                    </Badge>
                    {onReconnect ? (
                        <Button variant="outline" size="sm" onClick={onReconnect}>
                            <ArrowClockwise data-icon="inline-start" />
                            {t("entityUi.mcpPermissions.reconnect")}
                        </Button>
                    ) : null}
                </>
            ) : null}
        </div>
    )
}

const McpServerViewBody = (props: ViewProps<McpServerViewParams>) =>
    "item" in props.params ? (
        <AgentServer {...props} item={props.params.item} />
    ) : (
        <ProjectServer {...props} slug={props.params.connectionSlug} />
    )

/** The server in an agent: account, permissions and removal write the agent configuration. */
const AgentServer = ({
    target,
    nav,
    item,
}: ViewProps<McpServerViewParams> & {item: ConfigItemRef}) => {
    const t = useT(mcpViewsCatalog, integrationViewsCatalog)
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const mcps = mcpsOf(writer.agent)
    // Found by key in the list as it is now: a builder save that changes the list under the open
    // view never puts another server here.
    const index = findMcpIndex(mcps, item)
    const entry = index < 0 ? null : (mcps[index] as Record<string, unknown>)
    const endpoints = useCustomEndpoints()
    const slug = entry ? (readMcpConnectionSlug(entry) ?? undefined) : undefined
    const endpoint = slug ? findCustomMcpEndpoint(endpoints, slug) : undefined
    const name = endpoint?.name || slug || item.key.replace(/^@slug:/, "")
    useViewTitle(name)
    const [confirming, setConfirming] = useState(false)

    const update = useCallback(
        (next: (entry: Record<string, unknown>) => Record<string, unknown>) =>
            writer.update((agent) => ({...agent, mcps: updateMcpByRef(mcpsOf(agent), item, next)})),
        [writer, item],
    )
    const onReconnect = useReconnect(endpoint, nav)
    const projectStatus = endpoint ? getMcpConnectionStatus(endpoint) : undefined
    // Each person's own sign-in: the project's sign-in state is not whose account runs, so the
    // title says nothing about it, and the tool list (read with the project's credential) shows
    // only while the project is signed in.
    const personal = readMcpAccountSource(entry) === USER_ACCOUNT_SOURCE
    const accountContext = useMemo(
        () => ({revisionId: writer.revisionId, agent: writer.agent}),
        [writer.revisionId, writer.agent],
    )
    const mcp = useMcpPermissionSource({
        slug,
        connectionName: endpoint?.name || undefined,
        // Passed rather than defaulted: the source assumes "connected" when given nothing.
        status: personal ? "connected" : projectStatus,
        cachedToolCount: endpoint ? readMcpToolCount(endpoint) : null,
        policy: readMcpPolicy(entry),
        onChange: (policy: McpServerPolicy) => update((current) => ({...current, policy})),
        onReconnect,
        disabled: writer.readOnly,
        // The title line says it, with "Reconnect".
        banner: false,
        listTools: !personal || projectStatus === "connected",
    })

    if (!entry) {
        return (
            <div className="flex flex-col items-start gap-3 px-4 py-6 text-sm">
                <span className="text-colorTextSecondary">
                    {t("entityUi.mcpViews.removedState")}
                </span>
                <Button variant="outline" size="sm" onClick={() => void nav.back()}>
                    {t("entityUi.integrationViews.back")}
                </Button>
            </div>
        )
    }

    const remove = () => {
        setConfirming(false)
        writer.update((agent) => ({...agent, mcps: removeMcpByRef(mcpsOf(agent), item)}))
        void nav.back()
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ServerTitle
                name={name}
                endpoint={endpoint}
                status={personal ? undefined : projectStatus}
                onReconnect={writer.readOnly ? undefined : onReconnect}
            />
            <div className="flex min-h-0 flex-1 flex-col">
                <PermissionDrawerBody
                    {...mcp.source}
                    permissions={mcp.permissions}
                    onChangePermissions={mcp.write}
                    onChangeToolPermission={mcp.setTool}
                    agentPolicy={readRunnerPermission(writer.agent)}
                    disabled={writer.readOnly}
                    account={
                        <McpAccountBlock
                            endpoint={endpoint}
                            source={readMcpAccountSource(entry)}
                            onChange={(source) =>
                                update((current) => withMcpAccountSource(current, source))
                            }
                            context={accountContext}
                            disabled={writer.readOnly}
                        />
                    }
                />
            </div>
            {writer.readOnly ? null : (
                <div className="shrink-0 px-4 py-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-colorError"
                        onClick={() => setConfirming(true)}
                    >
                        {t("entityUi.integrationViews.removeFromAgent")}
                    </Button>
                </div>
            )}
            {confirming ? (
                <RemoveFromAgentDialog
                    open
                    name={name}
                    description={t("entityUi.integrationViews.connectionStays")}
                    onRemove={remove}
                    onClose={() => setConfirming(false)}
                />
            ) : null}
        </div>
    )
}

const NO_POLICY: McpServerPolicy = {}
const ignore = () => undefined

/**
 * The project's connection in Settings: the same tools, read-only. A permission belongs to an
 * agent, so there is nothing to set here.
 */
const ProjectServer = ({nav, slug}: ViewProps<McpServerViewParams> & {slug: string}) => {
    const endpoints = useCustomEndpoints()
    const endpoint = findCustomMcpEndpoint(endpoints, slug)
    const name = endpoint?.name || slug
    useViewTitle(name)
    const onReconnect = useReconnect(endpoint, nav)
    const mcp = useMcpPermissionSource({
        slug,
        connectionName: endpoint?.name || undefined,
        status: endpoint ? getMcpConnectionStatus(endpoint) : undefined,
        cachedToolCount: endpoint ? readMcpToolCount(endpoint) : null,
        policy: NO_POLICY,
        onChange: ignore,
        onReconnect,
        readOnly: true,
        banner: false,
    })
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ServerTitle
                name={name}
                endpoint={endpoint}
                status={endpoint ? getMcpConnectionStatus(endpoint) : undefined}
                onReconnect={onReconnect}
            />
            <div className="flex min-h-0 flex-1 flex-col">
                <PermissionDrawerBody
                    {...mcp.source}
                    permissions={mcp.permissions}
                    onChangePermissions={mcp.write}
                    onChangeToolPermission={mcp.setTool}
                />
            </div>
        </div>
    )
}

export default McpServerViewBody
