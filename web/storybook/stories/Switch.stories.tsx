import {Switch as ShadSwitch} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Forms/Switch",
    component: ShadSwitch,
    parameters: {
        docs: {
            description: {
                component:
                    "A Radix Switch with `default` and `sm` sizes. Use `onCheckedChange` for changes.\n\n**Used in:** 2 places — the editor primitive form node and the drill-in boolean field.",
            },
        },
    },
    args: {defaultChecked: true, "aria-label": "Toggle"},
    argTypes: {
        size: {control: "select", options: ["default", "sm"]},
        disabled: {control: "boolean"},
    },
} satisfies Meta<typeof ShadSwitch>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[480px] flex-col">
            <Row label="unchecked">
                <ShadSwitch aria-label="Toggle" />
            </Row>
            <Row label="checked">
                <ShadSwitch aria-label="Toggle" defaultChecked />
            </Row>
            <Row label="small · unchecked">
                <ShadSwitch aria-label="Toggle" size="sm" />
            </Row>
            <Row label="small · checked">
                <ShadSwitch aria-label="Toggle" size="sm" defaultChecked />
            </Row>
            <Row label="disabled · unchecked">
                <ShadSwitch aria-label="Toggle" disabled />
            </Row>
            <Row label="disabled · checked">
                <ShadSwitch aria-label="Toggle" disabled defaultChecked />
            </Row>
        </div>
    ),
}

// Interaction states forced STATICALLY via storybook-addon-pseudo-states: each cell is
// wrapped in `pseudo-<state>-all`, forcing that pseudo-class on the control inside.
const StateRow = ({
    label,
    pseudo,
    children,
}: {
    label: string
    pseudo: string
    children: React.ReactNode
}) => (
    <div className="grid grid-cols-[16rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={`${pseudo} flex items-center gap-2`}>{children}</div>
    </div>
)

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <StateRow label="unchecked · hover" pseudo="pseudo-hover-all">
                <ShadSwitch aria-label="Toggle" />
            </StateRow>
            <StateRow label="checked · hover" pseudo="pseudo-hover-all">
                <ShadSwitch aria-label="Toggle" defaultChecked />
            </StateRow>
            {/* :active (pressed) stretches the handle toward the press-opposite side. */}
            <StateRow label="unchecked · active (pressed)" pseudo="pseudo-active-all">
                <ShadSwitch aria-label="Toggle" />
            </StateRow>
            <StateRow label="checked · active (pressed)" pseudo="pseudo-active-all">
                <ShadSwitch aria-label="Toggle" defaultChecked />
            </StateRow>
            <StateRow label="unchecked · focus-visible" pseudo="pseudo-focus-visible-all">
                <ShadSwitch aria-label="Toggle" />
            </StateRow>
            <StateRow label="checked · focus-visible" pseudo="pseudo-focus-visible-all">
                <ShadSwitch aria-label="Toggle" defaultChecked />
            </StateRow>
            <StateRow label="unchecked · disabled" pseudo="">
                <ShadSwitch aria-label="Toggle" disabled />
            </StateRow>
            <StateRow label="checked · disabled" pseudo="">
                <ShadSwitch aria-label="Toggle" disabled defaultChecked />
            </StateRow>
        </div>
    ),
}
