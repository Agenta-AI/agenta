import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {ConfigurationRoot} from "@/features/agent-layout/ConfigurationRoot"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import {AgentEditorContext} from "@agenta/entity-ui/drill-in"
import {ViewStackHost} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    agentTabIds,
    agentTabQueries,
    type AgentTabIds,
} from "../../../fixtures/builderLayout/agent-tab"

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

/**
 * F01 f1 and S02: the Agent tab of the right panel, the sections in today's order. No
 * "Configuration" bar: the save status and the version stay in the session header (auto-save).
 */
const AgentTabPanel = ({ids}: {ids: AgentTabIds}) => (
    <AgentPanelContext.Provider value={panel}>
        <AgentEditorContext.Provider value={{revisionId: ids.revisionId, readOnly: false}}>
            <div
                data-testid="agent-panel"
                className="ag-panel-raised flex h-[820px] w-[440px] flex-col border border-solid border-border"
            >
                <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                    <ConfigurationRoot
                        agentId={ids.workflowId}
                        revisionId={ids.revisionId}
                        sessionId="session"
                        filesScope="session"
                        workspaceId="workspace"
                        projectId={ids.projectId}
                    />
                </ViewStackHost>
            </div>
        </AgentEditorContext.Provider>
    </AgentPanelContext.Provider>
)

const meta = {
    title: "BuilderLayout/agent-tab/Agent tab",
    component: AgentTabPanel,
    parameters: {
        layout: "padded",
        agenta: {
            queries: (scope: StoryScope) => agentTabQueries(scope),
            args: (scope: StoryScope) => ({ids: agentTabIds(scope)}),
        },
    },
} satisfies Meta<typeof AgentTabPanel>

export default meta
type Story = StoryObj<typeof meta>

const ids: AgentTabIds = {projectId: "", workflowId: "", revisionId: ""}

/** F01 f1: Model, Instructions, Integrations, Subagents, MCP servers, Skills, Permissions, Advanced. */
export const Light: Story = {args: {ids}, globals: {theme: "light"}}

export const Dark: Story = {args: {ids}, globals: {theme: "dark"}}
