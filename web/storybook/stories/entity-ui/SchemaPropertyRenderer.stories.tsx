import {SchemaPropertyRenderer} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

// SchemaPropertyRenderer — the router that turns one JSON-schema property into a control.
// The inventory value is the BRANCH MATRIX below, which renders every control type the router
// can dispatch to.
const meta = {
    title: "@agenta/entity-ui/DrillIn/SchemaPropertyRenderer",
    component: SchemaPropertyRenderer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Schema → control router (number / enum / boolean / text / textarea / object-inline / messages / prompt / drill-in indicators / hidden).",
            },
        },
    },
} satisfies Meta<typeof SchemaPropertyRenderer>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

/** Labelled cell so a showcase reads as a matrix, not a pile of controls. */
const Case = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="flex flex-col gap-1 border-0 border-b border-solid border-colorBorderSecondary py-3">
        <div className="text-[10px] uppercase tracking-wide text-colorTextTertiary">{label}</div>
        {children}
    </div>
)

/** Every scalar branch: number, text, textarea, enum, boolean. */
export const ScalarBranches: Story = {
    args: {schema: {type: "string"}, label: "Value", value: "", onChange: noop},
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Case label="number → NumberSliderControl">
                <SchemaPropertyRenderer
                    schema={{type: "number", minimum: 0, maximum: 2}}
                    label="Temperature"
                    value={0.7}
                    onChange={noop}
                />
            </Case>
            <Case label="string → TextInputControl">
                <SchemaPropertyRenderer
                    schema={{type: "string", description: "Shown as a tooltip."}}
                    label="Name"
                    value="greeter"
                    onChange={noop}
                />
            </Case>
            <Case label="string + multiline → TextInputControl multiline">
                <SchemaPropertyRenderer
                    schema={{type: "string", "x-parameters": {multiline: true}}}
                    label="Instructions"
                    value={"Be terse.\nAnswer in one line."}
                    onChange={noop}
                />
            </Case>
            <Case label="enum → EnumSelectControl">
                <SchemaPropertyRenderer
                    schema={{type: "string", enum: ["text", "json_object", "json_schema"]}}
                    label="Output type"
                    value="text"
                    onChange={noop}
                />
            </Case>
            <Case label="boolean → BooleanToggleControl">
                <SchemaPropertyRenderer
                    schema={{type: "boolean"}}
                    label="Stream"
                    value={true}
                    onChange={noop}
                />
            </Case>
        </div>
    ),
}

/** Composite branches: inline object, drill-in indicators, hidden, unknown fallback. */
export const CompositeBranches: Story = {
    args: {schema: {type: "string"}, label: "Value", value: "", onChange: noop},
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Case label="object (drill-in indicator)">
                <SchemaPropertyRenderer
                    schema={{
                        type: "object",
                        properties: {a: {type: "string"}, b: {type: "number"}},
                    }}
                    label="Advanced config"
                    value={{a: "x", b: 1}}
                    onChange={noop}
                />
            </Case>
            <Case label="array (drill-in indicator)">
                <SchemaPropertyRenderer
                    schema={{type: "array", items: {type: "string"}}}
                    label="Stop sequences"
                    value={["\\n", "###"]}
                    onChange={noop}
                />
            </Case>
            <Case label='x-ag-type "hidden" → renders nothing'>
                <SchemaPropertyRenderer
                    schema={{type: "string", "x-ag-type": "hidden"} as never}
                    label="Internal"
                    value="secret"
                    onChange={noop}
                />
            </Case>
            <Case label="unknown type → JSON text fallback">
                <SchemaPropertyRenderer
                    schema={{type: "weird-thing"} as never}
                    label="Raw"
                    value={{some: "object"}}
                    onChange={noop}
                />
            </Case>
        </div>
    ),
}

/** Disabled: every dispatched control must take the disabled skin. */
export const Disabled: Story = {
    args: {schema: {type: "string"}, label: "Value", value: "", onChange: noop},
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Case label="number">
                <SchemaPropertyRenderer
                    schema={{type: "number", minimum: 0, maximum: 2}}
                    label="Temperature"
                    value={0.7}
                    disabled
                    onChange={noop}
                />
            </Case>
            <Case label="enum">
                <SchemaPropertyRenderer
                    schema={{type: "string", enum: ["a", "b"]}}
                    label="Mode"
                    value="a"
                    disabled
                    onChange={noop}
                />
            </Case>
            <Case label="boolean">
                <SchemaPropertyRenderer
                    schema={{type: "boolean"}}
                    label="Stream"
                    value={false}
                    disabled
                    onChange={noop}
                />
            </Case>
        </div>
    ),
}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

export const Variants: Story = {
    args: {schema: {type: "string"}, label: "Value", value: "", onChange: noop},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="object indicator">
                <SchemaPropertyRenderer
                    schema={{
                        type: "object",
                        properties: {a: {type: "string"}, b: {type: "number"}},
                    }}
                    label="Advanced config"
                    value={{a: "x", b: 1}}
                    onChange={noop}
                />
            </Row>
            <Row label="array indicator">
                <SchemaPropertyRenderer
                    schema={{type: "array", items: {type: "string"}}}
                    label="Stop sequences"
                    value={["a", "b"]}
                    onChange={noop}
                />
            </Row>
        </div>
    ),
}
