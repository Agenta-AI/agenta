import {useState} from "react"

import {
    Select as ShadSelect,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Forms/Select",
    component: ShadSelect,
    subcomponents: {SelectTrigger, SelectContent, SelectItem, SelectValue},
    parameters: {
        docs: {
            description: {
                component:
                    "The `@agenta/ui` Select (Radix-based). Compose `Select` > `SelectTrigger` > `SelectContent` > `SelectItem`; prop tables for each part are below.\n\n**Used in:** 2 places only — the drill-in controls and the drill-in JSON array field. Searchable selects use the `Combobox`.",
            },
        },
    },
} satisfies Meta
export default meta
type Story = StoryObj

// Selects are width:100% — each control gets a fixed-width box. Same as Input.
const CONTROL_BOX = "w-[220px] shrink-0"

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_auto] items-center gap-4 py-2 border-b border-colorBorderSecondary">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={CONTROL_BOX}>{children}</div>
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

export const Variants: Story = {
    render: () => (
        <div className="flex flex-col max-w-[560px]">
            <Row label="placeholder">
                <Shad />
            </Row>
            <Row label="with value">
                <Shad value="a" />
            </Row>
            <Row label="size=sm">
                <Shad size="sm" value="a" />
            </Row>
            <Row label="size=lg">
                <Shad size="lg" value="a" />
            </Row>
            <Row label="disabled">
                <Shad disabled value="a" />
            </Row>
            <Row label="ghost">
                <Shad variant="ghost" value="a" />
            </Row>
        </div>
    ),
}

// Forced-OPEN state rendered INLINE (portal container) so the open panel stays inside the story
// canvas: `defaultOpen` (Root passthrough) + `container` on SelectContent.
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
        <div className="p-4">
            <Panel
                render={(c) => (
                    <ShadSelect defaultValue="b" defaultOpen>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent container={c}>
                            {OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </ShadSelect>
                )}
            />
        </div>
    ),
}

// Trigger interaction states, forced statically. The trigger is a Radix button, so
// pseudo-focus-all engages its `focus:` glow.
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
        <div className="flex max-w-[560px] flex-col">
            <StateRow label="trigger · hover" cls="pseudo-hover-all">
                <Shad value="a" />
            </StateRow>
            <StateRow label="trigger · focus (glow)" cls="pseudo-focus-all">
                <Shad value="a" />
            </StateRow>
        </div>
    ),
}
