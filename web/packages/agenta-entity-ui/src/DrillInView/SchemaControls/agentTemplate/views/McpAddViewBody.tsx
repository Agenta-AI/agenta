import {useCallback, useMemo, useRef} from "react"

import {USER_ACCOUNT_SOURCE} from "@agenta/entities/accountChoice"
import {
    findCustomMcpEndpoint,
    getMcpConnectionStatus,
    hostnameLabel,
    mcpEndpointsQueryAtom,
    mcpReconnectTarget,
    readMcpConnectionSlug,
    readMcpToolCount,
    type MCPEndpoint,
    type McpSignInOwner,
} from "@agenta/entities/mcpEndpoint"
import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {McpAddServerList, type McpConnectionOption} from "../../../../mcpEndpoint/McpAddServerList"
import {
    buildMcpAgentItem,
    customMcpEndpoints,
    mcpItemRef,
    mcpsOf,
    withMcpAccountSource,
} from "../mcpRail"
import {useAgentConfigWriter} from "../useAgentConfigWriter"

import type {McpAddViewParams} from "./mcpAddView"
import {mcpConnectView} from "./mcpConnectView"
import {mcpServerView} from "./mcpServerView"

const McpAddViewBody = ({target, nav}: ViewProps<McpAddViewParams>) => {
    const t = useT(mcpConnectCatalog)
    useViewTitle(t("entityUi.mcpConnect.addMcpServer"))
    const writer = useAgentConfigWriter(target.kind === "agent_draft" ? target.revisionId : "")
    const endpointsQuery = useAtomValue(mcpEndpointsQueryAtom)

    // `custom` only, which is the namespace an agent's connection reference names.
    const endpoints = useMemo(() => customMcpEndpoints(endpointsQuery.data), [endpointsQuery.data])
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
    /**
     * Add the server to the agent, then open its server view in place of this one. A server
     * signed in with "Only me" starts on "Each person's own", the sign-in it has.
     */
    const add = useCallback(
        (option: {slug: string; name: string; owner?: McpSignInOwner}) => {
            const built = buildMcpAgentItem(option)
            const item =
                option.owner === "user" ? withMcpAccountSource(built, USER_ACCOUNT_SOURCE) : built
            // Opens the server's view only when the write landed (the writer skips a write while
            // the configuration loads, or without the edit right).
            const written: {mcps: unknown[] | null} = {mcps: null}
            writer.update((agent) => {
                written.mcps = [...mcpsOf(agent), item]
                return {...agent, mcps: written.mcps}
            })
            const ref = written.mcps ? mcpItemRef(item, written.mcps) : null
            if (ref) void replace(mcpServerView, {item: ref}, target)
        },
        [writer, replace, target],
    )

    // The connect step reports back after its sign-in, when auto-save may have moved the
    // revision: it calls the add of this view as it is then, with the writer it has then.
    const addRef = useRef(add)
    addRef.current = add
    // With personal accounts on, Connect for an agent asks "Who can use it", as the integration
    // connect form does. With no agent the sign-in is the project's.
    const access = useAtomValue(personalAccountsAccessAtom)
    const askOwner = target.kind === "agent_draft" && access === "on"
    const connect = useCallback(() => {
        void push?.(
            mcpConnectView,
            {
                owners: askOwner ? ["user", "project"] : undefined,
                onConnected: (endpoint) => addRef.current(endpoint),
            },
            {kind: "project"},
        )
    }, [push, askOwner])
    const reconnect = useCallback(
        (option: McpConnectionOption) => {
            const reconnectTarget = mcpReconnectTarget(
                findCustomMcpEndpoint(endpoints, option.slug),
            )
            if (!reconnectTarget) return
            // A server that is not on the agent yet joins it once it is signed in again, as a
            // new connection does.
            void push?.(
                mcpConnectView,
                {
                    reconnect: reconnectTarget,
                    onConnected: option.added ? undefined : (endpoint) => addRef.current(endpoint),
                },
                {kind: "project"},
            )
        },
        [endpoints, push],
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
