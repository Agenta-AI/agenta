import {useEffect} from "react"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import {DrillInUIProvider} from "@agenta/entity-ui/drill-in"
import {useViewStack, ViewStackHost, type ViewTarget} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the package barrel does not re-export the agent views.
import {subagentAddView} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/views/subagentAddView"
import {subagentView} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/views/subagentView"
import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    subagentBridge,
    subagentQueries,
    subagentRevisionId,
    type SubagentBridgeOptions,
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

type Frame = "add" | "subagent"

/** Opens the frame's view the way "+" or a row does. */
const Open = ({frame, revisionId}: {frame: Frame; revisionId: string}) => {
    const stack = useViewStack()
    useEffect(() => {
        const agent: ViewTarget = {kind: "agent_draft", revisionId}
        if (frame === "add") void stack.open(subagentAddView, {}, agent)
        if (frame === "subagent")
            void stack.open(subagentView, {item: {list: "tools", key: "email-writer"}}, agent)
        // Open once on mount, like a click.
    }, [])
    return null
}

interface PanelFrameProps {
    frame: Frame
    revisionId: string
    bridge?: SubagentBridgeOptions
    /** Clicks "Show full instructions" once the view shows it (F03 f3). */
    expandInstructions?: boolean
}

const ExpandInstructions = () => {
    useEffect(() => {
        const timer = window.setInterval(() => {
            const link = Array.from(document.querySelectorAll("button")).find(
                (button) => button.textContent?.trim() === "Show full instructions",
            )
            if (link) {
                link.click()
                window.clearInterval(timer)
            }
        }, 100)
        return () => window.clearInterval(timer)
    }, [])
    return null
}

/** The Agent tab's view stack in the right panel, with one subagent view open. */
const PanelFrame = ({frame, revisionId, bridge, expandInstructions}: PanelFrameProps) => (
    <AgentPanelContext.Provider value={panel}>
        <DrillInUIProvider components={{workflowReference: subagentBridge(bridge)}}>
            <div
                data-testid="agent-panel"
                className="ag-panel-raised flex h-[760px] w-[440px] flex-col border border-solid border-border"
            >
                <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                    <Open frame={frame} revisionId={revisionId} />
                    {expandInstructions ? <ExpandInstructions /> : null}
                </ViewStackHost>
            </div>
        </DrillInUIProvider>
    </AgentPanelContext.Provider>
)

const meta = {
    title: "BuilderLayout/mcp-subagents/Subagents",
    component: PanelFrame,
    parameters: {
        layout: "padded",
        agenta: {
            queries: (scope: StoryScope) => subagentQueries(scope),
            args: (scope: StoryScope) => ({revisionId: subagentRevisionId(scope)}),
        },
    },
} satisfies Meta<typeof PanelFrame>

export default meta
type Story = StoryObj<typeof meta>

/** F03 f1: Add subagents. "Email writer" is added; one agent could not be loaded. */
export const AddSubagents: Story = {
    args: {frame: "add", revisionId: "", bridge: {failedSlugs: ["weekly-report"]}},
}

/** F03 f2: one subagent. Only the description can change; Configuration is read-only. */
export const Subagent: Story = {args: {frame: "subagent", revisionId: ""}}

/** F03 f3: "Show full instructions" opens the whole text in a box that scrolls. */
export const SubagentFullInstructions: Story = {
    args: {frame: "subagent", revisionId: "", expandInstructions: true},
}

/** The subagent's configuration could not be read: the description stays editable. */
export const SubagentConfigLoadError: Story = {
    args: {frame: "subagent", revisionId: "", bridge: {detailFailed: true}},
}
