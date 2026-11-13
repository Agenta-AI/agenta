import {ListBullets, SquaresFour, Rows} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {Segmented} from "../../packages/agenta-ui/src/components/ui/segmented"

const meta = {
    title: "@agenta/ui/Primitives/Forms/Segmented",
    component: Segmented,
    parameters: {
        docs: {
            description: {
                component:
                    "A custom segmented control with a sliding thumb. Takes `options` (strings or `{label, value, icon, disabled}`), `value`/`defaultValue`/`onChange`, `size` (`sm`, `default`, `lg`), `block` and `disabled`.\n\n**Used in:** nowhere — the `@agenta/ui` Segmented has zero call-sites.",
            },
        },
    },
} satisfies Meta<typeof Segmented>

export default meta
// Untyped: render-only stories don't satisfy StoryObj<typeof meta> when the component has
// required props (options). Matches the other reference stories.
type Story = StoryObj

const textOptions = ["Daily", "Weekly", "Monthly"]

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <span className="inline-flex self-start">{children}</span>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="default · text · opt 1">
                <Segmented defaultValue="Daily" options={textOptions} />
            </Row>
            <Row label="default · text · opt 2">
                <Segmented defaultValue="Weekly" options={textOptions} />
            </Row>
            <Row label="size sm">
                <Segmented size="sm" defaultValue="Daily" options={textOptions} />
            </Row>
            <Row label="size default">
                <Segmented size="default" defaultValue="Daily" options={textOptions} />
            </Row>
            <Row label="size lg">
                <Segmented size="lg" defaultValue="Daily" options={textOptions} />
            </Row>
            <Row label="block (full width)">
                <div className="w-[320px]">
                    <Segmented block defaultValue="Daily" options={textOptions} />
                </div>
            </Row>
            <Row label="icon-only (centering)">
                <Segmented
                    defaultValue="grid"
                    options={[
                        {value: "grid", icon: <SquaresFour size={16} />, "aria-label": "Grid"},
                        {value: "folders", icon: <Rows size={16} />, "aria-label": "Folders"},
                        {value: "list", icon: <ListBullets size={16} />, "aria-label": "List"},
                    ]}
                />
            </Row>
            <Row label="icon + text">
                <Segmented
                    defaultValue="grid"
                    options={[
                        {value: "grid", label: "Grid", icon: <SquaresFour size={16} />},
                        {value: "list", label: "List", icon: <ListBullets size={16} />},
                    ]}
                />
            </Row>
            <Row label="disabled (whole control)">
                <Segmented disabled defaultValue="Daily" options={textOptions} />
            </Row>
            <Row label="disabled option">
                <Segmented
                    defaultValue="Daily"
                    options={[
                        {value: "Daily", label: "Daily"},
                        {value: "Weekly", label: "Weekly", disabled: true},
                        {value: "Monthly", label: "Monthly"},
                    ]}
                />
            </Row>
        </div>
    ),
}

// Interaction states rendered STATICALLY via storybook-addon-pseudo-states: each cell is wrapped
// in `pseudo-<state>-all`, forcing the pseudo-class on the item inside.
const StateRow = ({
    label,
    pseudo,
    children,
}: {
    label: string
    pseudo: string
    children: React.ReactNode
}) => (
    <div className="grid grid-cols-[16rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={pseudo}>
            <span className="inline-flex">{children}</span>
        </div>
    </div>
)

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <StateRow label="item · resting (selected + thumb)" pseudo="">
                <Segmented defaultValue="Daily" options={textOptions} />
            </StateRow>
            <StateRow label="item · hover" pseudo="pseudo-hover-all">
                <Segmented defaultValue="Daily" options={textOptions} />
            </StateRow>
            <StateRow label="item · active/pressed" pseudo="pseudo-active-all">
                <Segmented defaultValue="Daily" options={textOptions} />
            </StateRow>
            <StateRow label="item · focus-visible" pseudo="pseudo-focus-visible-all">
                <Segmented defaultValue="Daily" options={textOptions} />
            </StateRow>
            <StateRow label="control · disabled" pseudo="">
                <Segmented disabled defaultValue="Daily" options={textOptions} />
            </StateRow>
        </div>
    ),
}
