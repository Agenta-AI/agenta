import {useEffect} from "react"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import {mcpConnectView, mcpServerView} from "@agenta/entity-ui/mcpEndpoint"
import {axios} from "@agenta/shared/api"
import {useViewStack, ViewStackHost, type ViewTarget} from "@agenta/ui/view-stack"
import type {Decorator, Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the package barrel does not re-export the agent's add view.
import {mcpAddView} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/views/mcpAddView"
import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    LINEAR_MCP_TOOLS,
    mcpQueries,
    subagentRevisionId,
} from "../../../fixtures/builderLayout/mcp-subagents"

const panel: AgentPanelApi = {
    content: "configuration",
    toggle: async () => true,
    close: async () => true,
    configTab: "agent",
    setConfigTab: () => undefined,
    wide: false,
    setWide: () => undefined,
    phone: false,
    available: {files: true, configuration: true, builder: false},
}

type Frame = "add" | "connect" | "server"

/** Opens the frame's view the way "+", "Connect server" or a row does. */
const Open = ({frame, revisionId}: {frame: Frame; revisionId: string}) => {
    const stack = useViewStack()
    useEffect(() => {
        const agent: ViewTarget = {kind: "agent_draft", revisionId}
        if (frame === "add") void stack.open(mcpAddView, {}, agent)
        if (frame === "connect") void stack.open(mcpConnectView, {}, {kind: "project"})
        if (frame === "server")
            void stack.open(mcpServerView, {item: {list: "mcps", key: "linear"}}, agent)
        // Open once on mount, like a click.
    }, [])
    return null
}

/** The request config an interceptor sees (the storybook has no direct axios dependency). */
type RequestConfig = Parameters<
    NonNullable<Parameters<typeof axios.interceptors.request.use>[0]>
>[0]

/**
 * The server's tool list without a server: the credential mint and the three MCP calls of
 * `listMcpTools` get an answer here; every other request goes through. Installed once, and it
 * only matches the MCP gateway's own URLs, which no other story reaches.
 */
let installed = false
const installLinearTools = () => {
    if (installed) return
    installed = true
    axios.interceptors.request.use((config: RequestConfig) => {
        const url = String(config.url ?? "")
        if (!url.endsWith("/gateways/credentials") && !url.includes("/gateways/mcps/custom/"))
            return config
        config.adapter = async (request) => {
            const body = JSON.parse(String(request.data ?? "{}")) as {id?: number; method?: string}
            const data = url.endsWith("/gateways/credentials")
                ? {credentials: "story"}
                : body.method === "initialize"
                  ? {jsonrpc: "2.0", id: body.id, result: {protocolVersion: "2025-06-18"}}
                  : body.method === "tools/list"
                    ? {jsonrpc: "2.0", id: body.id, result: {tools: LINEAR_MCP_TOOLS}}
                    : {}
            return {data, status: 200, statusText: "OK", headers: {}, config: request}
        }
        return config
    })
}

const withLinearTools: Decorator = (Story) => {
    installLinearTools()
    return <Story />
}

/** The Agent tab's view stack in the right panel, with one MCP view open. */
const PanelFrame = ({frame, revisionId}: {frame: Frame; revisionId: string}) => (
    <AgentPanelContext.Provider value={panel}>
        <div
            data-testid="agent-panel"
            className="ag-panel-raised flex h-[760px] w-[440px] flex-col border border-solid border-border"
        >
            <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                <Open frame={frame} revisionId={revisionId} />
            </ViewStackHost>
        </div>
    </AgentPanelContext.Provider>
)

const meta = {
    title: "BuilderLayout/mcp-subagents/MCP servers",
    component: PanelFrame,
    decorators: [withLinearTools],
    parameters: {
        layout: "padded",
        agenta: {
            queries: (scope: StoryScope) => mcpQueries(scope),
            args: (scope: StoryScope) => ({revisionId: subagentRevisionId(scope)}),
        },
    },
} satisfies Meta<typeof PanelFrame>

export default meta
type Story = StoryObj<typeof meta>

/** F03 f4: Add MCP server. linear is added; billing's sign-in expired. */
export const AddMcpServer: Story = {args: {frame: "add", revisionId: ""}}

/** F03 f5: Connect server, at its first step. */
export const ConnectServer: Story = {args: {frame: "connect", revisionId: ""}}

/** F03 f6: a healthy server: account, default permission and the tools by group. */
export const Server: Story = {args: {frame: "server", revisionId: ""}}

/** F03 f6: the project's sign-in expired: the title line says so, with Reconnect, no banner. */
export const ServerSignInExpired: Story = {
    args: {frame: "server", revisionId: ""},
    parameters: {
        agenta: {
            queries: (scope: StoryScope) => mcpQueries(scope, {linearExpired: true}),
            args: (scope: StoryScope) => ({revisionId: subagentRevisionId(scope)}),
        },
    },
}
