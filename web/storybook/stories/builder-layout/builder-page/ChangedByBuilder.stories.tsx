import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {ConfigurationRoot} from "@/features/agent-layout/ConfigurationRoot"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import {
    AgentEditorContext,
    SectionMarksContext,
    type SectionMarks,
} from "@agenta/entity-ui/drill-in"
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

const marks: SectionMarks = {
    keys: new Set(["instructions"]),
    label: "Changed by the builder",
    onOpened: () => undefined,
}

/** B03: the agent sections in the builder pane after the builder changed the instructions. */
const ChangedSections = ({
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
            <SectionMarksContext.Provider value={marks}>
                <div
                    data-testid="agent-panel"
                    className="ag-panel-raised flex h-[820px] w-[560px] flex-col border border-solid border-border"
                >
                    <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                        <ConfigurationRoot
                            agentId={workflowId}
                            revisionId={revisionId}
                            sessionId="session"
                            filesScope="session"
                            workspaceId="workspace"
                            projectId={projectId}
                            phoneSection={null}
                            onCloseSection={() => undefined}
                        />
                    </ViewStackHost>
                </div>
            </SectionMarksContext.Provider>
        </AgentEditorContext.Provider>
    </AgentPanelContext.Provider>
)

const meta = {
    title: "BuilderLayout/builder-page/Changed by the builder",
    component: ChangedSections,
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
} satisfies Meta<typeof ChangedSections>

export default meta
type Story = StoryObj<typeof meta>

const args = {projectId: "", workflowId: "", revisionId: ""}

/** B03: "Changed by the builder" after Instructions. */
export const InstructionsChanged: Story = {args, globals: {theme: "light"}}
