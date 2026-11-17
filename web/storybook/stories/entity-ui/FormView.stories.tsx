import {useState} from "react"

import {FormView} from "@agenta/entity-ui/view-types"
import {Button, Input, InputNumber, Switch} from "@agenta/ui/ui"
import {MinusCircle, Plus} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * FormView is a recursive composite. `Variants` isolates its leaf controls (number, boolean,
 * null, array row remove, array add row); the full composite renders in the `Showcase` story.
 */
const meta = {
    title: "@agenta/entity-ui/ViewTypes/FormView",
    component: FormView,
} satisfies Meta<typeof FormView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_auto] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[280px] shrink-0 flex items-center">{children}</div>
    </div>
)

// The exact inline styles FormView passes to its leaves.
const numberStyle = {width: 240}
const inputStyle = {fontSize: 13, maxWidth: 480}
const removeStyle = {color: "var(--ag-colorTextTertiary)"}
const addRowStyle = {alignSelf: "flex-start", marginTop: 4} as const

export const Variants: Story = {
    args: {value: {}, onChange: noop},
    render: () => (
        <div className="flex flex-col max-w-[960px]">
            <Row label="number leaf">
                <InputNumber
                    size="middle"
                    value={42}
                    onChange={noop}
                    placeholder="Enter number value"
                    className="[&_input]:text-[13px]"
                    style={numberStyle}
                />
            </Row>
            <Row label="number leaf · disabled">
                <InputNumber
                    size="middle"
                    value={42}
                    disabled
                    onChange={noop}
                    placeholder="Enter number value"
                    className="[&_input]:text-[13px]"
                    style={numberStyle}
                />
            </Row>
            <Row label="boolean leaf">
                <Switch checked onCheckedChange={noop} aria-label="boolean leaf" />
            </Row>
            <Row label="boolean leaf · off, disabled">
                <Switch
                    checked={false}
                    disabled
                    onCheckedChange={noop}
                    aria-label="boolean leaf, off and disabled"
                />
            </Row>
            <Row label="null leaf">
                <Input value="" placeholder="null" onChange={noop} style={inputStyle} />
            </Row>
            <Row label="array row remove">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove row 0"
                    style={removeStyle}
                >
                    <MinusCircle size={14} />
                </Button>
            </Row>
            <Row label="array add row">
                <Button variant="dashed" size="sm" style={addRowStyle}>
                    <Plus size={14} />
                    Add row
                </Button>
            </Row>
        </div>
    ),
}

const SHOWCASE_VALUE = {
    name: "Ada Lovelace",
    stars: 42,
    active: true,
    missing: null,
    profile: {
        bio: "First programmer.",
        links: ["https://example.com", "https://example.org"],
    },
}

const SHOWCASE_SCHEMA = {
    type: "object",
    properties: {
        name: {type: "string"},
        stars: {type: "number"},
        active: {type: "boolean"},
        missing: {type: "null"},
        profile: {
            type: "object",
            properties: {
                bio: {type: "string"},
                links: {type: "array", items: {type: "string"}},
            },
        },
    },
}

const ShowcaseDemo = () => {
    const [value, setValue] = useState<Record<string, unknown>>(SHOWCASE_VALUE)
    return (
        <div className="max-w-[720px]">
            <FormView
                value={value}
                onChange={(next) => setValue(next as Record<string, unknown>)}
                editable
                schema={SHOWCASE_SCHEMA}
            />
        </div>
    )
}

/** Full recursive composite (editable) — showcase. */
export const Showcase: Story = {
    args: {value: SHOWCASE_VALUE, onChange: noop, editable: true},
    render: () => <ShowcaseDemo />,
}
