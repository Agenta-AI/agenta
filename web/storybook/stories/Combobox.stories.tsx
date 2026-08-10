import {useState} from "react"

import {Combobox, type ComboboxOption} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Select as AntSelect} from "antd"

const meta = {
    title: "@agenta/ui/Primitives/Forms/Combobox",
    component: Combobox,
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Combobox — a searchable single-select that replaces antd `Select` with `showSearch`.\n\n**Used in:** 2 places, both inside `@agenta/ui` — `PathSelectorDropdown` (which itself has no call-sites) and the entity picker hierarchy-level select. No app file composes it directly.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

const CONTROL_BOX = "w-[220px] shrink-0"

// data-vrt-subject on the sizing box: both cells hold trigger + inner input (2 candidates).
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

const FRUITS: ComboboxOption[] = [
    {value: "apple", label: "Apple", searchValue: "Apple"},
    {value: "banana", label: "Banana", searchValue: "Banana"},
    {value: "cherry", label: "Cherry", searchValue: "Cherry"},
    {value: "date", label: "Date", searchValue: "Date"},
]
const ANT_OPTIONS = FRUITS.map((f) => ({value: f.value, label: f.searchValue}))

const GROUPED = [
    {
        label: "Citrus",
        options: [
            {value: "orange", label: "Orange", searchValue: "Orange"},
            {value: "lemon", label: "Lemon", searchValue: "Lemon"},
        ],
    },
    {
        label: "Berries",
        options: [
            {value: "straw", label: "Strawberry", searchValue: "Strawberry"},
            {value: "blue", label: "Blueberry", searchValue: "Blueberry"},
        ],
    },
]

export const Grouped: Story = {
    render: function GroupedStory() {
        const [v, setV] = useState<string | undefined>("lemon")
        return (
            <div className="w-[240px] p-4">
                <Combobox
                    aria-label="Fruit"
                    options={GROUPED}
                    value={v}
                    onChange={setV}
                    allowClear
                />
            </div>
        )
    },
}

// The two migration targets both use showSearch + allowClear. This is the antd shape
// being replaced side-by-side with the Combobox.
export const AntdVsAgenta: Story = {
    render: function AntdVsAgentaStory() {
        const [v1, setV1] = useState<string>()
        const [v2, setV2] = useState<string | undefined>("banana")
        return (
            <div className="flex flex-col max-w-[900px]">
                <Row
                    label="placeholder (closed)"
                    a={
                        <AntSelect
                            className="w-full"
                            showSearch
                            allowClear
                            placeholder="Select"
                            options={ANT_OPTIONS}
                        />
                    }
                    s={
                        <Combobox
                            options={FRUITS}
                            value={v1}
                            onChange={setV1}
                            allowClear
                            placeholder="Select"
                        />
                    }
                />
                <Row
                    label="with value + clear"
                    a={
                        <AntSelect
                            className="w-full"
                            showSearch
                            allowClear
                            defaultValue="banana"
                            options={ANT_OPTIONS}
                        />
                    }
                    s={
                        <Combobox
                            aria-label="Fruit"
                            options={FRUITS}
                            value={v2}
                            onChange={setV2}
                            allowClear
                        />
                    }
                />
                <Row
                    label="disabled"
                    a={
                        <AntSelect
                            className="w-full"
                            showSearch
                            disabled
                            defaultValue="banana"
                            options={ANT_OPTIONS}
                        />
                    }
                    s={<Combobox aria-label="Fruit" options={FRUITS} value="banana" disabled />}
                />
                <Row
                    label="loading"
                    a={
                        <AntSelect
                            className="w-full"
                            showSearch
                            loading
                            placeholder="Select"
                            options={ANT_OPTIONS}
                        />
                    }
                    s={
                        <Combobox
                            aria-label="Fruit"
                            options={FRUITS}
                            loading
                            placeholder="Select"
                        />
                    }
                />
                <Row
                    label="small → sm"
                    a={
                        <AntSelect
                            className="w-full"
                            showSearch
                            size="small"
                            defaultValue="banana"
                            options={ANT_OPTIONS}
                        />
                    }
                    s={<Combobox aria-label="Fruit" options={FRUITS} value="banana" size="sm" />}
                />
                <Row
                    label="invalid → status=error"
                    a={
                        <AntSelect
                            className="w-full"
                            showSearch
                            status="error"
                            placeholder="Select"
                            options={ANT_OPTIONS}
                        />
                    }
                    s={
                        <Combobox
                            aria-label="Fruit"
                            options={FRUITS}
                            invalid
                            placeholder="Select"
                        />
                    }
                />
            </div>
        )
    },
}

// Interaction states, forced statically. HOVER: pseudo-hover-all works for both (antd Select
// hover IS css :hover). FOCUS: antd's Select focus is a JS class, so we force
// `ant-select-focused` on the antd side; the agenta combobox trigger is a div, so
// pseudo-focus-all forces `:focus` on its inner input → the trigger's `[&:has(:focus)]` fires.
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
        <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {/* subject ON the pseudo wrapper so the crop keeps the forced state */}
            <div className={`${cls} ${CONTROL_BOX}`} data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div className={`${cls} ${CONTROL_BOX}`} data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

const ANT = FRUITS.map((f) => ({value: f.value, label: f.searchValue}))

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <StateRow
                label="trigger · hover"
                cls="pseudo-hover-all"
                a={<AntSelect className="w-full" showSearch defaultValue="banana" options={ANT} />}
                s={<Combobox aria-label="Fruit" options={FRUITS} value="banana" />}
            />
            <StateRow
                label="trigger · focus (glow)"
                cls="pseudo-focus-all"
                a={
                    <AntSelect
                        className="ant-select-focused w-full"
                        showSearch
                        defaultValue="banana"
                        options={ANT}
                    />
                }
                s={<Combobox aria-label="Fruit" options={FRUITS} value="banana" />}
            />
        </div>
    ),
}

// Forced-OPEN state: the dropdown renders statically (no click needed) INLINE via a portal
// container, so the antd and agenta open panels sit side by side and are measurable with
// getComputedStyle. antd uses `open` + `getPopupContainer`; the Combobox uses `defaultOpen` +
// `container`.
function Panel({render}: {render: (c: HTMLElement) => React.ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        <div ref={setEl} className="relative min-h-[220px] w-[220px]">
            {el && render(el)}
        </div>
    )
}

export const OpenState: Story = {
    render: () => (
        <div className="flex gap-24 p-4" data-open-compare>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">antd</div>
                <Panel
                    render={(c) => (
                        <AntSelect
                            open
                            getPopupContainer={() => c}
                            showSearch
                            defaultValue="banana"
                            options={ANT}
                            style={{width: 220}}
                        />
                    )}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
                <Panel
                    render={(c) => (
                        <Combobox
                            aria-label="Fruit"
                            options={FRUITS}
                            value="banana"
                            defaultOpen
                            container={c}
                        />
                    )}
                />
            </div>
        </div>
    ),
}
