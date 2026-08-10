import {ListBullets, SquaresFour, Rows} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Segmented as AntSegmented} from "antd"

import {Segmented} from "../../packages/agenta-ui/src/components/ui/segmented"

// Phase-0 parity story: the REAL antd Segmented behind the app theme, side by side with the
// @agenta/ui custom re-skin. antd `options` (string[] or {label,value,icon,disabled}[]) +
// `value`/`defaultValue`/`onChange` + `size`/`block`/`disabled` map 1:1; antd size "middle" → "default".
const meta = {
    title: "@agenta/ui/Primitives/Forms/Segmented",
    component: AntSegmented,
    // antd `Segmented` is the interactive reference; the @agenta/ui re-skin is documented as a
    // subcomponent so its full prop table renders here too.
    subcomponents: {"Segmented (@agenta/ui)": Segmented},
    parameters: {
        docs: {
            description: {
                component:
                    'antd `Segmented` (reference) alongside the `@agenta/ui` re-skin. antd `options`/`value`/`size`/`block` map 1:1; antd size "middle" → "default".\n\n**Used in:** nowhere — the `@agenta/ui` Segmented has zero call-sites; every segmented control in the app still imports antd (theme switcher, eval-run configuration view, agent inspector lenses, drives).',
            },
        },
    },
} satisfies Meta<typeof AntSegmented>

export default meta
// Untyped: render-only stories don't satisfy StoryObj<typeof meta> when the component has
// required props (options). Matches the other reference stories.
type Story = StoryObj

const textOptions = ["Daily", "Weekly", "Monthly"]

const iconOptions = [
    {value: "grid", icon: <SquaresFour size={16} />},
    {value: "folders", icon: <Rows size={16} />},
    {value: "list", icon: <ListBullets size={16} />},
]

// `.grid` Row: [label | antd cell | agenta cell]. The VRT pairs the whole track (rail + items +
// sliding thumb) in each cell so bg, thumb, radii, text colours and the pill are all compared.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {/* data-vrt-subject wrapper: track + item buttons are all candidates; self-start stops flex-col stretch */}
            <span data-vrt-subject className="inline-flex self-start">
                {a}
            </span>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <span data-vrt-subject className="inline-flex self-start">
                {s}
            </span>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[960px] flex-col">
            <Row
                label="default · text · opt 1"
                a={<AntSegmented defaultValue="Daily" options={textOptions} />}
                s={<Segmented defaultValue="Daily" options={textOptions} />}
            />
            <Row
                label="default · text · opt 2"
                a={<AntSegmented defaultValue="Weekly" options={textOptions} />}
                s={<Segmented defaultValue="Weekly" options={textOptions} />}
            />
            <Row
                label="size small"
                a={<AntSegmented size="small" defaultValue="Daily" options={textOptions} />}
                s={<Segmented size="sm" defaultValue="Daily" options={textOptions} />}
            />
            <Row
                label="size middle (default)"
                a={<AntSegmented size="middle" defaultValue="Daily" options={textOptions} />}
                s={<Segmented size="default" defaultValue="Daily" options={textOptions} />}
            />
            <Row
                label="size large"
                a={<AntSegmented size="large" defaultValue="Daily" options={textOptions} />}
                s={<Segmented size="lg" defaultValue="Daily" options={textOptions} />}
            />
            <Row
                label="block (full width)"
                a={
                    <div className="w-[320px]">
                        <AntSegmented block defaultValue="Daily" options={textOptions} />
                    </div>
                }
                s={
                    <div className="w-[320px]">
                        <Segmented block defaultValue="Daily" options={textOptions} />
                    </div>
                }
            />
            {/* `ag-icon-segmented` (globals.css) is the app's own fix for antd's baseline-hung
                icons; every icon call-site applies it (see ThemeSwitcher), so it belongs on the
                antd baseline too — without it the row compares against a look nothing ships. */}
            <Row
                label="icon-only (centering)"
                a={
                    <AntSegmented
                        className="ag-icon-segmented"
                        defaultValue="grid"
                        options={iconOptions}
                    />
                }
                s={
                    <Segmented
                        defaultValue="grid"
                        options={[
                            {value: "grid", icon: <SquaresFour size={16} />, "aria-label": "Grid"},
                            {value: "folders", icon: <Rows size={16} />, "aria-label": "Folders"},
                            {value: "list", icon: <ListBullets size={16} />, "aria-label": "List"},
                        ]}
                    />
                }
            />
            <Row
                label="icon + text"
                a={
                    <AntSegmented
                        className="ag-icon-segmented"
                        defaultValue="grid"
                        options={[
                            {value: "grid", label: "Grid", icon: <SquaresFour size={16} />},
                            {value: "list", label: "List", icon: <ListBullets size={16} />},
                        ]}
                    />
                }
                s={
                    <Segmented
                        defaultValue="grid"
                        options={[
                            {value: "grid", label: "Grid", icon: <SquaresFour size={16} />},
                            {value: "list", label: "List", icon: <ListBullets size={16} />},
                        ]}
                    />
                }
            />
            <Row
                label="disabled (whole control)"
                a={<AntSegmented disabled defaultValue="Daily" options={textOptions} />}
                s={<Segmented disabled defaultValue="Daily" options={textOptions} />}
            />
            <Row
                label="disabled option"
                a={
                    <AntSegmented
                        defaultValue="Daily"
                        options={[
                            {value: "Daily", label: "Daily"},
                            {value: "Weekly", label: "Weekly", disabled: true},
                            {value: "Monthly", label: "Monthly"},
                        ]}
                    />
                }
                s={
                    <Segmented
                        defaultValue="Daily"
                        options={[
                            {value: "Daily", label: "Daily"},
                            {value: "Weekly", label: "Weekly", disabled: true},
                            {value: "Monthly", label: "Monthly"},
                        ]}
                    />
                }
            />
        </div>
    ),
}

