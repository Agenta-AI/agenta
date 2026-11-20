import {useCallback, useMemo} from "react"

import {
    findCustomMcpEndpoint,
    getMcpConnectionStatus,
    hostnameLabel,
    mcpEndpointsQueryAtom,
    mcpReconnectTarget,
    readMcpConnectionSlug,
    readMcpToolCount,
    refreshMcpEndpointsAtom,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {invalidateAgentRequirements} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue, useSetAtom} from "jotai"

import {McpAddServerList, type McpConnectionOption} from "../../../../mcpEndpoint/McpAddServerList"
import {buildMcpAgentItem, mcpItemRef} from "../mcpRail"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import type {McpAddViewParams} from "./mcpAddView"
import {mcpConnectView} from "./mcpConnectView"
import {mcpServerView} from "./mcpServerView"

const mcpsOf = (agent: Record<string, unknown>): unknown[] =>
    Array.isArray(agent.mcps) ? (agent.mcps as unknown[]) : []

const McpAddViewBody = ({target, nav}: ViewProps<McpAddViewParams>) => {
    const t = useT(mcpConnectCatalog)
    useViewTitle(t("entityUi.mcpConnect.addMcpServer"))
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const endpointsQuery = useAtomValue(mcpEndpointsQueryAtom)
    const refreshEndpoints = useSetAtom(refreshMcpEndpointsAtom)

    // `custom` only, which is the namespace an agent's connection reference names.
    const endpoints = useMemo<MCPEndpoint[]>(
        () =>
            (endpointsQuery.data ?? []).filter(
                (endpoint) => (endpoint.namespace ?? "custom") === "custom",
            ),
        [endpointsQuery.data],
    )
    const mcps = mcpsOf(writer.agent)
    const addedSlugs = useMemo(
        () =>
            new Set(
                mcps
                    .map((item) => readMcpConnectionSlug(item as Record<string, unknown>))
                    .filter((slug): slug is string => Boolean(slug)),
            ),
        [mcps],
    )
    const options = useMemo<McpConnectionOption[]>(
        () =>
            endpoints
                .filter((endpoint): endpoint is MCPEndpoint & {slug: string} =>
                    Boolean(endpoint.slug),
                )
                .map((endpoint) => ({
                    slug: endpoint.slug,
                    name: endpoint.name || endpoint.slug,
                    host: hostnameLabel(endpoint.data.route.base_url ?? ""),
                    status: getMcpConnectionStatus(endpoint),
                    toolCount: readMcpToolCount(endpoint),
                    added: addedSlugs.has(endpoint.slug),
                }))
                // An added row keeps its place: the reader is looking a server up.
                .sort((a, b) => a.name.localeCompare(b.name)),
        [endpoints, addedSlugs],
    )

    const {push, replace} = nav
    /** Add the server to the agent, then open its server view in place of this one. */
    const add = useCallback(
        (option: {slug: string; name: string}) => {
            const item = buildMcpAgentItem(option)
            writer.update((agent) => ({...agent, mcps: [...mcpsOf(agent), item]}))
            const ref = mcpItemRef(item)
            if (ref) void replace(mcpServerView, {item: ref}, target)
        },
        [writer, replace, target],
    )

    const connect = useCallback(() => {
        void push?.(mcpConnectView, {onConnected: add}, {kind: "project"})
    }, [push, add])
    const reconnect = useCallback(
        (option: McpConnectionOption) => {
            const reconnectTarget = mcpReconnectTarget(
                findCustomMcpEndpoint(endpoints, option.slug),
            )
            if (!reconnectTarget) return
            void push?.(
                mcpConnectView,
                {
                    reconnect: reconnectTarget,
                    onConnected: () => {
                        void refreshEndpoints()
                        void invalidateAgentRequirements()
                    },
                },
                {kind: "project"},
            )
        },
        [endpoints, push, refreshEndpoints],
    )

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <McpAddServerList
                options={options}
                loading={endpointsQuery.isPending}
                onConnectServer={connect}
                onAdd={add}
                onReconnect={reconnect}
            />
        </div>
    )
}

export default McpAddViewBody
