import {Switch as ShadSwitch} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Switch as AntSwitch} from "antd"

// Phase-0 parity story: the REAL antd Switch behind the app theme, side by side with the
// @agenta/ui re-skin. antd `size="small"`→`size="sm"`, `onChange`→`onCheckedChange`.
const meta = {
    title: "@agenta/ui/Primitives/Forms/Switch",
    component: AntSwitch,
    subcomponents: {"Switch (@agenta/ui)": ShadSwitch},
    parameters: {
        docs: {
            description: {
                component:
                    "antd `Switch` (interactive playground) shown beside the `@agenta/ui` Switch that replaces it. See the subcomponent table below for the agenta props.\n\n**Used in:** 2 places — the editor primitive form node and the drill-in boolean field.",
            },
        },
    },
    args: {defaultChecked: true},
    argTypes: {
        size: {control: "select", options: ["default", "small"]},
        disabled: {control: "boolean"},
    },
} satisfies Meta<typeof AntSwitch>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

// `.grid` Row: [label | antd cell | agenta cell] — the VRT pairs the control in each cell.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label="unchecked" a={<AntSwitch />} s={<ShadSwitch aria-label="Toggle" />} />
            <Row
                label="checked"
                a={<AntSwitch defaultChecked />}
                s={<ShadSwitch aria-label="Toggle" defaultChecked />}
            />
            <Row
                label="small · unchecked"
                a={<AntSwitch size="small" />}
                s={<ShadSwitch aria-label="Toggle" size="sm" />}
            />
            <Row
                label="small · checked"
                a={<AntSwitch size="small" defaultChecked />}
                s={<ShadSwitch aria-label="Toggle" size="sm" defaultChecked />}
            />
            <Row
                label="disabled · unchecked"
                a={<AntSwitch disabled />}
                s={<ShadSwitch aria-label="Toggle" disabled />}
            />
            <Row
                label="disabled · checked"
                a={<AntSwitch disabled defaultChecked />}
                s={<ShadSwitch aria-label="Toggle" disabled defaultChecked />}
            />
        </div>
    ),
}

// Interaction states forced STATICALLY via storybook-addon-pseudo-states: each cell is
// wrapped in `pseudo-<state>-all`, forcing that pseudo-class on the control inside (antd via
// CSS :hover/:focus-visible, agenta identically) — measurable with no cursor/keyboard.
const StateRow = ({
    label,
    pseudo,
    antd,
    shad,
}: {
    label: string
    pseudo: string
    antd: React.ReactNode
    shad: React.ReactNode
}) => (
    <div className="grid grid-cols-[16rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={`${pseudo} flex items-center gap-2`} data-side="antd">
            <span className="w-8 text-[10px] text-colorTextSecondary">antd</span>
            {antd}
        </div>
        <div className={`${pseudo} flex items-center gap-2`} data-side="agenta">
            <span className="w-8 text-[10px] text-colorTextSecondary">agenta</span>
            {shad}
        </div>
    </div>
)

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <StateRow
                label="unchecked · hover"
                pseudo="pseudo-hover-all"
                antd={<AntSwitch />}
                shad={<ShadSwitch aria-label="Toggle" />}
            />
            <StateRow
                label="checked · hover"
                pseudo="pseudo-hover-all"
                antd={<AntSwitch defaultChecked />}
                shad={<ShadSwitch aria-label="Toggle" defaultChecked />}
            />
            {/* :active (pressed). antd stretches the handle ~30% toward the press-opposite side
                (switchHandleActiveInset -30%); reproduced token-purely on the thumb — see Switch.md. */}
            <StateRow
                label="unchecked · active (pressed)"
                pseudo="pseudo-active-all"
                antd={<AntSwitch />}
                shad={<ShadSwitch aria-label="Toggle" />}
            />
            <StateRow
                label="checked · active (pressed)"
                pseudo="pseudo-active-all"
                antd={<AntSwitch defaultChecked />}
                shad={<ShadSwitch aria-label="Toggle" defaultChecked />}
            />
            <StateRow
                label="unchecked · focus-visible"
                pseudo="pseudo-focus-visible-all"
                antd={<AntSwitch />}
                shad={<ShadSwitch aria-label="Toggle" />}
            />
            <StateRow
                label="checked · focus-visible"
                pseudo="pseudo-focus-visible-all"
                antd={<AntSwitch defaultChecked />}
                shad={<ShadSwitch aria-label="Toggle" defaultChecked />}
            />
            <StateRow
                label="unchecked · disabled"
                pseudo=""
                antd={<AntSwitch disabled />}
                shad={<ShadSwitch aria-label="Toggle" disabled />}
            />
            <StateRow
                label="checked · disabled"
                pseudo=""
                antd={<AntSwitch disabled defaultChecked />}
                shad={<ShadSwitch aria-label="Toggle" disabled defaultChecked />}
            />
        </div>
    ),
}
