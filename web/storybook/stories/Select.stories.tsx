import {useState} from "react"

import {
    Select as ShadSelect,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Select as AntSelect} from "antd"

const meta = {
    title: "@agenta/ui/Primitives/Forms/Select",
    component: ShadSelect,
    subcomponents: {SelectTrigger, SelectContent, SelectItem, SelectValue},
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Select (Radix-based) that replaces antd `Select`. Compose `Select` > `SelectTrigger` > `SelectContent` > `SelectItem`; prop tables for each part are below.\n\n**Used in:** 2 places only — the drill-in controls and the drill-in JSON array field. Everything else that looks like a select in the app is either antd or the `Combobox`.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// Selects are width:100% — each side gets an identical fixed-width box so `width`
// measures the component rather than how a flex cell squeezed it. Same as Input.
const CONTROL_BOX = "w-[220px] shrink-0"

// data-vrt-subject on the sizing box: the antd cell holds .ant-select + inner input (2 candidates).
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_auto_auto] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-12 shrink-0">antd</span>
            <div className={CONTROL_BOX} data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] text-colorTextSecondary w-12 shrink-0">agenta</span>
            <div className={CONTROL_BOX} data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

const OPTIONS = [
    {value: "a", label: "Option A"},
    {value: "b", label: "Option B"},
    {value: "c", label: "Option C"},
]

const Shad = ({
    size,
    variant,
    disabled,
    placeholder = "Select",
    value,
}: {
    size?: "sm" | "default" | "lg"
    variant?: "default" | "filled" | "ghost"
    disabled?: boolean
    placeholder?: string
    value?: string
}) => (
    <ShadSelect defaultValue={value} disabled={disabled}>
        <SelectTrigger size={size} variant={variant}>
            <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
            {OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                    {o.label}
                </SelectItem>
            ))}
        </SelectContent>
    </ShadSelect>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex flex-col max-w-[900px]">
            <Row
                label="placeholder"
                a={<AntSelect className="w-full" placeholder="Select" options={OPTIONS} />}
                s={<Shad />}
            />
            <Row
                label="with value"
                a={<AntSelect className="w-full" defaultValue="a" options={OPTIONS} />}
                s={<Shad value="a" />}
            />
            <Row
                label="small → sm"
                a={<AntSelect className="w-full" size="small" defaultValue="a" options={OPTIONS} />}
                s={<Shad size="sm" value="a" />}
            />
            <Row
                label="large → lg"
                a={<AntSelect className="w-full" size="large" defaultValue="a" options={OPTIONS} />}
                s={<Shad size="lg" value="a" />}
            />
            <Row
                label="disabled"
                a={<AntSelect className="w-full" disabled defaultValue="a" options={OPTIONS} />}
                s={<Shad disabled value="a" />}
            />
            <Row
                label="borderless → ghost"
                a={
                    <AntSelect
                        className="w-full"
                        variant="borderless"
                        defaultValue="a"
                        options={OPTIONS}
                    />
                }
                s={<Shad variant="ghost" value="a" />}
            />
        </div>
    ),
}

// Forced-OPEN state rendered INLINE (portal container) so antd and agenta open panels sit
// side by side for static comparison. antd: `open` + `getPopupContainer`. @agenta/ui Radix Select:
// `defaultOpen` (Root passthrough) + `container` on SelectContent.
const SELECT_OPTS = [
    {value: "a", label: "Option A"},
    {value: "b", label: "Option B"},
    {value: "c", label: "Option C"},
]

function Panel({render}: {render: (c: HTMLElement) => React.ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        <div ref={setEl} className="relative min-h-[180px] w-[220px]">
            {el && render(el)}
        </div>
    )
}

export const OpenState: Story = {
    render: () => (
        <div
            className="flex gap-24 p-4"
            data-open-compare
            data-vrt-expected="deliberate: selected-check kept (antd v6 has none) — panel width/chrome verified separately"
        >
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">antd</div>
                <Panel
                    render={(c) => (
                        <AntSelect
                            open
                            getPopupContainer={() => c}
                            defaultValue="b"
                            options={SELECT_OPTS}
                            style={{width: 220}}
                        />
                    )}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
                <Panel
                    render={(c) => (
                        <ShadSelect defaultValue="b" defaultOpen>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent container={c}>
                                {SELECT_OPTS.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                        {o.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </ShadSelect>
                    )}
                />
            </div>
        </div>
    ),
}

// Trigger interaction states, forced statically. antd Select hover is CSS `:hover`
// (pseudo-hover-all); antd focus is a JS class (`.ant-select-focused`), forced directly. The
// agenta trigger is a Radix button, so pseudo-focus-all engages its `focus:` glow.
const StateRow = ({
    label,
    cls,
    a,
    s,
}: {
    label: string
    cls: string
    a: React.ReactNode
    s: React.ReactNode
}) => (
    <div className="grid grid-cols-[16rem_auto_auto] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={`${cls} flex items-center gap-2`}>
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {/* subject INSIDE the pseudo wrapper so the crop keeps the forced state */}
            <div className={CONTROL_BOX} data-vrt-subject>
                {a}
            </div>
        </div>
        <div className={`${cls} flex items-center gap-2`}>
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div className={CONTROL_BOX} data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <StateRow
                label="trigger · hover"
                cls="pseudo-hover-all"
                a={<AntSelect className="w-full" defaultValue="a" options={OPTIONS} />}
                s={<Shad value="a" />}
            />
            <StateRow
                label="trigger · focus (glow)"
                cls="pseudo-focus-all"
                a={
                    <AntSelect
                        className="ant-select-focused w-full"
                        defaultValue="a"
                        options={OPTIONS}
                    />
                }
                s={<Shad value="a" />}
            />
        </div>
    ),
}
