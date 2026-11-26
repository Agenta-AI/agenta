import {useEffect} from "react"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import {integrationConnectView} from "@agenta/entity-ui/gatewayTool"
import {
    useViewStack,
    ViewDrawerHost,
    ViewStackHost,
    type ViewDef,
    type ViewTarget,
} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the package barrel does not re-export the views of the slice.
import {integrationItemRef} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/itemKinds/tool"
import {instructionsView} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/views/instructionsView"
import {integrationAddView} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/views/integrationAddView"
import {integrationView} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/views/integrationView"
import {modelView} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/views/modelView"
import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    configSliceQueries,
    configSliceRevisionId,
} from "../../../fixtures/builderLayout/foundation-a2"

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

type Frame = "instructions" | "model" | "add" | "connect" | "integration"

/** Opens the frame's view the way a row or "+" does, then the connect view for "connect". */
const Open = ({frame, revisionId}: {frame: Frame; revisionId: string}) => {
    const stack = useViewStack()
    useEffect(() => {
        const agent: ViewTarget = {kind: "agent_draft", revisionId}
        const open = <P,>(view: ViewDef<P>, params: P) => void stack.open(view, params, agent)
        if (frame === "instructions") open(instructionsView, {file: "AGENTS.md"})
        if (frame === "model") open(modelView, {})
        if (frame === "add" || frame === "connect") open(integrationAddView, {})
        if (frame === "integration")
            open(integrationView, {
                item: integrationItemRef({provider: "composio", integration: "zendesk"}),
            })
        // Open once on mount, like a click.
    }, [])
    return null
}

/** The Agent tab's view stack in the right panel, with one view of the slice open. */
const PanelFrame = ({frame, revisionId}: {frame: Frame; revisionId: string}) => (
    <AgentPanelContext.Provider value={panel}>
        <div
            data-testid="agent-panel"
            className="ag-panel-raised flex h-[720px] flex-col border border-solid border-border"
            style={{width: frame === "instructions" ? 760 : 440}}
        >
            <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                <Open frame={frame} revisionId={revisionId} />
            </ViewStackHost>
        </div>
    </AgentPanelContext.Provider>
)

const meta = {
    title: "BuilderLayout/foundation-a2/Config slice",
    component: PanelFrame,
    parameters: {
        layout: "padded",
        agenta: {
            queries: (scope: StoryScope) => configSliceQueries(scope),
            args: (scope: StoryScope) => ({revisionId: configSliceRevisionId(scope)}),
        },
    },
} satisfies Meta<typeof PanelFrame>

export default meta
type Story = StoryObj<typeof meta>

/** F01 f3: AGENTS.md edge to edge, with Cancel and Save. */
export const Instructions: Story = {args: {frame: "instructions", revisionId: ""}}

/** F01 f2: today's model list; a pick applies at once, so the view has Done. */
export const Model: Story = {args: {frame: "model", revisionId: ""}}

/** F02 f4: Add integration, a picker over the project's apps. */
export const AddIntegration: Story = {args: {frame: "add", revisionId: ""}}

/** F02 f6: one integration, with its account and permissions as today, and Remove from agent. */
export const Integration: Story = {args: {frame: "integration", revisionId: ""}}

/** F02 f5 in Settings › Integrations: the connect view in a drawer, with the target project. */
export const ConnectInSettings: Story = {
    args: {frame: "connect", revisionId: ""},
    render: () => (
        <ViewDrawerHost
            request={{
                view: integrationConnectView,
                params: {integrationKey: "github"},
                target: {kind: "project"},
            }}
            onClosed={() => undefined}
        />
    ),
}
