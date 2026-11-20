import {useEffect, useMemo} from "react"

import {AgentPanelContext, type AgentPanelApi} from "@/features/agent-layout/agentPanelContext"
import {PanelViewChrome} from "@/features/agent-layout/PanelViewChrome"
import {AgentEditorContext} from "@agenta/entity-ui/drill-in"
import {userAtom} from "@agenta/shared/state"
import {useViewStack, ViewStackHost} from "@agenta/ui/view-stack"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the package barrel does not re-export the views.
import {integrationItemRef} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/itemKinds/tool"
import {integrationView} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/views/integrationView"
import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {
    integrationAccountQueries,
    integrationAccountRevisionId,
    VIEWER,
    type AccountFrame,
} from "../../../fixtures/builderLayout/integrations"

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

const Open = ({revisionId}: {revisionId: string}) => {
    const stack = useViewStack()
    useEffect(() => {
        void stack.open(
            integrationView,
            {item: integrationItemRef({provider: "composio", integration: "zendesk"})},
            {kind: "agent_draft", revisionId},
        )
        // Open once on mount, like a click on the row.
    }, [])
    return null
}

interface FrameProps {
    revisionId: string
    hasChannel?: boolean
}

/** The integration view of Zendesk in the right panel. */
const PanelFrame = ({revisionId, hasChannel}: FrameProps) => {
    const editor = useMemo(
        () => ({revisionId, readOnly: false, hasChannel}),
        [revisionId, hasChannel],
    )
    return (
        <AgentPanelContext.Provider value={panel}>
            <AgentEditorContext.Provider value={editor}>
                <div
                    data-testid="agent-panel"
                    className="ag-panel-raised flex h-[760px] w-[440px] flex-col border border-solid border-border"
                >
                    <ViewStackHost chrome={PanelViewChrome} rootTitle="Agent">
                        <Open revisionId={revisionId} />
                    </ViewStackHost>
                </div>
            </AgentEditorContext.Provider>
        </AgentPanelContext.Provider>
    )
}

const agenta = (frame: AccountFrame, viewer = true) => ({
    queries: (scope: StoryScope) => integrationAccountQueries(scope, frame),
    args: (scope: StoryScope) => ({revisionId: integrationAccountRevisionId(scope)}),
    // Without a viewer the own-accounts read never runs: the app shows it as personal accounts off.
    ...(viewer ? {atoms: [[userAtom, VIEWER]]} : {}),
})

const meta = {
    title: "BuilderLayout/integrations/Integration account",
    component: PanelFrame,
    parameters: {layout: "padded"},
} satisfies Meta<typeof PanelFrame>

export default meta
type Story = StoryObj<typeof meta>

/** F10 f1: each person's own account, "Use my default" with the viewer's default. */
export const EachPersonsOwn: Story = {
    args: {revisionId: ""},
    parameters: {agenta: agenta({source: "user", ownAccounts: true})},
}

/** F10 f3: the viewer has no Zendesk account yet. */
export const NoAccountYet: Story = {
    args: {revisionId: ""},
    parameters: {agenta: agenta({source: "user", ownAccounts: false})},
}

/** F10 f4: one shared account, the project's connection. */
export const OneSharedAccount: Story = {
    args: {revisionId: ""},
    parameters: {agenta: agenta({source: "agent", ownAccounts: true})},
}

/** F10 f6: each person's own, and the agent has a channel: runs without a person warn. */
export const RunsWithoutPersonChannel: Story = {
    args: {revisionId: "", hasChannel: true},
    parameters: {agenta: agenta({source: "user", ownAccounts: true})},
}

/** F10 f6: each person's own, and an automation of the agent was created with an API key. */
export const RunsWithoutPersonApiKey: Story = {
    args: {revisionId: ""},
    parameters: {agenta: agenta({source: "user", ownAccounts: true, apiKeyAutomation: true})},
}

/** Personal accounts off: no switch, only "Shared account". */
export const PersonalAccountsOff: Story = {
    args: {revisionId: ""},
    parameters: {agenta: agenta({source: "agent", ownAccounts: false}, false)},
}
