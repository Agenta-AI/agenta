import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: the package barrel does not export the catalog.
import {IntegrationCatalog} from "../../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/IntegrationCatalog"
import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {GITHUB_WORK, integrationQueries, SLACK_OPS} from "../../../fixtures/gatewayIntegration"

const noop = () => undefined

/** The one catalog where there is no agent (chat, playground, prompts): browse and connect. */
const Frame = () => (
    <div data-testid="catalog-no-agent" className="flex h-[560px] w-[440px] flex-col">
        <IntegrationCatalog onConnect={noop} />
    </div>
)

const meta = {
    title: "BuilderLayout/integrations/Catalog with no agent",
    component: Frame,
    parameters: {
        layout: "padded",
        agenta: {
            queries: (scope: StoryScope) =>
                integrationQueries(scope, {connections: [GITHUB_WORK, SLACK_OPS]}),
        },
    },
} satisfies Meta<typeof Frame>

export default meta
type Story = StoryObj<typeof meta>

/** Connected apps listed with no Add; every app connects to the project. */
export const Default: Story = {}