// Interaction states rendered STATICALLY via storybook-addon-pseudo-states: each cell is wrapped
// in `pseudo-<state>-all`, forcing the pseudo-class on the item inside. antd's hover is
// runtime-injected cssinjs, so confirm hover colour with the computed-style read (see README).
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
    <div className="grid grid-cols-[16rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className={pseudo} data-side="antd">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {/* subject INSIDE the pseudo wrapper so the crop keeps the forced state */}
            <span data-vrt-subject className="inline-flex">
                {antd}
            </span>
        </div>
        <div className={pseudo} data-side="agenta">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <span data-vrt-subject className="inline-flex">
                {shad}
            </span>
        </div>
    </div>
)

export const InteractionStates: Story = {
    render: () => (
        <div className="flex max-w-[960px] flex-col">
            <StateRow
                label="item · resting (selected + thumb)"
                pseudo=""
                antd={<AntSegmented defaultValue="Daily" options={textOptions} />}
                shad={<Segmented defaultValue="Daily" options={textOptions} />}
            />
            <StateRow
                label="item · hover (antd paints via ::after, which the addon can't force — not reproduced)"
                pseudo="pseudo-hover-all"
                antd={<AntSegmented defaultValue="Daily" options={textOptions} />}
                shad={<Segmented defaultValue="Daily" options={textOptions} />}
            />
            <StateRow
                label="item · active/pressed (antd paints via ::after, which the addon can't force — not reproduced)"
                pseudo="pseudo-active-all"
                antd={<AntSegmented defaultValue="Daily" options={textOptions} />}
                shad={<Segmented defaultValue="Daily" options={textOptions} />}
            />
            <StateRow
                label="item · focus-visible (antd rings via .ant-segmented-item-focused class — not reproduced)"
                pseudo="pseudo-focus-visible-all"
                antd={<AntSegmented defaultValue="Daily" options={textOptions} />}
                shad={<Segmented defaultValue="Daily" options={textOptions} />}
            />
            <StateRow
                label="control · disabled"
                pseudo=""
                antd={<AntSegmented disabled defaultValue="Daily" options={textOptions} />}
                shad={<Segmented disabled defaultValue="Daily" options={textOptions} />}
            />
        </div>
    ),
}
