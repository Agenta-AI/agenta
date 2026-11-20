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
    phone: true,
    available: {files: true, configuration: true, builder: true},
}

const Open = ({revisionId}: {revisionId: string}) => {
    const stack = useViewStack()
    useEffect(() => {
        void stack.open(
            integrationView,
            {item: integrationItemRef({provider: "composio", integration: "zendesk"})},
            {kind: "agent_draft", revisionId},
        )
        // Open once on mount, like a tap on the row.
    }, [])
    return null
}

/** The integration view of Zendesk on a 390 x 844 phone (M09), opened from Integrations. */
const PhoneFrame = ({revisionId}: {revisionId: string}) => {
    const editor = useMemo(() => ({revisionId, readOnly: false}), [revisionId])
    return (
        <AgentPanelContext.Provider value={panel}>
            <AgentEditorContext.Provider value={editor}>
                <div
                    data-testid="phone-screen"
                    className="ag-panel-raised flex flex-col border border-solid border-border"
                    style={{width: 390, height: 844}}
                >
                    <ViewStackHost chrome={PanelViewChrome} rootTitle="Integrations" phone>
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
    title: "BuilderLayout/integrations-phone/Integration",
    component: PhoneFrame,
    parameters: {layout: "fullscreen"},
    // useIsPhone reads the viewport, so the canvas must be phone width, not only the frame.
    globals: {viewport: {value: "mobile2", isRotated: false}},
    args: {revisionId: ""},
} satisfies Meta<typeof PhoneFrame>

export default meta
type Story = StoryObj<typeof meta>

/** M09: each person's own account, "Use my default", the default permission and the tools. */
export const EachPersonsOwn: Story = {
    globals: {theme: "light"},
    parameters: {agenta: agenta({source: "user", ownAccounts: true})},
}
export const EachPersonsOwnDark: Story = {
    globals: {theme: "dark"},
    parameters: {agenta: agenta({source: "user", ownAccounts: true})},
}

/** One shared account, the project's connection. */
export const OneSharedAccount: Story = {
    globals: {theme: "light"},
    parameters: {agenta: agenta({source: "agent", ownAccounts: true})},
}

/** Personal accounts off: no switch, as on the desktop. */
export const PersonalAccountsOff: Story = {
    globals: {theme: "light"},
    parameters: {agenta: agenta({source: "agent", ownAccounts: false}, false)},
}
