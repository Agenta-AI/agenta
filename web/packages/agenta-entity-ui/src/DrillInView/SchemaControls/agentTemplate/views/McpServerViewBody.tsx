import {useCallback, useMemo, useState} from "react"

import {USER_ACCOUNT_SOURCE} from "@agenta/entities/accountChoice"
import {
    findCustomMcpEndpoint,
    getMcpConnectionStatus,
    getMcpConnectionStatusLabel,
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
import {
    Badge,
    Button,
    ItemViewTitle,
} from "@agenta/ui/ui"
import {useViewTitle, type ConfigItemRef, type ViewNav, type ViewProps} from "@agenta/ui/view-stack"
import {ArrowClockwise} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useMcpPermissionSource} from "../../../../mcpEndpoint/McpPermissionDrawer"
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
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import {mcpConnectView} from "./mcpConnectView"
import type {McpServerViewParams} from "./mcpServerView"
import {RemovedItemState} from "./RemovedItemState"
import {RemoveFromAgentDialog} from "./RemoveFromAgentDialog"
import {RemoveFromAgentFooter} from "./RemoveFromAgentFooter"

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
    status,
    onReconnect,
}: {
    name: string
    /** The project's sign-in state; absent when it is not the one this place uses. */
    status: McpConnectionStatus | undefined
    onReconnect?: () => void
}) => {
    const t = useT(mcpPermissionsCatalog)
    return (
        <ItemViewTitle
            className="px-4 pt-4"
            mark={<McpServerMark size={24} name={name} />}
            title={name}
            status={
                status && status !== "connected" ? (
                    <Badge variant="warning" className="shrink-0">
                        {getMcpConnectionStatusLabel(status)}
                    </Badge>
                ) : null
            }
            actions={
                status && status !== "connected" && onReconnect ? (
                    <Button variant="outline" size="compact" onClick={onReconnect}>
                        <ArrowClockwise data-icon="inline-start" />
                        {t("entityUi.mcpPermissions.reconnect")}
                    </Button>
                ) : null
            }
        />
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
    // title says nothing about it. The tool list reads with the project's sign-in while there is
    // one, else with the viewer's own; with neither, it shows no list and no error.
    const personal = readMcpAccountSource(entry) === USER_ACCOUNT_SOURCE
    const projectSignedIn = projectStatus === "connected"
    const ownSignIn = endpoint?.user_sign_in?.is_ready === true
    const readsOwnSignIn = personal && !projectSignedIn
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
        // A refused personal sign-in is repaired in "Your sign-in", never by the project's consent.
        onReconnect: readsOwnSignIn ? undefined : onReconnect,
        disabled: writer.readOnly,
        // The title line says it, with "Reconnect".
        banner: false,
        listTools: !personal || projectSignedIn || ownSignIn,
        accountSource: readsOwnSignIn ? USER_ACCOUNT_SOURCE : "agent",
    })

    if (!entry) {
        return (
            <RemovedItemState
                message={t("entityUi.mcpViews.removedState")}
                onBack={() => void nav.back()}
            />
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
                status={personal ? undefined : projectStatus}
                onReconnect={writer.readOnly ? undefined : onReconnect}
            />
            <div className="flex min-h-0 flex-1 flex-col">
                <PermissionDrawerBody
                    {...mcp.source}
                    permissions={mcp.permissions}
                    onChangePermissions={mcp.write}
                    onChangeToolPermission={mcp.setTool}
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
            {writer.readOnly ? null : <RemoveFromAgentFooter onClick={() => setConfirming(true)} />}
            <RemoveFromAgentDialog
                open={confirming}
                name={name}
                body={t("entityUi.integrationViews.connectionStays")}
                onConfirm={remove}
                onCancel={() => setConfirming(false)}
            />
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
