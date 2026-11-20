import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {ConfigurationRoot} from "@/features/agent-layout/ConfigurationRoot"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import {AgentEditorContext} from "@agenta/entity-ui/drill-in"
import {ViewStackHost} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {agentTabQueries} from "../../../fixtures/builderLayout/agent-tab"
import {workflowIds} from "../../../fixtures/workflow"

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
const AgentTabPanel = ({
    projectId,
    workflowId,
    revisionId,
}: {
    projectId: string
    workflowId: string
    revisionId: string
}) => (
    <AgentPanelContext.Provider value={panel}>
        <AgentEditorContext.Provider value={{revisionId, readOnly: false}}>
            <div
                data-testid="agent-panel"
                className="ag-panel-raised flex h-[820px] w-[440px] flex-col border border-solid border-border"
            >
                <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                    <ConfigurationRoot
                        agentId={workflowId}
                        revisionId={revisionId}
                        sessionId="session"
                        filesScope="session"
                        workspaceId="workspace"
                        projectId={projectId}
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
            args: (scope: StoryScope) => {
                const {projectId, workflowId, revisionId} = workflowIds(scope)
                return {projectId, workflowId, revisionId}
            },
        },
    },
} satisfies Meta<typeof AgentTabPanel>

export default meta
type Story = StoryObj<typeof meta>

const args = {projectId: "", workflowId: "", revisionId: ""}

/** F01 f1: Model, Instructions, Integrations, Subagents, MCP servers, Skills, Permissions, Advanced. */
export const Light: Story = {args, globals: {theme: "light"}}

export const Dark: Story = {args, globals: {theme: "dark"}}
