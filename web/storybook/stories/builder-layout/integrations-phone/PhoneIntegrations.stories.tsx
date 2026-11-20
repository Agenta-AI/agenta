import type {ReactNode} from "react"

import {
    AgentTemplateSectionList,
    PhoneSectionsContext,
    ToolManagementList,
    type AgentTemplateSectionDescriptor,
    type PhoneSectionsApi,
} from "@agenta/entity-ui/drill-in"
import {PhoneScreenHeader} from "@agenta/ui/phone"
import {Plus, Wrench} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the package barrel does not re-export the row builder.
import {buildIntegrationRows} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/toolUtils"
import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {makeAgentConfigFixture} from "../../../fixtures/builderLayout"
import {M08_TOOLS} from "../../../fixtures/builderLayout/integrations-phone"

/** The section shown as its own screen, as a tap on its row does. */
const SHOWN: PhoneSectionsApi = {shownKey: "tools", show: () => undefined}

/** A 390 x 844 phone screen. */
const Phone = ({children}: {children: ReactNode}) => (
    <div
        data-testid="phone-screen"
        className="relative flex flex-col overflow-hidden border border-solid border-border bg-colorBgContainer"
        style={{width: 390, height: 844}}
    >
        {children}
    </div>
)

/** M08: Configuration > Integrations on a phone, "Add integration" at the bottom. */
const Integrations = ({tools}: {tools: unknown[]}) => {
    const sections: AgentTemplateSectionDescriptor[] = [
        {
            key: "tools",
            icon: <Wrench size={16} />,
            title: "Integrations",
            content: (
                <ToolManagementList
                    tools={tools}
                    integrationRows={buildIntegrationRows(tools)}
                    onOpenIntegration={() => undefined}
                    onRemoveIntegration={() => undefined}
                />
            ),
            phoneAction: {
                label: "Add integration",
                icon: <Plus size={16} />,
                onClick: () => undefined,
            },
        },
    ]
    return (
        <Phone>
            <PhoneScreenHeader
                title="Integrations"
                backTitle="Configuration"
                onBack={() => undefined}
            />
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
                <PhoneSectionsContext.Provider value={SHOWN}>
                    <AgentTemplateSectionList sections={sections} />
                </PhoneSectionsContext.Provider>
            </div>
        </Phone>
    )
}

const meta: Meta<typeof Integrations> = {
    title: "BuilderLayout/integrations-phone/Integrations",
    component: Integrations,
    parameters: {
        layout: "fullscreen",
        // The Zendesk name and logo come from the catalog detail.
        agenta: {queries: (scope: StoryScope) => makeAgentConfigFixture(scope).queries},
    },
    args: {tools: M08_TOOLS},
}
export default meta

type Story = StoryObj<typeof meta>

/** M08: Zendesk with "Each person's own account". */
export const List: Story = {globals: {theme: "light"}}
export const ListDark: Story = {globals: {theme: "dark"}}

/** No integration yet: the desktop empty sentence above "Add integration". */
export const Empty: Story = {globals: {theme: "light"}, args: {tools: []}}
