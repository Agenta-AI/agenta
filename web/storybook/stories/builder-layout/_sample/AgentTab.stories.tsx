import type {SchemaProperty} from "@agenta/entities/shared"
import {SchemaPropertyRenderer} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

import type {StoryScope} from "../../../.storybook/decorators/withAgentaData"
import {makeAgentConfigFixture} from "../../../fixtures/builderLayout"

const noop = () => undefined

/** Today's agent configuration form (the Agent tab sections), with the S02 values of "Support triage". */
const Form = ({scopeKey}: {scopeKey?: string}) => {
    const fixture = makeAgentConfigFixture({
        key: scopeKey ?? "sample",
        id: (name: string) => name,
        projectId: "project",
    })
    return (
        <div data-testid="panel-view" className="max-w-[520px] px-4">
            <SchemaPropertyRenderer
                schema={fixture.schema as SchemaProperty}
                label="Agent"
                value={fixture.value}
                onChange={noop}
            />
        </div>
    )
}

const meta = {
    title: "BuilderLayout/_sample/Agent tab",
    component: Form,
    parameters: {
        layout: "padded",
        agenta: {
            queries: (scope: StoryScope) => makeAgentConfigFixture(scope).queries,
        },
    },
} satisfies Meta<typeof Form>

export default meta
type Story = StoryObj<typeof meta>

export const Light: Story = {globals: {theme: "light"}}

export const Dark: Story = {globals: {theme: "dark"}}
