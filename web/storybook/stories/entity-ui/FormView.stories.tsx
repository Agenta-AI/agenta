import {useState} from "react"

import {FormView} from "@agenta/entity-ui/view-types"
import {Button, Input, InputNumber, Switch} from "@agenta/ui/ui"
import {MinusCircle, Plus} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {
    Button as AntButton,
    Input as AntInput,
    InputNumber as AntInputNumber,
    Switch as AntSwitch,
} from "antd"

/**
 * Parity story for the antd→@agenta/ui migration of `FormView` (view-types).
 * FormView is a recursive composite, so the VRT-gated rows isolate the four antd
 * LEAF swaps with the exact pre-migration props/styles — verified against
 * `git show feat/storybook-data-seam:web/packages/agenta-entity-ui/src/view-types/FormView.tsx`
 * (number leaf: antd `InputNumber size="middle"` w240/13px; null leaf: antd `Input`
 * maxW480/13px; boolean leaf: antd `Switch`; array row remove: antd
 * `Button type="text" size="small"` icon-only; add row: antd `Button type="dashed"
 * size="small"`). The full composite renders in the `Showcase` story (both themes),
 * which is not a pixel pair.
 */
const meta = {
    title: "@agenta/entity-ui/ViewTypes/FormView",
    component: FormView,
} satisfies Meta<typeof FormView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

// Subject boxes are `flex items-center` so inline-level controls don't add baseline slack
// below them — antd (inline-block) and agenta (inline-flex) compute different slack, which
// pads the two crops to different heights and reads as a phantom diff.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_auto_auto] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-12 shrink-0">antd</span>
            <div className="w-[280px] shrink-0 flex items-center" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-12 shrink-0">agenta</span>
            <div className="w-[280px] shrink-0 flex items-center" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

// The exact inline styles FormView passes to its leaves (pre- and post-migration).
const numberStyle = {fontSize: 13, width: 240} // pre-migration: 13px inherits from the root
const numberStyleAgenta = {width: 240} // post-migration: 13px via the `[&_input]` className
const inputStyle = {fontSize: 13, maxWidth: 480}
const removeStyle = {color: "var(--ag-colorTextTertiary)"}
const addRowStyle = {alignSelf: "flex-start", marginTop: 4} as const

export const AntdVsAgenta: Story = {
    args: {value: {}, onChange: noop},
    render: () => (
        <div className="flex flex-col max-w-[960px]">
            <Row
                label="number leaf"
                a={
                    <AntInputNumber
                        size="middle"
                        value={42}
                        onChange={noop}
                        placeholder="Enter number value"
                        style={numberStyle}
                    />
                }
                s={
                    <InputNumber
                        size="middle"
                        value={42}
                        onChange={noop}
                        placeholder="Enter number value"
                        className="[&_input]:text-[13px]"
                        style={numberStyleAgenta}
                    />
                }
            />
            <Row
                label="number leaf · disabled"
                a={
                    <AntInputNumber
                        size="middle"
                        value={42}
                        disabled
                        onChange={noop}
                        placeholder="Enter number value"
                        style={numberStyle}
                    />
                }
                s={
                    <InputNumber
                        size="middle"
                        value={42}
                        disabled
                        onChange={noop}
                        placeholder="Enter number value"
                        className="[&_input]:text-[13px]"
                        style={numberStyleAgenta}
                    />
                }
            />
            <Row
                label="boolean leaf"
                a={<AntSwitch checked onChange={noop} />}
                s={<Switch checked onCheckedChange={noop} aria-label="boolean leaf" />}
            />
            <Row
                label="boolean leaf · off, disabled"
                a={<AntSwitch checked={false} disabled onChange={noop} />}
                s={
                    <Switch
                        checked={false}
                        disabled
                        onCheckedChange={noop}
                        aria-label="boolean leaf, off and disabled"
                    />
                }
            />
            <Row
                label="null leaf"
                a={
                    <AntInput
                        size="middle"
                        value=""
                        placeholder="null"
                        onChange={noop}
                        style={inputStyle}
                    />
                }
                s={<Input value="" placeholder="null" onChange={noop} style={inputStyle} />}
            />
            <Row
                label="array row remove"
                a={
                    <AntButton
                        type="text"
                        size="small"
                        icon={<MinusCircle size={14} />}
                        aria-label="Remove row 0"
                        style={removeStyle}
                    />
                }
                s={
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove row 0"
                        style={removeStyle}
                    >
                        <MinusCircle size={14} />
                    </Button>
                }
            />
            <Row
                label="array add row"
                a={
                    <AntButton
                        type="dashed"
                        size="small"
                        icon={<Plus size={14} />}
                        style={addRowStyle}
                    >
                        Add row
                    </AntButton>
                }
                s={
                    <Button variant="dashed" size="sm" style={addRowStyle}>
                        <Plus size={14} />
                        Add row
                    </Button>
                }
            />
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

/** Full recursive composite (editable) — showcase, not a pixel pair. */
export const Showcase: Story = {
    args: {value: SHOWCASE_VALUE, onChange: noop, editable: true},
    render: () => <ShowcaseDemo />,
}
