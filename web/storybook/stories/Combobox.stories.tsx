import {useState} from "react"

import {Combobox, type ComboboxOption} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Forms/Combobox",
    component: Combobox,
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Combobox — a searchable single-select with optional clear, loading, small and invalid states.\n\n**Used in:** 2 places, both inside `@agenta/ui` — `PathSelectorDropdown` (which itself has no call-sites) and the entity picker hierarchy-level select. No app file composes it directly.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

const CONTROL_BOX = "w-[220px] shrink-0"

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_auto] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={CONTROL_BOX}>{children}</div>
    </div>
)

const FRUITS: ComboboxOption[] = [
    {value: "apple", label: "Apple", searchValue: "Apple"},
    {value: "banana", label: "Banana", searchValue: "Banana"},
    {value: "cherry", label: "Cherry", searchValue: "Cherry"},
    {value: "date", label: "Date", searchValue: "Date"},
]

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

export const Variants: Story = {
    render: function VariantsStory() {
        const [v1, setV1] = useState<string>()
        const [v2, setV2] = useState<string | undefined>("banana")
        return (
            <div className="flex flex-col max-w-[480px]">
                <Row label="placeholder (closed)">
                    <Combobox
                        options={FRUITS}
                        value={v1}
                        onChange={setV1}
                        allowClear
                        placeholder="Select"
                    />
                </Row>
                <Row label="with value + clear">
                    <Combobox
                        aria-label="Fruit"
                        options={FRUITS}
                        value={v2}
                        onChange={setV2}
                        allowClear
                    />
                </Row>
                <Row label="disabled">
                    <Combobox aria-label="Fruit" options={FRUITS} value="banana" disabled />
                </Row>
                <Row label="loading">
                    <Combobox aria-label="Fruit" options={FRUITS} loading placeholder="Select" />
                </Row>
                <Row label="size=sm">
                    <Combobox aria-label="Fruit" options={FRUITS} value="banana" size="sm" />
                </Row>
                <Row label="invalid">
                    <Combobox aria-label="Fruit" options={FRUITS} invalid placeholder="Select" />
                </Row>
            </div>
        )
    },
}

// Interaction states, forced statically. HOVER: pseudo-hover-all. FOCUS: the combobox trigger
// is a div, so pseudo-focus-all forces `:focus` on its inner input and the trigger's
// `[&:has(:focus)]` rule fires.
const StateRow = ({
    label,
    cls,
    children,
}: {
    label: string
    cls: string
    children: React.ReactNode
}) => (
    <div className="grid grid-cols-[16rem_auto] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={`${cls} ${CONTROL_BOX}`}>{children}</div>
    </div>
)

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[480px] flex-col">
            <StateRow label="trigger · hover" cls="pseudo-hover-all">
                <Combobox aria-label="Fruit" options={FRUITS} value="banana" />
            </StateRow>
            <StateRow label="trigger · focus (glow)" cls="pseudo-focus-all">
                <Combobox aria-label="Fruit" options={FRUITS} value="banana" />
            </StateRow>
        </div>
    ),
}

// Forced-OPEN state: the dropdown renders statically (no click needed) INLINE via a portal
// container, using `defaultOpen` + `container`.
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
        <div className="p-4">
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
    ),
}
