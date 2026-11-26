import {useState} from "react"

import {InputVariableCard, UnusedColumnsToggle} from "@agenta/playground-ui/panels/inputs"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {userEvent, within} from "storybook/test"

import {withAppBoxSizing} from "./borderBox"

/**
 * The extras around the input cards of a test case in the /m prompt playground: the banner that
 * offers the prompt's nested shape, the nested keys the prompt does not reference, the columns it
 * does not reference, and the mark on a row that comes from a test set.
 */
const geoSchema = {
    type: "object",
    properties: {
        region: {type: "string"},
        place: {type: "object", properties: {name: {type: "string"}}},
    },
}

const Card = ({
    value: initial,
    connectedSourceName,
    editable = true,
}: {
    value: unknown
    connectedSourceName?: string | null
    editable?: boolean
}) => {
    const [value, setValue] = useState(initial)
    return (
        <div className="w-full max-w-[560px] bg-background p-4 text-foreground">
            <InputVariableCard
                rowId="row-1"
                variable={{
                    name: "geo",
                    value,
                    expectedType: "object",
                    expectedSchema: geoSchema,
                }}
                editable={editable}
                connectedSourceName={connectedSourceName}
                onValueChange={(_name, next) => setValue(next)}
            />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Playground/InputExtras",
    component: Card,
    decorators: [withAppBoxSizing],
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

/** The prompt expects `place.name`, the test case holds a plain `place`. */
export const ShapeConflict: Story = {args: {value: {region: "EU", place: "Paris"}}}

export const ShapeConflictMany: Story = {
    args: {
        value: {region: "EU", place: "Paris"},
    },
    render: () => (
        <div className="w-full max-w-[560px] bg-background p-4 text-foreground">
            <InputVariableCard
                rowId="row-many"
                variable={{
                    name: "geo",
                    value: {a: "x", b: "y"},
                    expectedType: "object",
                    expectedSchema: {
                        type: "object",
                        properties: {
                            a: {type: "object", properties: {name: {type: "string"}}},
                            b: {type: "object", properties: {name: {type: "string"}}},
                        },
                    },
                }}
                editable
                onValueChange={() => undefined}
            />
        </div>
    ),
}

/** Nested keys the prompt does not reference stay on the test case; the footer lists them. */
export const StashedKeys: Story = {
    args: {value: {region: "EU", place: {name: "Paris"}, note: "", extra: {deep: 1}, count: 4}},
    play: async ({canvasElement}) => {
        await userEvent.click(await within(canvasElement).findByText(/unused nested keys hidden/))
    },
}

const unused = [
    {name: "notes", value: "Checked by hand"},
    {name: "source", value: {site: "example.org", year: 2024}},
]

const Unused = () => (
    <div className="w-full max-w-[560px] bg-background p-4 text-foreground">
        <UnusedColumnsToggle rowId="row-unused" columns={unused} />
    </div>
)

export const UnusedColumnsClosed: Story = {args: {value: {}}, render: () => <Unused />}

export const UnusedColumnsOpen: Story = {
    args: {value: {}},
    render: () => <Unused />,
    play: async ({canvasElement}) => {
        await userEvent.click(await within(canvasElement).findByText(/unused test case columns/))
    },
}

/** The row comes from a test set: a database mark with the test set's name in its tooltip. */
export const SyncedFrom: Story = {
    args: {value: {region: "EU", place: {name: "Paris"}}, connectedSourceName: "Capitals (v2)"},
}

export const Phone: Story = {
    args: {value: {region: "EU", place: "Paris"}, connectedSourceName: "Capitals (v2)"},
    parameters: {viewport: {defaultViewport: "mobile1"}},
}
