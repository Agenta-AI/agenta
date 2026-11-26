import {useState} from "react"

import type {PlaygroundInputVariable} from "@agenta/playground-ui/hooks"
import {InputVariableCard} from "@agenta/playground-ui/panels/inputs"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * One input of a test case in the /m prompt playground: the variable's name, type and view switch
 * above its editor. Every edit is a native value: a number stays a number, an object an object.
 */
const Demo = ({
    variable,
    editable = true,
}: {
    variable: PlaygroundInputVariable
    editable?: boolean
}) => {
    const [value, setValue] = useState(variable.value)
    return (
        <div className="w-full max-w-[560px] bg-background p-4 text-foreground">
            <InputVariableCard
                rowId={`row-${variable.name}`}
                variable={{...variable, value}}
                editable={editable}
                onValueChange={(_name, next) => setValue(next)}
            />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Playground/InputVariableCard",
    component: Demo,
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const Text: Story = {args: {variable: {name: "country", value: "France"}}}

export const Number: Story = {args: {variable: {name: "max_results", value: 5}}}

export const Boolean: Story = {args: {variable: {name: "formal", value: true}}}

export const JsonObject: Story = {
    args: {
        variable: {
            name: "filters",
            value: {region: "EU", tags: ["capital", "europe"]},
            expectedType: "object",
        },
    },
}

/** The prompt uses `{{geo.region}}` and the test case has no `geo` yet: the shape shows, nothing is stored. */
export const DraftWithSchema: Story = {
    args: {
        variable: {
            name: "geo",
            value: undefined,
            isDraft: true,
            expectedType: "object",
            expectedSchema: {
                type: "object",
                properties: {region: {type: "string"}, subregion: {type: "string"}},
            },
        },
    },
}

export const ReadOnly: Story = {
    args: {variable: {name: "country", value: "France"}, editable: false},
}
