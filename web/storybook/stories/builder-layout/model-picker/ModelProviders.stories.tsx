import {useEffect} from "react"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import {
    builtinModelsView,
    providerAddView,
    providerListView,
} from "@agenta/entity-ui/secretProvider"
import {userAtom} from "@agenta/shared/state"
import {useViewStack, ViewStackHost, type ViewTarget} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    MODEL_PICKER_USER_ID,
    modelProvidersQueries,
} from "../../../fixtures/builderLayout/model-picker"

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

type Frame = "list" | "add" | "builtin"

const PROJECT: ViewTarget = {kind: "project"}

const VIEWS = {list: providerListView, add: providerAddView, builtin: builtinModelsView}

/**
 * Opens the frame's view at depth 1. In the panel the add view and the card open one level
 * under the list; the story opens them alone, so the crumb skips "Model providers".
 */
const Open = ({frame}: {frame: Frame}) => {
    const stack = useViewStack()
    useEffect(() => {
        void stack.open(VIEWS[frame], {}, PROJECT)
        // Open once on mount, like a click.
    }, [])
    return null
}

const PanelFrame = ({frame}: {frame: Frame}) => (
    <AgentPanelContext.Provider value={panel}>
        <div
            data-testid="agent-panel"
            className="ag-panel-raised flex h-[720px] flex-col border border-solid border-border"
            style={{width: 440}}
        >
            <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                <Open frame={frame} />
            </ViewStackHost>
        </div>
    </AgentPanelContext.Provider>
)

const meta = {
    title: "BuilderLayout/model-picker/Model providers",
    component: PanelFrame,
    parameters: {
        layout: "padded",
        agenta: {
            atoms: [[userAtom, {id: MODEL_PICKER_USER_ID, email: "bob@acme.com"}]] as [
                typeof userAtom,
                unknown,
            ][],
            queries: (scope: StoryScope) => modelProvidersQueries(scope),
        },
    },
} satisfies Meta<typeof PanelFrame>

export default meta
type Story = StoryObj<typeof meta>

/** F09 f1: what the project has, with "Add a provider or subscription" fixed at the bottom. */
export const List: Story = {args: {frame: "list"}}

/** F09 f1b: a subscription or an API key, the production catalog in production order. */
export const Add: Story = {args: {frame: "add"}}

/** F09 f1c: the built-in models, with no switches, and Done. */
export const Builtin: Story = {args: {frame: "builtin"}}
